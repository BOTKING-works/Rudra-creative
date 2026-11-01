import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, formatINR } from './services/api';
import { Product, ProductCard } from './components/ProductCard';

type CatalogResponse = { data: Product[]; pagination: { page: number; limit: number; total: number; pages: number } };

export function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => { api<CatalogResponse>('/products?limit=3&sort=newest').then((r) => { setProducts(r.data); setState('ready'); }).catch(() => setState('error')); }, []);
  return <>
    <section className="hero"><div className="hero-grain" /><div className="hero-copy"><div className="eyebrow"><span /> DESIGNED. PRINTED. REFINED.</div><h1>Ideas take<br /> <em>shape.</em></h1><p className="hero-lede">From thoughtfully designed everyday objects to custom 3D prints made around your vision. Good ideas deserve to exist in the real world.</p><div className="hero-actions"><Link className="button button--gold" to="/shop">Explore the catalogue <span>↗</span></Link><Link className="text-link" to="/custom-print">Bring your own design <span>↗</span></Link></div><div className="hero-proof"><div className="proof-item"><strong>01</strong><span>Design-led<br />products</span></div><div className="proof-divider" /><div className="proof-item"><strong>02</strong><span>Made to your<br />specification</span></div><div className="proof-divider" /><div className="proof-item"><strong>03</strong><span>Detail in every<br />layer</span></div></div></div><div className="hero-art" aria-hidden="true"><div className="hero-ring hero-ring--outer" /><div className="hero-ring hero-ring--inner" /><div className="hero-monogram">RC</div><div className="hero-coordinate hero-coordinate--top">19° 04' N<br />72° 52' E</div><div className="hero-coordinate hero-coordinate--bottom">LAYER BY LAYER<br /><span>MADE IN INDIA</span></div><span className="hero-cross hero-cross--one">+</span><span className="hero-cross hero-cross--two">+</span><div className="hero-seal">R<br /><small>✦</small></div></div><div className="hero-index">01 / 04 <span /></div></section>
    <section className="ticker" aria-label="Our principles"><div className="ticker-track"><span>PRECISION IN EVERY LAYER</span><i>✳</i><span>YOUR DESIGN, OUR CRAFT</span><i>✳</i><span>MADE TO BE REIMAGINED</span><i>✳</i><span>PRECISION IN EVERY LAYER</span><i>✳</i><span>YOUR DESIGN, OUR CRAFT</span><i>✳</i></div></section>
    <section className="section featured-section"><div className="section-head"><div><div className="eyebrow eyebrow--dark"><span /> THE OBJECT LIBRARY</div><h2>Small things.<br /><em>Better thought.</em></h2></div><div className="section-side"><p>Functional forms, considered details and useful objects—designed with purpose and made layer by layer.</p><Link className="underlined-link" to="/shop">View all products <span>↗</span></Link></div></div>
      {state === 'loading' && <div className="state-panel"><span className="loader" />Loading the catalogue…</div>}
      {state === 'error' && <div className="state-panel state-panel--error"><strong>Catalogue unavailable</strong><p>We couldn't reach the product service. Please try again in a moment.</p><button className="button button--outline" onClick={() => { setState('loading'); api<CatalogResponse>('/products?limit=3&sort=newest').then(r => { setProducts(r.data); setState('ready'); }).catch(() => setState('error')); }}>Retry</button></div>}
      {state === 'ready' && products.length > 0 && <div className="product-grid product-grid--three">{products.map((product, index) => <ProductCard key={product.id} product={product} index={index} />)}</div>}
      {state === 'ready' && products.length === 0 && <div className="empty-catalog"><div className="empty-icon">◇</div><span>THE FIRST LAYER</span><h3>Good things are<br />taking shape.</h3><p>Our product catalogue is being prepared. In the meantime, tell us what you want to make.</p><Link className="button button--gold" to="/custom-print">Start a custom project <span>↗</span></Link></div>}
    </section>
    <section className="custom-banner" id="how-it-works"><div className="custom-banner-art"><div className="blueprint-circle" /><div className="blueprint-shape">⌬</div><span className="blueprint-label">FIG. 01 — YOUR MODEL</span><span className="blueprint-dim">X 120.0 mm<br />Y 084.5 mm</span></div><div className="custom-banner-copy"><div className="eyebrow"><span /> CUSTOM PRINTING STUDIO</div><h2>You imagine it.<br /><em>We make it real.</em></h2><p>Already have a 3D model? Send us your STL, 3MF or OBJ file and the details that matter. We’ll review it and prepare a quotation for your project.</p><div className="process-steps"><div><span>01</span><strong>Upload</strong><small>Share your model</small></div><div><span>02</span><strong>Review</strong><small>We assess your brief</small></div><div><span>03</span><strong>Make</strong><small>Approve & produce</small></div></div><Link className="button button--gold" to="/custom-print">Start a custom project <span>↗</span></Link></div></section>
    <section className="values-section"><div className="eyebrow eyebrow--dark"><span /> THE RUDRA APPROACH</div><h2>Built on details.<br /><em>Made for real life.</em></h2><div className="values-grid"><article><span className="value-number">01 / PURPOSE</span><div className="value-symbol">⌘</div><h3>Form follows function.</h3><p>We think about how an object feels, fits and works—not just how it looks on a screen.</p></article><article><span className="value-number">02 / PRECISION</span><div className="value-symbol">◎</div><h3>Details make the difference.</h3><p>Layer by layer, details matter. Material, finish and fit are part of the design conversation.</p></article><article><span className="value-number">03 / POSSIBILITY</span><div className="value-symbol">↗</div><h3>Your idea, your way.</h3><p>Custom printing turns a digital model into a tangible object, made around your requirements.</p></article></div></section>
    <section className="closing-cta"><div className="closing-emblem">RC</div><div><span className="eyebrow"><span /> EVERY GREAT OBJECT STARTS SOMEWHERE</span><h2>Have an idea<br />taking <em>shape?</em></h2></div><Link className="button button--light" to="/custom-print">Let's make it <span>↗</span></Link></section>
  </>;
}

