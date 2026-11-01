import logo from '../../brand/rudra-creative-logo.png';
export function Logo({ compact = false }: { compact?: boolean }) {
  return <a className={`brand-lockup${compact ? ' brand-lockup--compact' : ''}`} href="/" aria-label="Rudra Creative home">
    <img src={logo} alt="Rudra Creative logo" />
    <span className="brand-name"><strong>RUDRA</strong><small>CREATIVE · 3D PRINTING</small></span>
  </a>;
}
