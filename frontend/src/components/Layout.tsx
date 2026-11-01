import { Link, Outlet } from 'react-router-dom';
import { Logo } from './Logo';
export function Layout() {
  return <div className="site-shell">
    <div className="announcement"><span className="announcement-dot" /> MADE WITH PRECISION · BUILT AROUND YOUR IDEAS</div>
    <header className="site-header"><Logo />
      <nav className="main-nav" aria-label="Main navigation"><Link to="/shop">Shop</Link><Link to="/custom-print">Custom printing</Link><Link to="/cart">Cart</Link><a href="#how-it-works">How it works</a></nav>
      <div className="header-actions"><Link className="account-link" to="/account">Account <span aria-hidden="true">↗</span></Link><Link className="header-cta" to="/custom-print">Start a project <span aria-hidden="true">↗</span></Link><button className="mobile-menu" aria-label="Open menu" onClick={() => document.body.classList.toggle('menu-open')}>☰</button></div>
    </header>
    <main><Outlet /></main>
    <footer className="site-footer"><div className="footer-main"><div><Logo compact /><p className="footer-note">Thoughtful design. Precise prints. Made for what comes next.</p></div><div className="footer-links"><strong>EXPLORE</strong><Link to="/shop">Product catalogue</Link><Link to="/custom-print">Custom printing</Link><Link to="/account">Your account</Link></div><div className="footer-links"><strong>INFORMATION</strong><Link to="/legal/shipping-policy">Shipping policy</Link><Link to="/legal/returns-policy">Returns & refunds</Link><Link to="/legal/privacy-policy">Privacy policy</Link><Link to="/legal/terms">Terms & conditions</Link></div><div className="footer-contact"><strong>HAVE A PROJECT IN MIND?</strong><p>Bring us your idea. We’ll help you take it from model to material.</p><Link to="/custom-print">Discuss a custom print ↗</Link></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Rudra Creative</span><span>Designed for ideas that take shape.</span><span>India · INR</span></div></footer>
  </div>;
}