export function ShopPage() {
  const location = useLocation(); const navigate = useNavigate(); const params = new URLSearchParams(location.search);
  const [search, setSearch] = useState(params.get('q') || '');
  const [sort, setSort] = useState(params.get('sort') || 'newest');
  const [category, setCategory] = useState(params.get('category') || '');
  const [material, setMaterial] = useState(params.get('material') || '');
  const [color, setColor] = useState(params.get('color') || '');
  const [minPrice, setMinPrice] = useState(params.get('minPrice') ? String(Number(params.get('minPrice')) / 100) : '');
  const [maxPrice, setMaxPrice] = useState(params.get('maxPrice') ? String(Number(params.get('maxPrice')) / 100) : '');
  const [availability, setAvailability] = useState(params.get('availability') || 'all');
  const [categories, setCategories] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<CatalogResponse['pagination'] | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [page, setPage] = useState(Number(params.get('page')) || 1);

  type Filters = { category: string; material: string; color: string; minPrice: string; maxPrice: string; availability: string };
  async function load(nextPage = page, nextSort = sort, nextSearch = search, filters: Filters = { category, material, color, minPrice, maxPrice, availability }) {
    setStatus('loading');
    const query = new URLSearchParams({ page: String(nextPage), limit: '24', sort: nextSort });
    if (nextSearch.trim()) query.set('q', nextSearch.trim());
    if (filters.category) query.set('category', filters.category);
    if (filters.material) query.set('material', filters.material);
    if (filters.color.trim()) query.set('color', filters.color.trim());
    if (filters.minPrice.trim() && Number.isFinite(Number(filters.minPrice)) && Number(filters.minPrice) >= 0) query.set('minPrice', String(Math.round(Number(filters.minPrice) * 100)));
    if (filters.maxPrice.trim() && Number.isFinite(Number(filters.maxPrice)) && Number(filters.maxPrice) >= 0) query.set('maxPrice', String(Math.round(Number(filters.maxPrice) * 100)));
    if (filters.availability === 'in-stock') query.set('availability', 'in-stock');
    navigate(`/shop?${query.toString()}`, { replace: true });
    try { const result = await api<CatalogResponse>(`/products?${query}`); setProducts(result.data); setPagination(result.pagination); setPage(nextPage); setStatus('ready'); }
    catch { setStatus('error'); }
  }
  useEffect(() => {
    api<{ data: Array<{ id: string; name: string; slug: string }> }>('/categories').then((r) => setCategories(r.data)).catch(() => setCategories([]));
    void load(page, sort, search);
  }, []);
  function submitSearch(e: FormEvent) { e.preventDefault(); void load(1, sort, search); }
  function submitFilters(e: FormEvent) { e.preventDefault(); void load(1, sort, search); }
  function clearFilters() {
    setCategory(''); setMaterial(''); setColor(''); setMinPrice(''); setMaxPrice(''); setAvailability('all');
    void load(1, sort, search, { category: '', material: '', color: '', minPrice: '', maxPrice: '', availability: 'all' });
  }
  return <section className="shop-page page-wrap">
    <div className="eyebrow eyebrow--dark"><span /> THE OBJECT LIBRARY</div>
    <div className="shop-title-row"><div><h1>Find your <em>form.</em></h1><p>Useful objects and considered design, made layer by layer.</p></div><span className="results-count">{pagination ? `${pagination.total} OBJECTS` : 'CATALOGUE'}</span></div>
    <form className="catalog-controls" onSubmit={submitSearch}><label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search products" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products, materials, SKU…"/><button type="submit">Search ↗</button></label><label className="sort-field"><span>Sort by</span><select value={sort} onChange={e => { setSort(e.target.value); void load(1, e.target.value, search); }}><option value="newest">Newest</option><option value="relevance">Relevance</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name</option></select></label></form>
    <form className="catalog-filters" onSubmit={submitFilters}>
      <label>Category<select value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c.id} value={c.slug}>{c.name}</option>)}</select></label>
      <label>Material<select value={material} onChange={e => setMaterial(e.target.value)}><option value="">Any material</option><option value="PLA">PLA</option><option value="PETG">PETG</option><option value="ABS">ABS</option><option value="TPU">TPU</option><option value="Resin">Resin</option></select></label>
      <label>Colour<input value={color} onChange={e => setColor(e.target.value)} placeholder="Any colour" maxLength={60}/></label>
      <label>Min price (₹)<input type="number" min="0" step="0.01" value={minPrice} onChange={e => setMinPrice(e.target.value)} placeholder="0"/></label>
      <label>Max price (₹)<input type="number" min="0" step="0.01" value={maxPrice} onChange={e => setMaxPrice(e.target.value)} placeholder="No limit"/></label>
      <label>Availability<select value={availability} onChange={e => setAvailability(e.target.value)}><option value="all">All products</option><option value="in-stock">In stock</option></select></label>
      <div className="filter-actions"><button className="button button--gold" type="submit">Apply filters ↗</button><button className="button button--outline" type="button" onClick={clearFilters}>Clear</button></div>
    </form>
    {status === 'loading' && <div className="state-panel"><span className="loader"/>Loading products…</div>}
    {status === 'error' && <div className="state-panel state-panel--error"><strong>We couldn't load the catalogue.</strong><p>Check the connection and try again.</p><button className="button button--outline" onClick={() => void load()}>Retry</button></div>}
    {status === 'ready' && products.length === 0 && <div className="empty-catalog empty-catalog--shop"><div className="empty-icon">◇</div><span>NO MATCHES JUST YET</span><h3>{search ? 'Nothing by that name.' : 'The shelves are being prepared.'}</h3><p>{search || category || material || color || minPrice || maxPrice || availability === 'in-stock' ? 'Try adjusting your search or filters, or ask us about a custom print.' : 'There are no published products in the catalogue yet.'}</p><button className="button button--outline" onClick={clearFilters}>Clear filters</button></div>}
    {status === 'ready' && products.length > 0 && <><div className="product-grid">{products.map((product, i) => <ProductCard key={product.id} product={product} index={i}/>)}</div>{pagination && pagination.pages > 1 && <div className="pagination"><button disabled={page <= 1} onClick={() => void load(page - 1)}>← Previous</button><span>PAGE {page} OF {pagination.pages}</span><button disabled={page >= pagination.pages} onClick={() => void load(page + 1)}>Next →</button></div>}</>}
  </section>;
}
export function ProductPage() {
  const { slug = '' } = useParams(); const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null); const [related, setRelated] = useState<Product[]>([]); const [error, setError] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState(''); const [quantity, setQuantity] = useState(1); const [cartBusy, setCartBusy] = useState(false); const [cartMessage, setCartMessage] = useState('');
  useEffect(() => { api<{ data: Product; related: Product[] }>(`/products/${encodeURIComponent(slug)}`).then(r => { setProduct(r.data); setRelated(r.related || []); setSelectedVariantId(r.data.variants?.find(v => v.stockQuantity > v.reservedQuantity)?.id || r.data.variants?.[0]?.id || ''); }).catch(e => setError(e instanceof ApiError ? e.message : 'Unable to load product details.')); }, [slug]);
  if (error) return <section className="page-wrap state-panel state-panel--error"><h1>Product unavailable</h1><p>{error}</p><Link className="button button--outline" to="/shop">Back to catalogue</Link></section>;
  if (!product) return <div className="page-wrap state-panel"><span className="loader" />Loading product details…</div>;
  const image = product.images?.find(i => i.url); const variant = product.variants?.find(v => v.id === selectedVariantId);
  const currentPrice = variant ? (variant.salePricePaise ?? variant.pricePaise) : (product.salePricePaise ?? product.basePricePaise);
  async function addToCart() {
    setCartBusy(true); setCartMessage('');
    try { if (!variant) { setCartMessage('This product has no purchasable variant configured yet. Please ask us about this design.'); return; }
      await api('/cart/items', { method: 'POST', body: JSON.stringify({ variantId: variant.id, quantity }) });
      navigate('/cart');
    } catch (e) { if (e instanceof ApiError && e.status === 401) navigate('/account?next=cart'); else setCartMessage(e instanceof Error ? e.message : 'Unable to add this option to your cart.'); }
    finally { setCartBusy(false); }
  }
  return <section className="product-detail page-wrap"><div className="breadcrumbs"><Link to="/">Home</Link><span>/</span><Link to="/shop">Shop</Link><span>/</span><span>{product.name}</span></div><div className="product-detail-grid"><div className="product-detail-image">{image?.url ? <img src={image.url} alt={image.altText || product.name} /> : <div className="product-placeholder product-placeholder--large"><span className="placeholder-orbit" /><span className="placeholder-cube">◇</span><small>RUDRA CREATIVE / OBJECT {product.sku}</small></div>}<span className="detail-image-index">OBJECT / {product.sku}</span></div><div className="product-detail-copy"><span className="eyebrow eyebrow--dark"><span /> {product.category?.name || 'THE OBJECT LIBRARY'}</span><h1>{product.name}</h1><p className="detail-description">{product.description}</p><div className="detail-price">{formatINR(currentPrice)}{variant?.salePricePaise !== null && variant?.salePricePaise !== undefined && <del>{formatINR(variant.pricePaise)}</del>}<small>Final tax and shipping are calculated at checkout using the business’s configured rules.</small></div><div className="detail-facts"><div><span>LEAD TIME</span><strong>{product.leadTimeDays} working days approx.</strong></div><div><span>SKU</span><strong>{variant?.sku || product.sku}</strong></div>{product.weightGrams && <div><span>WEIGHT</span><strong>{product.weightGrams} g</strong></div>}</div>{product.variants?.length ? <div className="variant-list"><label htmlFor="product-variant">AVAILABLE OPTIONS</label><select id="product-variant" value={selectedVariantId} onChange={e => { setSelectedVariantId(e.target.value); setQuantity(1); }} className="product-variant-select">{product.variants.map(v => <option key={v.id} value={v.id}>{v.name} — {[v.material, v.color].filter(Boolean).join(' · ') || v.sku} — {v.stockQuantity - v.reservedQuantity > 0 ? 'In stock' : 'Unavailable'}</option>)}</select>{variant && <p className="variant-stock-note">{variant.stockQuantity - variant.reservedQuantity > 0 ? `${variant.stockQuantity - variant.reservedQuantity} available` : 'Currently unavailable'}</p>}<div className="product-buy-row"><label>Quantity<select value={quantity} onChange={e => setQuantity(Number(e.target.value))}>{Array.from({length: Math.min(20, Math.max(1, (variant?.stockQuantity ?? 0) - (variant?.reservedQuantity ?? 0)))}, (_,i) => <option value={i+1} key={i+1}>{i+1}</option>)}</select></label><button className="button button--gold" disabled={!variant || (variant.stockQuantity - variant.reservedQuantity) < 1 || cartBusy} onClick={() => void addToCart()}>{cartBusy ? 'Adding…' : 'Add to cart'} <span>↗</span></button></div></div> : <div className="detail-note">This product has no purchasable variants yet. Ask us about a custom print or wait until an administrator publishes an available option.</div>}{cartMessage && <p className="commerce-error" role="alert">{cartMessage}</p>}<Link className="button button--outline button--wide" to={`/custom-print?product=${encodeURIComponent(product.slug)}`}>Ask about this design <span>↗</span></Link><p className="detail-fineprint">Stock is checked again by the server when an item is added to the cart and reserved transactionally during checkout.</p></div></div>{related.length > 0 && <section className="related-products"><div className="eyebrow eyebrow--dark"><span /> KEEP EXPLORING</div><h2>More to <em>discover.</em></h2><div className="product-grid">{related.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}</div></section>}</section>;
}

