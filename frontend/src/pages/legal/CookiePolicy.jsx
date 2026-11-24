import { Link } from 'react-router-dom';
import LegalLayout from './LegalLayout';
import { resetConsent, setConsent, useConsent } from '../../ui/consent';
import { LEGAL } from '../../config/legal';

export default function CookiePolicy() {
  const consent = useConsent();
  return (
    <LegalLayout title="Cookies and Browser Storage">
      <p className="legal__note">
        <strong>The short version:</strong> {LEGAL.product} sets <strong>no cookies</strong> and has no analytics, advertising or
        tracking. It uses your browser&apos;s storage only for the items below.
      </p>

      <h2>What is stored</h2>
      <table className="legal__table">
        <thead><tr><th>Name</th><th>Type</th><th>Purpose</th><th>Lasts</th><th>Needs consent?</th></tr></thead>
        <tbody>
          <tr><td><code>hrt_auth_token</code></td><td>Session storage</td><td>Keeps you signed in</td><td>Until you close the tab or sign out</td><td>No, strictly necessary</td></tr>
          <tr><td><code>hrt_demo</code></td><td>Session storage</td><td>Remembers that you opened the read-only demo</td><td>Until you close the tab</td><td>No, strictly necessary</td></tr>
          <tr><td><code>hrt-intro-seen</code></td><td>Session storage</td><td>Skips the landing-page intro animation after the first view</td><td>Until you close the tab</td><td>No, a short-lived display setting</td></tr>
          <tr><td><code>hrt-consent</code></td><td>Local storage</td><td>Remembers your answer to the cookie notice</td><td>Until you reset it</td><td>No, it records your choice</td></tr>
          <tr><td><code>hrt-theme</code></td><td>Local storage</td><td>Remembers light or dark theme</td><td>Until you clear it or choose &quot;Essential only&quot;</td><td><strong>Yes</strong>, saved only if you agree</td></tr>
          <tr><td><code>hrt-detection-scope</code></td><td>Local storage</td><td>Remembers which detections the dashboard shows (cracks only, plus awaiting review, or everything)</td><td>Until you clear it or choose &quot;Essential only&quot;</td><td><strong>Yes</strong>, saved only if you agree</td></tr>
        </tbody>
      </table>
      <p>Nothing in this table is shared with other websites, and nothing is used to follow you around the web.</p>

      <h2>Third parties</h2>
      <p>Fonts are served from this site, so your browser does not contact Google for them. The live service is hosted on Vercel and
        Render; they receive your IP address with each request as any web host does (see the <Link to="/privacy">Privacy Policy</Link>).</p>

      <h2>Your choice</h2>
      <p>Current choice:{' '}
        <strong>{consent === 'all' ? 'remember my preferences' : consent === 'essential' ? 'essential only' : 'not chosen yet'}</strong>.
        You can change it at any time:</p>
      <p>
        <button type="button" className="legal__btn" onClick={() => setConsent('all')}>Remember my preferences</button>
        <button type="button" className="legal__btn legal__btn--ghost" onClick={() => setConsent('essential')}>Essential only</button>
        <button type="button" className="legal__btn legal__btn--ghost" onClick={resetConsent}>Ask me again</button>
      </p>
      <p>Choosing &quot;Essential only&quot; removes the saved theme. You can also clear this site&apos;s data in your browser&apos;s settings at any
        time; you will then be signed out.</p>
    </LegalLayout>
  );
}
