import { Link } from 'react-router-dom';
import { setConsent, useConsent } from './consent';
import '../pages/legal/legal.css';

/**
 * Storage notice. The site sets no cookies and has no analytics or advertising. It needs the browser's
 * session storage to keep you signed in; with the visitor's agreement it also remembers the colour theme.
 */
export default function CookieBanner() {
  const consent = useConsent();
  if (consent) return null;
  return (
    <div className="cookie-bar" role="dialog" aria-label="Cookies and browser storage" aria-live="polite">
      <p>
        This site sets <strong>no cookies</strong> and has no tracking or advertising. It keeps your sign-in in this tab&apos;s
        session storage, which it needs to work. May it also remember your light/dark choice on this device?{' '}
        <Link to="/cookies">Details</Link> · <Link to="/privacy">Privacy Policy</Link>
      </p>
      <div className="cookie-bar__row">
        <button type="button" className="cookie-bar__primary" onClick={() => setConsent('all')}>Remember my preferences</button>
        <button type="button" onClick={() => setConsent('essential')}>Essential only</button>
      </div>
    </div>
  );
}