type CustomerOrder = { id: string; orderNumber: string; status: string; currency: string; totalPaise: number; createdAt: string; paidAt: string | null; items: Array<{productNameSnapshot:string;skuSnapshot:string;quantity:number;lineTotalPaise:number}>; shipments: Array<{carrier:string|null;trackingNumber:string|null;trackingUrl:string|null;status:string;shippedAt:string|null;deliveredAt:string|null}> };
type CustomerQuote = { id: string; revision: number; status: string; subtotalPaise: number; shippingPaise: number; taxPaise: number; totalPaise: number; leadTimeDays: number; terms: string | null; expiresAt: string | null };
type CustomerRequestDetail = { id: string; reference: string; status: string; orderId?: string | null; order?: { id: string; orderNumber: string; status: string; totalPaise: number; currency: string } | null; instructions: string | null; adminNotes: string | null; files: Array<{ id: string; asset: { originalName: string; contentType: string; sizeBytes: number; status: string } }>; quotations: CustomerQuote[] };

export function AccountPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const requestedNext = new URLSearchParams(location.search).get('next');
  const validCheckoutReturn = requestedNext !== null && /^\/checkout\?customRequestId=[A-Za-z0-9_-]{8,100}$/.test(requestedNext);
  const nextPath = requestedNext && (['/custom-print', 'cart', 'checkout'].some((value) => value === requestedNext || `/${value}` === requestedNext) || validCheckoutReturn) ? (requestedNext.startsWith('/') ? requestedNext : `/${requestedNext}`) : null;
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; role: string; emailVerified: boolean } | null>(null);
  const [requests, setRequests] = useState<Array<{ id: string; reference: string; status: string; material: string | null; color: string | null; quantity: number; orderId: string | null; createdAt: string; updatedAt: string }>>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [details, setDetails] = useState<Record<string, CustomerRequestDetail>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  async function loadSession() {
    try {
      const result = await api<{ user: { id: string; email: string; role: string; emailVerified: boolean } | null }>('/auth/me');
      setCurrentUser(result.user);
      if (result.user) {
        const [owned, orderList] = await Promise.allSettled([
          api<{ data: typeof requests }>('/custom-print/requests'),
          api<{ data: CustomerOrder[] }>('/orders'),
        ]);
        if (owned.status === 'fulfilled') setRequests(owned.value.data);
        else setError(owned.reason instanceof Error ? owned.reason.message : 'Unable to load custom-print requests.');
        if (orderList.status === 'fulfilled') setOrders(orderList.value.data);
        else setError(orderList.reason instanceof Error ? orderList.reason.message : 'Unable to load order history.');
      }
    } catch {
      setCurrentUser(null);
    } finally { setCheckingSession(false); }
  }
  useEffect(() => { void loadSession(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      if (mode === 'register') {
        const result = await api<{ challengeId: string; message: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
        navigate(`/verify?challengeId=${encodeURIComponent(result.challengeId)}${nextPath ? `&next=${encodeURIComponent(nextPath)}` : ''}`, { state: { email } });
      } else if (mode === 'login') {
        const result = await api<{ user: { id: string; email: string; role: string; emailVerified: boolean } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
        setCurrentUser(result.user);
        const [owned, orderList] = await Promise.all([api<{ data: typeof requests }>('/custom-print/requests'), api<{ data: CustomerOrder[] }>('/orders')]);
        setRequests(owned.data); setOrders(orderList.data);
        if (nextPath) navigate(nextPath);
      } else if (mode === 'forgot') {
        const result = await api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        setMessage(result.message + ' If the account is eligible, use the one-time token from the email below.');
        setMode('reset');
      } else {
        const result = await api<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, token: resetToken.trim(), newPassword: password }) });
        setMessage(result.message); setPassword(''); setResetToken(''); setMode('login');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); }
    finally { setBusy(false); }
  }

  async function loadDetails(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setError('');
    try {
      const result = await api<{ data: CustomerRequestDetail }>(`/custom-print/requests/${encodeURIComponent(id)}`);
      setDetails((old) => ({ ...old, [id]: result.data }));
      setExpanded(id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load this request.'); }
  }

  async function respondToQuote(requestId: string, quoteId: string, action: 'accept-quote' | 'decline-quote') {
    setError(''); setMessage(''); setBusy(true);
    try {
      await api(`/custom-print/requests/${encodeURIComponent(requestId)}/${action}`, { method: 'POST', body: JSON.stringify({ quotationId: quoteId }) });
      setMessage(action === 'accept-quote' ? 'Quotation accepted and converted into an order. Continue to delivery details and payment from your request below.' : 'Quotation declined.');
      const [owned, detail] = await Promise.all([
        api<{ data: typeof requests }>('/custom-print/requests'),
        api<{ data: CustomerRequestDetail }>(`/custom-print/requests/${encodeURIComponent(requestId)}`),
      ]);
      setRequests(owned.data);
      setDetails((old) => ({ ...old, [requestId]: detail.data }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update the quotation.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError('');
    try { await api('/auth/logout', { method: 'POST' }); setCurrentUser(null); setRequests([]); setOrders([]); setDetails({}); setExpanded(null); setMode('login'); setMessage('You have signed out.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign out.'); }
    finally { setBusy(false); }
  }

  if (checkingSession) return <section className="page-wrap state-panel"><span className="loader" />Checking your account…</section>;
  if (currentUser) return <section className="account-dashboard page-wrap">
    <div className="eyebrow eyebrow--dark"><span /> YOUR RUDRA ACCOUNT</div>
    <div className="account-heading"><div><h1>Your projects.<br /><em>Taking shape.</em></h1><p>Signed in as <strong>{currentUser.email}</strong></p></div><button className="button button--outline" disabled={busy} onClick={() => void logout()}>Sign out ↗</button></div>
    {error && <div className="form-alert form-alert--error" role="alert">{error}</div>}{message && <div className="form-alert" role="status">{message}</div>}
    <div className="account-status-row"><span>EMAIL VERIFIED <strong>{currentUser.emailVerified ? 'YES' : 'NO'}</strong></span><span>ACCOUNT ROLE <strong>{currentUser.role.replaceAll('_', ' ')}</strong></span><span>ORDER TRACKING <strong>AVAILABLE</strong></span></div>
    <section className="account-requests"><div className="section-head"><div><div className="eyebrow eyebrow--dark"><span /> CUSTOM PRINT STUDIO</div><h2>Your requests</h2></div><Link className="button button--gold" to="/custom-print">New project ↗</Link></div>
      {requests.length === 0 ? <div className="account-empty"><span>◇</span><h3>Nothing in the studio yet.</h3><p>Your custom-print requests will appear here, along with the review status and quotations.</p><Link className="underlined-link" to="/custom-print">Start your first project ↗</Link></div> : <div className="account-request-list">{requests.map((request) => <article className="account-request" key={request.id}>
        <div className="account-request-summary"><div><span className="request-reference">{request.reference}</span><h3>{request.material || 'Material to be confirmed'} <span>·</span> {request.color || 'Colour to be confirmed'}</h3><p>Quantity {request.quantity} · Submitted {new Date(request.createdAt).toLocaleDateString('en-IN')}</p></div><div className="account-request-status"><span className={`status-pill status-${request.status.toLowerCase()}`}>{request.status.replaceAll('_', ' ')}</span><button className="text-link" onClick={() => void loadDetails(request.id)}>{expanded === request.id ? 'Hide details −' : 'View details +'}</button></div></div>
        {expanded === request.id && details[request.id] && <div className="account-request-detail"><div><strong>REQUEST DETAILS</strong><p>{details[request.id].instructions || 'No additional instructions were added.'}</p>{details[request.id].adminNotes && <p><strong>Team note:</strong> {details[request.id].adminNotes}</p>}<small>{details[request.id].files.length} attached file(s); uploaded files remain private.</small>{details[request.id].status === 'CONVERTED_TO_ORDER' && details[request.id].order && <p><strong>Order {details[request.id].order.orderNumber}</strong><br /><span>{details[request.id].order.status.replaceAll('_', ' ')} · {formatINR(details[request.id].order.totalPaise)}</span><br />{details[request.id].order.status !== 'PAID' && <Link className="button button--gold" to={`/checkout?customRequestId=${encodeURIComponent(request.id)}`}>Continue to payment ↗</Link>}</p>}</div><div className="account-quotes"><strong>QUOTATIONS</strong>{details[request.id].quotations.length === 0 ? <p>No quotation is available yet.</p> : details[request.id].quotations.map((quote) => <div className="account-quote" key={quote.id}><div><span>REVISION {quote.revision} · {quote.status.replaceAll('_', ' ')}</span><strong>{formatINR(quote.totalPaise)}</strong><small>{quote.leadTimeDays} day lead time{quote.expiresAt ? ` · Expires ${new Date(quote.expiresAt).toLocaleDateString('en-IN')}` : ''}</small>{quote.terms && <p>{quote.terms}</p>}</div>{quote.status === 'SENT' && <div className="quote-actions"><button disabled={busy} onClick={() => void respondToQuote(request.id, quote.id, 'accept-quote')}>Accept</button><button disabled={busy} onClick={() => void respondToQuote(request.id, quote.id, 'decline-quote')}>Decline</button></div>}</div>)}</div></div>}
      </article>)}</div>}
    </section>
    <section className="account-orders"><div className="section-head"><div><div className="eyebrow eyebrow--dark"><span /> ORDER HISTORY</div><h2>Your orders</h2></div><Link className="button button--outline" to="/shop">Continue shopping ↗</Link></div>
      {orders.length === 0 ? <div className="account-empty"><span>▤</span><h3>No orders yet.</h3><p>Your ready-made product orders and shipment tracking will appear here after an order is placed.</p><Link className="underlined-link" to="/shop">Explore the catalogue ↗</Link></div> : <div className="account-order-list">{orders.map(order => <article className="account-order" key={order.id}><div className="account-order-header"><div><span className="request-reference">{order.orderNumber}</span><p>Placed {new Date(order.createdAt).toLocaleDateString('en-IN')}{order.paidAt ? ` · Paid ${new Date(order.paidAt).toLocaleDateString('en-IN')}` : ''}</p></div><div><span className={`status-pill status-${order.status.toLowerCase()}`}>{order.status.replaceAll('_',' ')}</span><strong>{formatINR(order.totalPaise)}</strong></div></div><div className="account-order-items">{order.items.map((item,i)=><div key={`${order.id}-${i}`}><span>{item.productNameSnapshot} × {item.quantity}<small>{item.skuSnapshot}</small></span><strong>{formatINR(item.lineTotalPaise)}</strong></div>)}</div>{order.shipments[0]&&<div className="account-order-tracking"><strong>SHIPMENT · {order.shipments[0].status.replaceAll('_',' ')}</strong><span>{order.shipments[0].carrier||'Carrier pending'}{order.shipments[0].trackingNumber?` · ${order.shipments[0].trackingNumber}`:''}</span>{order.shipments[0].trackingUrl&&<a href={order.shipments[0].trackingUrl} target="_blank" rel="noreferrer">Track shipment ↗</a>}</div>}</article>)}</div>}
    </section>
  </section>;

  return <section className="auth-page"><div className="auth-aside"><div className="auth-aside-mark">RC</div><span className="eyebrow"><span /> THE RUDRA ACCOUNT</span><h1>Your projects.<br /><em>In one place.</em></h1><p>Sign in to follow your custom-print requests and review quotations securely.</p><div className="auth-aside-foot">CRAFTED WITH INTENTION <span>✳</span></div></div><div className="auth-card"><div className="eyebrow eyebrow--dark"><span /> {mode === 'register' ? 'CREATE YOUR ACCOUNT' : mode === 'forgot' || mode === 'reset' ? 'ACCOUNT RECOVERY' : 'WELCOME BACK'}</div><h2>{mode === 'register' ? 'Start making.' : mode === 'forgot' || mode === 'reset' ? 'Reset your password.' : 'Good to see you.'}</h2><p className="auth-subtitle">{mode === 'register' ? 'Create an account to get your ideas moving.' : mode === 'forgot' ? 'We’ll send reset instructions to your email.' : mode === 'reset' ? 'Enter the one-time token from your email and choose a new password.' : 'Sign in to continue where you left off.'}</p><form onSubmit={submit} className="form-stack"><label>Email address<input autoComplete="email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>{mode === 'reset' && <label>One-time reset token<input autoComplete="one-time-code" required minLength={20} maxLength={200} value={resetToken} onChange={e => setResetToken(e.target.value)} placeholder="Paste the token from your email" /></label>}{mode !== 'forgot' && <label>{mode === 'reset' ? 'New password' : 'Password'}<input autoComplete={mode === 'register' || mode === 'reset' ? 'new-password' : 'current-password'} type="password" required minLength={mode === 'register' || mode === 'reset' ? 12 : 1} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' || mode === 'reset' ? 'At least 12 characters' : 'Your password'} /></label>}{error && <div className="form-alert form-alert--error" role="alert">{error}</div>}{message && <div className="form-alert" role="status">{message}</div>}<button className="button button--gold button--wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account ↗' : mode === 'forgot' ? 'Send reset instructions ↗' : mode === 'reset' ? 'Reset password ↗' : 'Sign in ↗'}</button></form><div className="auth-switch">{mode === 'login' ? <><button onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</button><p>New to Rudra Creative? <button onClick={() => { setMode('register'); setError(''); setMessage(''); }}>Create an account</button></p></> : <p>Already have an account? <button onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Sign in</button></p>}</div><p className="auth-legal">By continuing, you agree to the applicable terms and privacy policy once the approved business policies are published.</p></div></section>;
}
export function VerifyPage() {
  const navigate = useNavigate(); const location = useLocation(); const params = new URLSearchParams(location.search); const challengeId = params.get('challengeId') || ''; const requestedNext = params.get('next'); const nextPath = requestedNext && (['/custom-print', '/cart', '/checkout'].includes(requestedNext) || /^\/checkout\?customRequestId=[A-Za-z0-9_-]{8,100}$/.test(requestedNext)) ? requestedNext : '/account'; const emailFromState = (location.state as { email?: string } | null)?.email || '';
  const [otp, setOtp] = useState(''); const [email, setEmail] = useState(emailFromState); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function verify(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await api('/auth/verify-email-otp', { method: 'POST', body: JSON.stringify({ challengeId, otp }) }); navigate(nextPath); } catch (e) { setError(e instanceof Error ? e.message : 'Verification failed.'); } finally { setBusy(false); } }
  async function resend() { setError(''); setMessage(''); try { const r = await api<{ challengeId?: string; message: string }>('/auth/resend-email-otp', { method: 'POST', body: JSON.stringify({ email }) }); setMessage(r.message); if (r.challengeId) navigate(`/verify?challengeId=${encodeURIComponent(r.challengeId)}${requestedNext ? `&next=${encodeURIComponent(requestedNext)}` : ''}`, { replace: true, state: { email } }); } catch (e) { setError(e instanceof Error ? e.message : 'Could not resend.'); } }
  return <section className="auth-page auth-page--short"><div className="auth-aside"><div className="auth-aside-mark">✳</div><span className="eyebrow"><span /> ONE LAST STEP</span><h1>Verify it’s<br /><em>really you.</em></h1><p>We sent a time-limited verification code to your email address. Keep it private and use it only here.</p></div><div className="auth-card"><div className="eyebrow eyebrow--dark"><span /> EMAIL VERIFICATION</div><h2>Check your inbox.</h2><p className="auth-subtitle">Enter the six-digit code sent to your email. Codes expire after a short time.</p><form onSubmit={verify} className="form-stack"><label>Verification code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required /></label>{error && <div className="form-alert form-alert--error" role="alert">{error}</div>}{message && <div className="form-alert" role="status">{message}</div>}<button className="button button--gold button--wide" disabled={busy || !challengeId}>{busy ? 'Verifying…' : 'Verify email ↗'}</button></form><div className="resend-block"><label>Email for a new code<input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" /></label><button className="underlined-link" onClick={resend}>Resend verification code ↗</button></div><p className="auth-legal">Never share your verification code with anyone.</p></div></section>;
}

export function CustomPrintPage() {
  const [material, setMaterial] = useState(''); const [color, setColor] = useState(''); const [quantity, setQuantity] = useState(1); const [x, setX] = useState(''); const [y, setY] = useState(''); const [z, setZ] = useState(''); const [instructions, setInstructions] = useState(''); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState(''); const [sessionChecked, setSessionChecked] = useState(false); const [signedIn, setSignedIn] = useState(false); const [sessionEmail, setSessionEmail] = useState('');
  useEffect(() => { api<{ user: { email: string } | null }>('/auth/me').then(r => { setSignedIn(Boolean(r.user)); setSessionEmail(r.user?.email || ''); }).catch(() => setSignedIn(false)).finally(() => setSessionChecked(true)); }, []);
  async function submit(e: FormEvent) { e.preventDefault(); setError(''); setResult(''); if (!files.length) { setError('Attach at least one 3D model file (.STL, .3MF or .OBJ).'); return; } if (files.some(f => f.size > 50 * 1024 * 1024)) { setError('Each file must be 50 MB or smaller.'); return; } setBusy(true);
    try {
      const assetIds: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase(); const fallbackTypes: Record<string, string> = { stl: 'model/stl', '3mf': 'model/3mf', obj: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
        const contentType = file.type || fallbackTypes[ext || ''] || 'application/octet-stream';
        const purpose = ['stl', '3mf', 'obj'].includes(ext || '') ? 'CUSTOM_PRINT_MODEL' : 'REFERENCE_IMAGE';
        const presign = await api<{ data: { assetId: string; uploadUrl: string; headers: Record<string, string> } }>('/uploads/presign', { method: 'POST', body: JSON.stringify({ fileName: file.name, contentType, sizeBytes: file.size, purpose }) });
        const put = await fetch(presign.data.uploadUrl, { method: 'PUT', headers: presign.data.headers, body: file });
        if (!put.ok) throw new Error(`Upload failed for ${file.name}. Check storage configuration and try again.`);
        await api('/uploads/complete', { method: 'POST', body: JSON.stringify({ assetId: presign.data.assetId }) });
        assetIds.push(presign.data.assetId);
      }
      const created = await api<{ data: { reference: string } }>('/custom-print/requests', { method: 'POST', body: JSON.stringify({ material: material || undefined, color: color || undefined, quantity, dimensionsMm: x && y && z ? { x: Number(x), y: Number(y), z: Number(z), unit: 'mm' } : undefined, instructions: instructions || undefined, assetIds }) });
      setResult(`Request ${created.data.reference} has been submitted. Your files are private and quarantined for review.`); setFiles([]); setInstructions('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to submit the request.'); }
    finally { setBusy(false); }
  }
  return <><section className="custom-hero"><div className="custom-hero-copy"><div className="eyebrow"><span /> CUSTOM PRINTING STUDIO</div><h1>Make room for<br /><em>what’s possible.</em></h1><p>A prototype. A replacement part. A model that deserves to exist beyond your screen. Share your file and specifications; we’ll review your brief and prepare a quotation.</p><div className="custom-hero-note"><span>↳</span><div><strong>Have a model ready?</strong><small>STL · 3MF · OBJ · Up to 50 MB per file</small></div></div></div><div className="custom-hero-visual"><div className="technical-frame"><span className="frame-corner frame-corner--tl"/><span className="frame-corner frame-corner--tr"/><span className="frame-corner frame-corner--bl"/><span className="frame-corner frame-corner--br"/><div className="technical-object">⌬</div><div className="tech-label tech-label--top">MODEL NO. 001 — CONCEPT</div><div className="tech-label tech-label--bottom">Z / LAYER HEIGHT<br />X–Y / TOOL PATH</div><div className="measure measure--horizontal"/><div className="measure measure--vertical"/></div></div></section><section className="custom-workflow page-wrap"><div className="eyebrow eyebrow--dark"><span /> FROM DIGITAL TO TANGIBLE</div><div className="workflow-grid"><article><span>01</span><h3>Tell us what matters.</h3><p>Upload a supported model file and share material, colour, dimensions and the details we should know.</p></article><article><span>02</span><h3>We review your brief.</h3><p>Our team checks the submitted files and clarifies requirements before preparing a quotation.</p></article><article><span>03</span><h3>Approve before making.</h3><p>Review the quote, lead time and terms. Production begins only after the next steps are confirmed.</p></article></div></section><section className="request-section"><div className="request-intro"><div className="eyebrow"><span /> PROJECT INTAKE / 01</div><h2>Let’s get the<br /><em>details right.</em></h2><p>Fill in what you know. You can discuss anything uncertain during the review.</p><div className="request-note"><strong>PLEASE NOTE</strong><p>Files are private and remain quarantined for review after upload. File signature checks are not a guarantee that a model is safe, printable or manufacturable.</p></div></div><div className="request-form-panel">{!sessionChecked ? <div className="state-panel"><span className="loader" />Checking account…</div> : !signedIn ? <div className="sign-in-required"><div className="empty-icon">↗</div><span>ACCOUNT REQUIRED</span><h3>Start with a sign-in.</h3><p>Custom-print uploads are linked to an account so you can return to your request and quotation securely.</p><Link className="button button--gold button--wide" to="/account?next=custom-print">Sign in or create an account ↗</Link></div> : <form className="custom-form" onSubmit={submit}><div className="signed-in-note">SUBMITTING AS <strong>{sessionEmail}</strong></div><div className="form-section-heading"><span>01</span><strong>SPECIFICATIONS</strong></div><div className="form-two-col"><label>Material preference<select value={material} onChange={e => setMaterial(e.target.value)}><option value="">Open to recommendation</option><option value="PLA">PLA</option><option value="PETG">PETG</option><option value="ABS">ABS</option><option value="TPU">TPU</option><option value="Resin">Resin</option><option value="Other">Other / discuss</option></select></label><label>Colour preference<input value={color} onChange={e => setColor(e.target.value)} maxLength={60} placeholder="e.g. black, natural, no preference" /></label></div><div className="form-two-col"><label>Quantity<input type="number" min={1} max={1000} value={quantity} onChange={e => setQuantity(Math.min(1000, Math.max(1, Number(e.target.value))))} required /></label><div className="dimension-field"><span>Approx. dimensions <small>(mm)</small></span><div><input aria-label="Length in millimetres" type="number" min="0.1" max="5000" step="any" value={x} onChange={e => setX(e.target.value)} placeholder="X"/><b>×</b><input aria-label="Width in millimetres" type="number" min="0.1" max="5000" step="any" value={y} onChange={e => setY(e.target.value)} placeholder="Y"/><b>×</b><input aria-label="Height in millimetres" type="number" min="0.1" max="5000" step="any" value={z} onChange={e => setZ(e.target.value)} placeholder="Z"/></div></div></div><div className="form-section-heading"><span>02</span><strong>YOUR FILES</strong></div><label className="file-drop"><input type="file" multiple accept=".stl,.3mf,.obj,.png,.jpg,.jpeg,.webp" onChange={e => setFiles(Array.from(e.target.files || []))}/><span className="file-drop-icon">↥</span><strong>Drop a model here or browse files</strong><small>STL, 3MF, OBJ · Reference images: PNG, JPG, WEBP · Max 50 MB each</small>{files.length > 0 && <span className="file-list">{files.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`).join(' · ')}</span>}</label><div className="form-section-heading"><span>03</span><strong>THE BRIEF</strong></div><label>Anything else we should know?<textarea rows={4} maxLength={5000} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Use case, fit requirements, finish, tolerances, intended environment…" /></label>{error && <div className="form-alert form-alert--error" role="alert">{error}</div>}{result && <div className="form-alert" role="status">{result}</div>}<button className="button button--gold button--wide" disabled={busy}>{busy ? 'Uploading & submitting…' : 'Submit project for review ↗'}</button><p className="form-disclaimer">Submitting a request does not confirm a price, production slot, material availability or manufacturability. A quote will be prepared after review.</p></form>}</div></section></>;
}

export function LegalPage() {
  const { slug = '' } = useParams(); const [page, setPage] = useState<{ title: string; body: string } | null>(null); const [error, setError] = useState(false);
  useEffect(() => { api<{ data: { title: string; body: string } }>(`/content/${encodeURIComponent(slug)}`).then(r => setPage(r.data)).catch(() => setError(true)); }, [slug]);
  return <section className="page-wrap legal-page"><div className="eyebrow eyebrow--dark"><span /> INFORMATION</div>{page ? <><h1>{page.title}</h1><div className="legal-body">{page.body}</div></> : <><h1>{slug.replaceAll('-', ' ') || 'Information'}</h1><div className="form-alert">{error ? 'This page has not been published yet. Final legal text must be supplied and approved by the business owner before launch.' : 'Loading page…'}</div><Link className="underlined-link" to="/">Return home ↗</Link></>}</section>;
}
