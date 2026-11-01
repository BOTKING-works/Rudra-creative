import 'dotenv/config';
import { prisma } from '../src/config/db.js';

// Explicitly opt-in demo data. These are examples, not the owner's actual catalog.
async function main() {
  const category = await prisma.category.upsert({ where: { slug: 'demo-prints' }, update: {}, create: { name: 'Demo Prints', slug: 'demo-prints', description: 'Clearly-labelled example category for local development.' } });
  const products = [
    { name: 'DEMO — Cable Organizer', slug: 'demo-cable-organizer', sku: 'DEMO-CO-001', description: 'Example 3D-printed cable organizer. Replace this record with approved real product content before launch.', basePricePaise: 19900, leadTimeDays: 3 },
    { name: 'DEMO — Desk Stand', slug: 'demo-desk-stand', sku: 'DEMO-DS-001', description: 'Example desk stand product. Product specifications, material availability, and safety notes require owner approval.', basePricePaise: 49900, leadTimeDays: 5 },
  ];
  for (const data of products) {
    const product = await prisma.product.upsert({ where: { slug: data.slug }, update: {}, create: { ...data, categoryId: category.id, status: 'ACTIVE' } });
    await prisma.productVariant.upsert({ where: { sku: `${data.sku}-PLA-BLK` }, update: {}, create: { productId: product.id, sku: `${data.sku}-PLA-BLK`, name: 'Demo variant — PLA / Black', material: 'PLA', color: 'Black', pricePaise: data.basePricePaise, stockQuantity: 0, isActive: true } });
  }
  console.log('Inserted demo-only catalog records. Review and remove/replace them before production.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
