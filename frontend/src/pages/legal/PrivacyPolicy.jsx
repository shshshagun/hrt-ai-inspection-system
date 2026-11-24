import { Link } from 'react-router-dom';
import LegalLayout from './LegalLayout';
import { LEGAL } from '../../config/legal';

export default function PrivacyPolicy() {
  return (
    <LegalLayout title="Privacy Policy">
      <p className="legal__note">
        This policy describes what the {LEGAL.product} does with personal data. Anyone who deploys their own copy of the
        software becomes responsible for that copy and should review and adapt this policy for their organisation.
      </p>

      <h2>1. Who is responsible</h2>
      <p>{LEGAL.operator} runs this service and decides how personal data is used. Contact for all privacy requests:{' '}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. This address also serves as the grievance
        contact under India&apos;s Digital Personal Data Protection Act, 2023 (DPDP Act).</p>

      <h2>2. What we collect</h2>
      <table className="legal__table">
        <thead><tr><th>Data</th><th>Why</th><th>Where it is kept</th></tr></thead>
        <tbody>
          <tr><td><strong>Account data:</strong> name, e-mail address, role, a bcrypt hash of your password (never the password itself), account creation time and the time of the last password change</td><td>To sign you in and control what you may do</td><td>MongoDB Atlas</td></tr>
          <tr><td><strong>Password-reset data:</strong> a hash of the 6-digit code, its expiry and the count of wrong attempts</td><td>To let you reset a forgotten password</td><td>MongoDB Atlas; the code expires after 10 minutes</td></tr>
          <tr><td><strong>Inspection data:</strong> detections (type, confidence, size, tunnel position, time, review status and, once an engineer has reviewed it, who reviewed it, when and why it was rejected), inspection sessions and the small defect snapshot images cut from video frames</td><td>To provide the inspection, 3D twin and reports</td><td>MongoDB Atlas</td></tr>
          <tr><td><strong>Technical data:</strong> IP address and request details</td><td>To deliver the site, limit abuse (sign-in and sign-up limits) and keep it secure</td><td>Server logs at our hosts (Vercel and Render); short-lived counters in server memory</td></tr>
          <tr><td><strong>Assistant questions:</strong> the text you type into Ask HRT, plus the defect data it needs to answer</td><td>To answer your question</td><td>Sent to the AI provider (see section 5); not stored by us</td></tr>
        </tbody>
      </table>
      <p>Inspection videos and photos you select are analysed in your browser; the video file itself is not uploaded. We do not
        knowingly collect sensitive personal data. Defect snapshots show tunnel concrete; please do not include people in
        inspection footage.</p>
      <p>In the read-only <strong>demo</strong> no account is needed and no personal data is collected or stored; the demo uses sample data
        and every change is refused.</p>

      <h2>3. Why we use it, and on what basis</h2>
      <ul>
        <li><strong>Providing the service you asked for</strong> (account, sign-in, inspections, reports): contract (GDPR Art. 6(1)(b)); under the DPDP Act, your consent when you create the account.</li>
        <li><strong>Security and abuse prevention</strong> (rate limits, logs, failed-sign-in limits): legitimate interests (GDPR Art. 6(1)(f)); legitimate use under the DPDP Act.</li>
        <li><strong>Remembering your colour theme and which detections you view</strong>: your consent, given in the cookie notice and withdrawable at any time (see <Link to="/cookies">Cookies</Link>).</li>
        <li><strong>Password reset e-mails</strong>: contract / your request.</li>
      </ul>
      <p>We do not sell personal data, do not use it for advertising, and do not make decisions about you by automated means. The AI
        models flag defects in tunnel images (a detector, then a small crack / not-crack classifier that runs in your browser);
        their results are reviewed by engineers.</p>

      <h2>4. Cookies and similar storage</h2>
      <p>We set no cookies and run no analytics or advertising trackers. Fonts are served from this site, so your browser does not
        contact Google for them. The browser storage we use is listed on the <Link to="/cookies">Cookies</Link> page.</p>

      <h2>5. Who we share data with</h2>
      <p>We use service providers (&quot;processors&quot;) only to run the service:</p>
      <ul>
        <li><strong>Vercel</strong> (web hosting) and <strong>Render</strong> (API hosting): your requests, including IP address, pass through them.</li>
        <li><strong>MongoDB Atlas</strong>: database storage of the data in section 2.</li>
        <li><strong>An SMTP e-mail provider</strong> (configured by the operator): receives your e-mail address and the code when you request a password reset.</li>
        <li><strong>Google (Gemini) and Groq</strong>, only if the operator has enabled Ask HRT or AI report drafting: they receive your question and defect data (types, sizes, positions, counts). They do not receive names, e-mail addresses, images or notes. On free plans a provider may use submitted content to improve its products, which is why that limit exists.</li>
        <li><strong>GitHub</strong> hosts the source code; it receives nothing from visitors to the app.</li>
      </ul>
      <p>These providers run servers in several countries, including outside India and the European Economic Area. We share data
        with them only as needed for the purposes above. We disclose personal data to authorities only when the law requires it.</p>

      <h2>6. How long we keep it</h2>
      <ul>
        <li>Account data: until the account is deleted at your request or by an administrator.</li>
        <li>Password-reset codes: 10 minutes, or until used.</li>
        <li>Inspection data: until an administrator deletes the detection or inspection.</li>
        <li>Server logs: according to the hosting providers&apos; own retention settings, which we do not control.</li>
        <li>Browser storage: sign-in token and demo flag until you close the tab; theme preference until you clear it or withdraw consent.</li>
      </ul>

      <h2>7. Your rights</h2>
      <p>Depending on where you live (including under the DPDP Act and, for people in the EEA/UK, the GDPR) you may:</p>
      <ul>
        <li>ask what personal data we hold about you and receive a copy;</li>
        <li>have inaccurate data corrected or completed;</li>
        <li>have your data erased and your account deleted;</li>
        <li>withdraw consent (for example the theme preference, from the cookie notice) without affecting earlier use;</li>
        <li>object to or ask us to restrict processing that rests on legitimate interests, and ask for your data in a portable format (GDPR);</li>
        <li>nominate someone to exercise your rights if you cannot (DPDP Act);</li>
        <li>complain to us first at the address above, and then to the Data Protection Board of India or, in the EEA/UK, your local supervisory authority.</li>
      </ul>
      <p>E-mail <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> from the address on your account. We aim to reply within 30 days.
        Administrator accounts are set up by the server operator and are handled by them directly. At present these requests are
        handled by hand; there is no self-service export or delete button.</p>

      <h2>8. Security</h2>
      <p>Passwords are stored only as bcrypt hashes. Sessions use signed tokens that expire (8 hours by default) and are kept in your
        tab&apos;s session storage. Traffic uses HTTPS. The server applies HTTP security headers, rate limits sign-in, sign-up and
        password-reset requests, answers the same way whether or not an e-mail address has an account, and refuses access by role.
        No system is perfectly secure; if a breach affecting your personal data occurs we will tell you and the relevant
        authority as the law requires.</p>

      <h2>9. Children</h2>
      <p>The service is built for engineers and is not meant for anyone under 18. We do not knowingly collect children&apos;s data; if you
        believe a child has an account, tell us and we will delete it.</p>

      <h2>10. Changes</h2>
      <p>If we change this policy the date above changes, and for significant changes we will say so on the sign-in page. The
        history is in the <a href={LEGAL.repoUrl} rel="noopener noreferrer">public source repository</a>.</p>
    </LegalLayout>
  );
}
