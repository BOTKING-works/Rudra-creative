import { Link } from 'react-router-dom';
import { formatINR } from '../services/api';
export type Product = { id: string; name: string; slug: string; sku: string; description: string; basePricePaise: number; salePricePaise: number | null; leadTimeDays: number; category?: { name: string } | null; images?: { url: string | null; altText: string; isPrimary: boolean }[]; variants?: { id: string; sku: string; name: string; material: string | null; color: string | null; pricePaise: number; salePricePaise: number | null; stockQuantity: number; reservedQuantity: number; isActive?: boolean }[] };
export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const image = product.images?.find((item) => item.isPrimary && item.url) ?? product.images?.find((item) => item.url);
  const price = product.salePricePaise ?? product.basePricePaise;
  return <article className="product-card" style={{ animationDelay: `${index * 55}ms` }}>
    <Link to={`/products/${product.slug}`} className={`product-image product-image--${index % 4}`} aria-label={`View ${product.name}`}>
      {image?.url ? <img src={image.url} alt={image.altText || product.name} loading="lazy" /> : <div className="product-placeholder"><span className="placeholder-orbit" /><span className="placeholder-cube">◇</span><small>DESIGNED TO FIT</small></div>}
      <span className="product-open" aria-hidden="true">↗</span>
    </Link>
    <div className="product-meta"><span>{product.category?.name || '3D PRINTED'}</span><span>{product.leadTimeDays}–{product.leadTimeDays + 2} day lead time</span></div>
    <Link to={`/products/${product.slug}`} className="product-title">{product.name}</Link>
    <p className="product-desc">{product.description}</p>
    <div className="product-bottom"><strong>{formatINR(price)}</strong><Link to={`/products/${product.slug}`} aria-label={`View ${product.name} details`}>View details <span aria-hidden="true">↗</span></Link></div>
  </article>;
}
