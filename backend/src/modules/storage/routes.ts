import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

export const storageRouter = Router();
export const adminStorageRouter = Router();
const purposeSchema = z.enum(['CUSTOM_PRINT_MODEL', 'REFERENCE_IMAGE', 'PRODUCT_IMAGE']);
const modelExts = new Set(['.stl', '.3mf', '.obj']);
const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const imageTypes: Record<string, string[]> = { '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.webp': ['image/webp'] };
const modelTypes: Record<string, string[]> = {
  '.stl': ['model/stl', 'application/sla', 'application/octet-stream'],
  '.3mf': ['model/3mf', 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', 'application/zip', 'application/octet-stream'],
  '.obj': ['text/plain', 'application/octet-stream', 'model/obj'],
};
let client: S3Client | null = null;
function r2() {
  if (!env.R2_BUCKET_NAME || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ENDPOINT) throw Object.assign(new Error('Private object storage is not configured. Set the private R2 environment variables.'), { status: 503 });
  if (!client) client = new S3Client({ region: 'auto', endpoint: env.R2_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
  return client;
}
const presignSchema = z.object({ fileName: z.string().trim().min(1).max(255), contentType: z.string().trim().min(1).max(120), sizeBytes: z.number().int().positive().max(env.MAX_UPLOAD_BYTES), purpose: purposeSchema });

storageRouter.use(requireAuth);
storageRouter.post('/presign', async (req, res, next) => {
  try {
    if (!env.R2_UPLOADS_ENABLED) return res.status(503).json({ error: { code: 'UPLOADS_DISABLED', message: 'Uploads are temporarily disabled until the deployment has a verified hard upload-size limit.' } });
    const parsed = presignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid upload metadata. Maximum upload size is ${env.MAX_UPLOAD_BYTES} bytes.` } });
    const input = parsed.data;
    if (input.purpose === 'PRODUCT_IMAGE' && !['ADMIN', 'SUPER_ADMIN'].includes(req.authUser!.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only administrators can upload product images.' } });
    const ext = extname(input.fileName).toLowerCase();
    const allowed = input.purpose === 'REFERENCE_IMAGE' || input.purpose === 'PRODUCT_IMAGE' ? imageExts : modelExts;
    const types = input.purpose === 'REFERENCE_IMAGE' || input.purpose === 'PRODUCT_IMAGE' ? imageTypes : modelTypes;
    if (!allowed.has(ext) || !types[ext]?.includes(input.contentType.toLowerCase())) return res.status(400).json({ error: { code: 'FILE_TYPE_NOT_ALLOWED', message: 'The extension and content type combination is not allowed.' } });
    const recent = await prisma.uploadedAsset.aggregate({
      where: { ownerUserId: req.authUser!.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    const hourlyBytes = recent._sum.sizeBytes ?? 0;
    if (recent._count._all >= 10 || hourlyBytes + input.sizeBytes > 200 * 1024 * 1024) {
      return res.status(429).json({ error: { code: 'UPLOAD_RATE_LIMIT', message: 'Your hourly upload quota has been reached. Try again later.' } });
    }
    const storage = r2();
    // Every new upload starts in the private bucket. Product images are copied to
    // the public bucket only after an authenticated administrator approves them.
    const bucketName = env.R2_BUCKET_NAME;
    if (!bucketName) throw Object.assign(new Error('Private object storage is not configured.'), { status: 503 });
    const id = randomUUID();
    // Upload URLs target a disposable incoming key. Completion seals a verified copy
    // under `private/`, so a presigned capability can never mutate the DB-linked file.
    const objectKey = `incoming/${input.purpose.toLowerCase()}/${req.authUser!.id}/${id}${ext}`;
    const asset = await prisma.uploadedAsset.create({ data: { ownerUserId: req.authUser!.id, objectKey, bucketName, originalName: input.fileName, contentType: input.contentType.toLowerCase(), sizeBytes: input.sizeBytes, purpose: input.purpose, status: 'PENDING', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
    const command = new PutObjectCommand({ Bucket: bucketName, Key: objectKey, IfNoneMatch: '*', ContentType: asset.contentType, Metadata: { assetid: asset.id, ownerid: req.authUser!.id } });
    const uploadUrl = await getSignedUrl(storage, command, { expiresIn: env.R2_PRESIGN_TTL_SECONDS, signableHeaders: new Set(['if-none-match']) });
    res.status(201).json({ data: { assetId: asset.id, uploadUrl, method: 'PUT', headers: { 'Content-Type': asset.contentType, 'If-None-Match': '*', 'x-amz-meta-assetid': asset.id, 'x-amz-meta-ownerid': req.authUser!.id }, expiresInSeconds: env.R2_PRESIGN_TTL_SECONDS, maxBytes: env.MAX_UPLOAD_BYTES, instructions: 'After uploading, call /api/v1/uploads/complete. The upload is one-write, then sealed under a private key and quarantined for review.' } });
  } catch (error) { next(error); }
});

const completeSchema = z.object({ assetId: z.string().min(8).max(100) });
storageRouter.post('/complete', async (req, res, next) => {
  try {
    if (!env.R2_UPLOADS_ENABLED) return res.status(503).json({ error: { code: 'UPLOADS_DISABLED', message: 'Uploads are temporarily disabled until the deployment has a verified hard upload-size limit.' } });
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid asset ID.' } });
    const asset = await prisma.uploadedAsset.findFirst({ where: { id: parsed.data.assetId, ownerUserId: req.authUser!.id, status: 'PENDING' } });
    if (!asset) return res.status(404).json({ error: { code: 'ASSET_NOT_FOUND', message: 'Pending upload not found.' } });
    const storage = r2();
    const head = await storage.send(new HeadObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey }));
    if (head.ContentLength === undefined || head.ContentLength !== asset.sizeBytes || head.ContentLength > env.MAX_UPLOAD_BYTES || head.ContentType !== asset.contentType || !head.ETag || head.Metadata?.assetid !== asset.id || head.Metadata?.ownerid !== req.authUser!.id) {
      await prisma.uploadedAsset.update({ where: { id: asset.id }, data: { status: 'REJECTED' } });
      await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey })).catch(() => undefined);
      return res.status(400).json({ error: { code: 'UPLOAD_METADATA_MISMATCH', message: 'Uploaded object metadata did not match the declared file. The asset was rejected.' } });
    }
    const ranged = await storage.send(new GetObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey, Range: 'bytes=0-4095' }));
    const sample = ranged.Body ? Buffer.from(await ranged.Body.transformToByteArray()) : Buffer.alloc(0);
    const ext = extname(asset.originalName).toLowerCase();
    if (!validateFileSignature(ext, sample, Number(head.ContentLength))) {
      await prisma.uploadedAsset.update({ where: { id: asset.id }, data: { status: 'REJECTED' } });
      await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey })).catch(() => undefined);
      return res.status(400).json({ error: { code: 'FILE_SIGNATURE_INVALID', message: 'The file signature did not match the declared format. The asset was rejected.' } });
    }
    // The presigned PUT is create-once (If-None-Match: *). Copy the inspected
    // object to a new private key before attaching it to the asset row. Even if
    // an old URL remains valid, it can only refer to the disposable incoming key.
    const sealedKey = `private/${asset.purpose.toLowerCase()}/${asset.ownerUserId}/${randomUUID()}${ext}`;
    const copySource = `${asset.bucketName}/${asset.objectKey.split('/').map(encodeURIComponent).join('/')}`;
    try {
      await storage.send(new CopyObjectCommand({
        Bucket: asset.bucketName,
        Key: sealedKey,
        CopySource: copySource,
        CopySourceIfMatch: head.ETag,
        ContentType: asset.contentType,
        MetadataDirective: 'REPLACE',
        Metadata: { assetid: asset.id, ownerid: asset.ownerUserId },
      }));
      const sealedHead = await storage.send(new HeadObjectCommand({ Bucket: asset.bucketName, Key: sealedKey }));
      if (sealedHead.ContentLength !== asset.sizeBytes || sealedHead.ContentType !== asset.contentType || sealedHead.Metadata?.assetid !== asset.id || sealedHead.Metadata?.ownerid !== asset.ownerUserId) {
        throw Object.assign(new Error('The copied object did not match the validated upload.'), { status: 503, code: 'UPLOAD_SEAL_FAILED' });
      }
    } catch (error) {
      await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: sealedKey })).catch(() => undefined);
      throw error;
    }
    let claimed: { count: number };
    try {
      claimed = await prisma.uploadedAsset.updateMany({
        where: { id: asset.id, ownerUserId: req.authUser!.id, status: 'PENDING', objectKey: asset.objectKey, bucketName: asset.bucketName },
        data: { objectKey: sealedKey, status: 'QUARANTINED', expiresAt: null },
      });
    } catch (error) {
      await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: sealedKey })).catch(() => undefined);
      throw error;
    }
    if (claimed.count !== 1) {
      await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: sealedKey })).catch(() => undefined);
      return res.status(409).json({ error: { code: 'ASSET_STATE_CHANGED', message: 'This upload was already completed or changed. Refresh the page before retrying.' } });
    }
    await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey })).catch(() => console.error(JSON.stringify({ level: 'error', event: 'INCOMING_UPLOAD_CLEANUP_FAILED', assetId: asset.id })));
    res.json({ data: { assetId: asset.id, status: 'QUARANTINED', message: 'Upload received, sealed under a private object key, and quarantined. Administrators must review it before production use.' } });
  } catch (error) { next(error); }
});

function validateFileSignature(ext: string, sample: Buffer, fullSize: number): boolean {
  if (ext === '.png') return sample.length >= 8 && sample.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === '.jpg' || ext === '.jpeg') return sample.length >= 3 && sample[0] === 0xff && sample[1] === 0xd8 && sample[2] === 0xff;
  if (ext === '.webp') return sample.length >= 12 && sample.toString('ascii', 0, 4) === 'RIFF' && sample.toString('ascii', 8, 12) === 'WEBP';
  if (ext === '.3mf') return sample.length >= 4 && sample[0] === 0x50 && sample[1] === 0x4b && sample[2] === 0x03 && sample[3] === 0x04;
  if (ext === '.stl') {
    if (sample.length >= 84) {
      const triangleCount = sample.readUInt32LE(80);
      if (84 + triangleCount * 50 === fullSize) return true;
    }
    const ascii = sample.toString('utf8');
    return /^\s*solid\b/i.test(ascii) && /facet\s+normal/i.test(ascii) && /\bvertex\s+/i.test(ascii);
  }
  if (ext === '.obj') {
    if (sample.includes(0)) return false;
    const lines = sample.toString('utf8').split(/\r?\n/);
    const vertices = lines.filter((line) => /^\s*v\s+[-+0-9.eE]+\s+[-+0-9.eE]+\s+[-+0-9.eE]+(?:\s|$)/.test(line)).length;
    const faces = lines.some((line) => /^\s*f\s+[\d/ ]+\s*$/.test(line));
    return vertices >= 3 && faces;
  }
  return false;
}

adminStorageRouter.use(requireAuth, requireAdmin);

const productImageApprovalSchema = z.object({
  productId: z.string().min(8).max(100),
  altText: z.string().trim().min(3).max(240),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isPrimary: z.boolean().default(false),
});
const rejectProductImageSchema = z.object({ reason: z.string().trim().min(3).max(500) });

adminStorageRouter.get('/assets/pending-product-images', async (_req, res, next) => {
  try {
    const data = await prisma.uploadedAsset.findMany({
      where: { purpose: 'PRODUCT_IMAGE', status: 'QUARANTINED' },
      orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, originalName: true, contentType: true, sizeBytes: true, status: true, createdAt: true, owner: { select: { email: true } } },
    });
    res.json({ data });
  } catch (error) { next(error); }
});

adminStorageRouter.post('/assets/:id/approve-product-image', async (req, res, next) => {
  let copiedToPublic: { bucket: string; key: string } | null = null;
  try {
    const parsed = productImageApprovalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide a product, useful alt text, and valid image ordering.' } });
    const product = await prisma.product.findUnique({ where: { id: parsed.data.productId }, select: { id: true, name: true } });
    if (!product) return res.status(404).json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } });
    const asset = await prisma.uploadedAsset.findUnique({ where: { id: req.params.id } });
    if (!asset || asset.purpose !== 'PRODUCT_IMAGE') return res.status(404).json({ error: { code: 'PRODUCT_IMAGE_ASSET_NOT_FOUND', message: 'Product image upload not found.' } });
    const publicBucket = env.R2_PUBLIC_BUCKET_NAME;
    if (!publicBucket || !env.R2_PUBLIC_BASE_URL) throw Object.assign(new Error('Public product image delivery is not configured. Set R2_PUBLIC_BUCKET_NAME and R2_PUBLIC_BASE_URL.'), { status: 503 });

    const extension = extname(asset.originalName).toLowerCase();
    if (!imageExts.has(extension)) return res.status(400).json({ error: { code: 'FILE_TYPE_NOT_ALLOWED', message: 'Only validated PNG, JPEG, or WebP images can be published.' } });
    const destinationKey = `products/${product.id}/${asset.id}${extension}`;
    if (asset.status === 'APPROVED' && asset.bucketName === publicBucket && asset.objectKey === destinationKey) {
      const existingImage = await prisma.productImage.findUnique({ where: { objectKey: destinationKey } });
      if (existingImage?.productId === product.id) return res.json({ data: existingImage, message: 'Image was already approved and linked.' });
      return res.status(409).json({ error: { code: 'IMAGE_LINK_INCONSISTENT', message: 'The asset is approved but its product-image record is missing; reconcile the asset before retrying.' } });
    }
    if (asset.status !== 'QUARANTINED') return res.status(409).json({ error: { code: 'ASSET_NOT_REVIEWABLE', message: 'Only quarantined product-image uploads can be approved.' } });
    if (asset.bucketName === publicBucket) throw Object.assign(new Error('The private upload bucket and public product-image bucket must be different.'), { status: 503 });

    const storage = r2();
    const source = await storage.send(new HeadObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey }));
    if (source.ContentLength !== asset.sizeBytes || source.ContentType !== asset.contentType || source.Metadata?.assetid !== asset.id || source.Metadata?.ownerid !== asset.ownerUserId) {
      return res.status(409).json({ error: { code: 'ASSET_METADATA_MISMATCH', message: 'The quarantined source no longer matches its verified upload metadata.' } });
    }
    await storage.send(new CopyObjectCommand({
      Bucket: publicBucket,
      Key: destinationKey,
      CopySource: `${asset.bucketName}/${asset.objectKey.split('/').map(encodeURIComponent).join('/')}`,
      ContentType: asset.contentType,
      CacheControl: 'public, max-age=31536000, immutable',
      MetadataDirective: 'REPLACE',
      Metadata: { assetid: asset.id, productid: product.id, approvedby: req.authUser!.id },
    }));
    copiedToPublic = { bucket: publicBucket, key: destinationKey };
    const copied = await storage.send(new HeadObjectCommand({ Bucket: publicBucket, Key: destinationKey }));
    if (copied.ContentLength !== asset.sizeBytes || copied.ContentType !== asset.contentType || copied.Metadata?.assetid !== asset.id || copied.Metadata?.productid !== product.id) {
      await storage.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: destinationKey })).catch(() => undefined);
      return res.status(503).json({ error: { code: 'PUBLIC_COPY_VERIFICATION_FAILED', message: 'Copied image could not be verified; it was not linked to the catalogue.' } });
    }

    let image: Awaited<ReturnType<typeof prisma.productImage.create>>;
    try {
      image = await prisma.$transaction(async (tx) => {
        const claimed = await tx.uploadedAsset.updateMany({
          where: { id: asset.id, purpose: 'PRODUCT_IMAGE', status: 'QUARANTINED', bucketName: asset.bucketName, objectKey: asset.objectKey },
          data: { bucketName: publicBucket, objectKey: destinationKey, status: 'APPROVED', expiresAt: null },
        });
        if (claimed.count !== 1) throw Object.assign(new Error('This upload was reviewed in another request. Refresh the asset list.'), { status: 409, code: 'ASSET_STATE_CHANGED' });
        if (parsed.data.isPrimary) await tx.productImage.updateMany({ where: { productId: product.id }, data: { isPrimary: false } });
        const created = await tx.productImage.create({ data: { productId: product.id, objectKey: destinationKey, altText: parsed.data.altText, sortOrder: parsed.data.sortOrder, isPrimary: parsed.data.isPrimary } });
        await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'PRODUCT_IMAGE_APPROVED', resource: 'ProductImage', resourceId: created.id, requestId: res.locals.requestId, metadata: { productId: product.id, assetId: asset.id, objectKey: destinationKey, isPrimary: parsed.data.isPrimary } } });
        return created;
      });
    } catch (error) {
      const latest = await prisma.uploadedAsset.findUnique({ where: { id: asset.id } }).catch(() => null);
      if (latest?.status === 'APPROVED' && latest.objectKey === destinationKey && latest.bucketName === publicBucket) {
        const existingImage = await prisma.productImage.findUnique({ where: { objectKey: destinationKey } }).catch(() => null);
        if (existingImage?.productId === product.id) {
          await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey })).catch(() => undefined);
          return res.json({ data: existingImage, message: 'Image was already approved and linked.' });
        }
      } else {
        await storage.send(new DeleteObjectCommand({ Bucket: publicBucket, Key: destinationKey })).catch(() => undefined);
        copiedToPublic = null;
      }
      throw error;
    }
    await storage.send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey })).catch(() => console.error(JSON.stringify({ level: 'error', event: 'PRIVATE_PRODUCT_IMAGE_SOURCE_CLEANUP_FAILED', assetId: asset.id })));
    copiedToPublic = null;
    res.status(201).json({ data: image, publicUrl: `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${destinationKey.split('/').map(encodeURIComponent).join('/')}` });
  } catch (error) {
    if (copiedToPublic) await r2().send(new DeleteObjectCommand({ Bucket: copiedToPublic.bucket, Key: copiedToPublic.key })).catch(() => undefined);
    next(error);
  }
});

adminStorageRouter.post('/assets/:id/reject-product-image', async (req, res, next) => {
  try {
    const parsed = rejectProductImageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Provide a rejection reason.' } });
    const asset = await prisma.uploadedAsset.findFirst({ where: { id: req.params.id, purpose: 'PRODUCT_IMAGE', status: 'QUARANTINED' } });
    if (!asset) return res.status(404).json({ error: { code: 'PRODUCT_IMAGE_ASSET_NOT_FOUND', message: 'Quarantined product image not found.' } });
    const changed = await prisma.$transaction(async tx => {
      const update = await tx.uploadedAsset.updateMany({ where: { id: asset.id, status: 'QUARANTINED' }, data: { status: 'REJECTED', expiresAt: null } });
      if (update.count !== 1) throw Object.assign(new Error('The image status changed. Refresh before retrying.'), { status: 409, code: 'ASSET_STATE_CHANGED' });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'PRODUCT_IMAGE_REJECTED', resource: 'UploadedAsset', resourceId: asset.id, requestId: res.locals.requestId, metadata: { reason: parsed.data.reason } } });
      return update.count;
    });
    if (changed) await r2().send(new DeleteObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey })).catch(() => console.error(JSON.stringify({ level: 'error', event: 'REJECTED_PRODUCT_IMAGE_CLEANUP_FAILED', assetId: asset.id })));
    res.json({ data: { assetId: asset.id, status: 'REJECTED' } });
  } catch (error) { next(error); }
});

adminStorageRouter.delete('/products/:productId/images/:imageId', async (req, res, next) => {
  try {
    const image = await prisma.productImage.findFirst({ where: { id: req.params.imageId, productId: req.params.productId } });
    if (!image) return res.status(404).json({ error: { code: 'PRODUCT_IMAGE_NOT_FOUND', message: 'Product image not found.' } });
    const asset = await prisma.uploadedAsset.findFirst({ where: { objectKey: image.objectKey, purpose: 'PRODUCT_IMAGE' } });
    await prisma.$transaction(async tx => {
      await tx.productImage.delete({ where: { id: image.id } });
      if (asset) await tx.uploadedAsset.updateMany({ where: { id: asset.id, status: 'APPROVED' }, data: { status: 'DELETED', expiresAt: null } });
      await tx.auditLog.create({ data: { actorUserId: req.authUser!.id, action: 'PRODUCT_IMAGE_REMOVED', resource: 'ProductImage', resourceId: image.id, requestId: res.locals.requestId, metadata: { productId: req.params.productId, objectKey: image.objectKey } } });
    });
    const bucket = asset?.bucketName || env.R2_PUBLIC_BUCKET_NAME;
    if (bucket) await r2().send(new DeleteObjectCommand({ Bucket: bucket, Key: image.objectKey })).catch(() => console.error(JSON.stringify({ level: 'error', event: 'PUBLIC_PRODUCT_IMAGE_CLEANUP_FAILED', imageId: image.id })));
    res.status(204).end();
  } catch (error) { next(error); }
});

adminStorageRouter.get('/assets/:id/download', async (req, res, next) => {
  try {
    const asset = await prisma.uploadedAsset.findUnique({ where: { id: req.params.id } });
    if (!asset || !['QUARANTINED', 'APPROVED'].includes(asset.status)) return res.status(404).json({ error: { code: 'ASSET_NOT_FOUND', message: 'Asset not found.' } });
    const url = await getSignedUrl(r2(), new GetObjectCommand({ Bucket: asset.bucketName, Key: asset.objectKey, ResponseContentDisposition: `attachment; filename="${asset.originalName.replace(/[\r\n"\\]/g, '_')}"` }), { expiresIn: 120 });
    res.json({ data: { url, expiresInSeconds: 120, status: asset.status } });
  } catch (error) { next(error); }
});
