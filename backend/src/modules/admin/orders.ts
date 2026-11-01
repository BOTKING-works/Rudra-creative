import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';

export const adminOrdersRouter = Router();
adminOrdersRouter.use(requireAuth, requireAdmin);
const listQuery = z.object({ status: z.enum(['PENDING_PAYMENT','PAYMENT_PROCESSING','PAID','PAYMENT_FAILED','PAYMENT_EXPIRED','CANCELLATION_REQUESTED','CANCELLED','IN_PRODUCTION','READY_TO_SHIP','SHIPPED','DELIVERED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), page: z.coerce.number().int().min(1).default(1) });
const fulfillmentInput = z.object({ status: z.enum(['IN_PRODUCTION','READY_TO_SHIP','SHIPPED','DELIVERED']), carrier: z.string().trim().min(2).max(100).optional(), trackingNumber: z.string().trim().min(2).max(160).optional(), trackingUrl: z.string().url().max(1000).optional(), notes: z.string().trim().max(1000).optional() }).superRefine((v, ctx) => { if (v.trackingUrl && new URL(v.trackingUrl).protocol !== 'https:') ctx.addIssue({ code:'custom', path:['trackingUrl'], message:'Tracking URL must use HTTPS.' }); if(v.status==='SHIPPED'&&(!v.carrier||!v.trackingNumber)) ctx.addIssue({code:'custom',path:['trackingNumber'],message:'Carrier and tracking number are required before marking an order shipped.'}); });
const transitions: Record<string, string[]> = { PAID: ['IN_PRODUCTION'], IN_PRODUCTION: ['READY_TO_SHIP'], READY_TO_SHIP: ['SHIPPED'], SHIPPED: ['DELIVERED'] };
adminOrdersRouter.get('/', async (req, res, next) => {
  try {
    const parsed = listQuery.safeParse(req.query); if(!parsed.success) return res.status(400).json({error:{code:'VALIDATION_ERROR',message:'Invalid order list filters.'}});
    const {status,limit,page}=parsed.data; const where = status ? { status } : {};
    const [data,total] = await prisma.$transaction([
      prisma.order.findMany({where,orderBy:{createdAt:'desc'},take:limit,skip:(page-1)*limit,select:{id:true,orderNumber:true,status:true,currency:true,subtotalPaise:true,shippingPaise:true,taxPaise:true,totalPaise:true,createdAt:true,paidAt:true,shippingAddressSnapshot:true,user:{select:{id:true,email:true}},items:{select:{id:true,productNameSnapshot:true,skuSnapshot:true,quantity:true,lineTotalPaise:true}},payments:{orderBy:{createdAt:'desc'},take:1,select:{id:true,provider:true,status:true,providerOrderId:true,providerPaymentId:true,amountPaise:true,createdAt:true,verifiedAt:true}},shipments:{select:{id:true,carrier:true,trackingNumber:true,trackingUrl:true,status:true,shippedAt:true,deliveredAt:true},orderBy:{createdAt:'desc'},take:1}}}),
      prisma.order.count({where}),
    ]);
    res.json({data,pagination:{page,limit,total,pages:Math.ceil(total/limit)}});
  } catch(e){next(e);}
});

adminOrdersRouter.patch('/:id/fulfillment', async (req,res,next)=>{
  try {
    const parsed=fulfillmentInput.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:{code:'VALIDATION_ERROR',message:parsed.error.issues[0]?.message||'Invalid fulfillment update.'}});
    const current=await prisma.order.findUnique({where:{id:req.params.id},select:{id:true,orderNumber:true,status:true}});
    if(!current)return res.status(404).json({error:{code:'ORDER_NOT_FOUND',message:'Order not found.'}});
    if(!transitions[current.status]?.includes(parsed.data.status))return res.status(409).json({error:{code:'INVALID_ORDER_TRANSITION',message:`Cannot transition order from ${current.status} to ${parsed.data.status}. Refresh status and follow the documented order flow.`}});
    const now=new Date();
    const result=await prisma.$transaction(async tx=>{
      const updated=await tx.order.updateMany({where:{id:current.id,status:current.status},data:{status:parsed.data.status}});
      if(updated.count!==1)throw Object.assign(new Error('The order changed in another request. Refresh before trying again.'),{status:409});
      if(parsed.data.status==='SHIPPED'){
        const prior=await tx.shipment.findFirst({where:{orderId:current.id},orderBy:{createdAt:'desc'}});
        if(prior) await tx.shipment.update({where:{id:prior.id},data:{carrier:parsed.data.carrier,trackingNumber:parsed.data.trackingNumber,trackingUrl:parsed.data.trackingUrl||null,status:'SHIPPED',shippedAt:now,notes:parsed.data.notes||null}});
        else await tx.shipment.create({data:{orderId:current.id,carrier:parsed.data.carrier,trackingNumber:parsed.data.trackingNumber,trackingUrl:parsed.data.trackingUrl||null,status:'SHIPPED',shippedAt:now,notes:parsed.data.notes||null}});
      } else if(parsed.data.status==='DELIVERED'){
        const shipment=await tx.shipment.findFirst({where:{orderId:current.id},orderBy:{createdAt:'desc'}});
        if(!shipment)throw Object.assign(new Error('A shipment and tracking record must exist before marking delivery complete.'),{status:409});
        await tx.shipment.update({where:{id:shipment.id},data:{status:'DELIVERED',deliveredAt:now,notes:parsed.data.notes||shipment.notes}});
      }
      await tx.auditLog.create({data:{actorUserId:req.authUser!.id,action:'ORDER_FULFILLMENT_UPDATED',resource:'Order',resourceId:current.id,requestId:res.locals.requestId,metadata:{from:current.status,to:parsed.data.status,carrier:parsed.data.carrier||null,trackingNumber:parsed.data.trackingNumber||null}}});
      return tx.order.findUniqueOrThrow({where:{id:current.id},select:{id:true,orderNumber:true,status:true,totalPaise:true,updatedAt:true,shipments:{orderBy:{createdAt:'desc'},take:1,select:{carrier:true,trackingNumber:true,trackingUrl:true,status:true,shippedAt:true,deliveredAt:true}}}});
    });
    res.json({data:result});
  }catch(e){next(e);}
});
