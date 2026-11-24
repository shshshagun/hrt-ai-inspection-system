import { Link } from 'react-router-dom';
import { resetConsent } from './consent';
import '../pages/legal/legal.css';

/** Small row of links to the legal pages, used in footers and on the sign-in pages. */
export default function LegalLinks({ className = '' }) {
  return (
    <nav className={`legal-links ${className}`} aria-label="Legal">
      <Link to="/privacy">Privacy Policy</Link>
      <Link to="/terms">Terms of Use</Link>
      <Link to="/cookies">Cookies</Link>
      <button type="button" onClick={resetConsent} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', opacity: 0.8, textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' }}>
        Cookie settings
      </button>
    </nav>
  );
}
