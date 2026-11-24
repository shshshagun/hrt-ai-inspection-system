import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LEGAL } from '../../config/legal';
import './legal.css';

export default function LegalLayout({ title, children }) {
  useEffect(() => { document.title = `${title} · ${LEGAL.product}`; window.scrollTo(0, 0); }, [title]);
  return (
    <div className="legal">
      <header className="legal__bar">
        <Link to="/" className="legal__brand">HRT · AI INSPECTION SYSTEM</Link>
        <nav className="legal__nav" aria-label="Legal pages">
          <NavLink to="/privacy">Privacy Policy</NavLink>
          <NavLink to="/terms">Terms of Use</NavLink>
          <NavLink to="/cookies">Cookies</NavLink>
        </nav>
      </header>
      <main className="legal__body">
        <h1>{title}</h1>
        <p className="legal__meta">Version {LEGAL.version} · Last updated {LEGAL.lastUpdated}</p>
        {children}
      </main>
    </div>
  );
}
