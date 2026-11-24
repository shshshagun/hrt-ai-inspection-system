import { Link } from 'react-router-dom';
import LegalLayout from './LegalLayout';
import { LEGAL } from '../../config/legal';

export default function Terms() {
  return (
    <LegalLayout title="Terms of Use">
      <p className="legal__note">
        {LEGAL.product} is a student major project and a working prototype. Read the safety notice in section 3 before relying on any
        result.
      </p>

      <h2>1. Acceptance</h2>
      <p>By creating an account or using the service you agree to these terms and to the <Link to="/privacy">Privacy Policy</Link>. If you
        do not agree, do not use the service. The read-only demo is open to everyone.</p>

      <h2>2. Your account</h2>
      <ul>
        <li>Give accurate details and keep your password private; you are responsible for activity under your account.</li>
        <li>New accounts are read-only Viewers. Administrators grant more access, and may suspend or delete accounts that are misused.</li>
        <li>You must be at least 18 years old.</li>
      </ul>

      <h2>3. Safety notice: AI results are decision support</h2>
      <p>The defect detector is a research model that was not trained on hydroelectric tunnel footage. In testing on public
        underwater crack images it found roughly half of the cracks at the default setting (recall 0.53, precision 0.83), and
        position and size estimates depend on calibration and assumed vehicle speed. <strong>Results must be reviewed by a qualified
        engineer. Do not use the system as the only basis for decisions about the safety, operation or repair of any structure.</strong>
        AI-written summaries can contain errors and must be checked before they are used in a report.</p>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>Do not attempt to break, probe or overload the service, bypass access controls or use another person&apos;s account.</li>
        <li>Do not upload unlawful content, malware, or footage showing identifiable people without their permission.</li>
        <li>Do not use the service to submit data you have no right to use.</li>
      </ul>

      <h2>5. Your data and content</h2>
      <p>You keep your rights in the inspection data you add. You allow the service to store and process it to provide the
        features, including producing reports and, where enabled, sending defect data (not names, e-mails, images or notes) to
        the AI providers described in the Privacy Policy.</p>

      <h2>6. Open-source software</h2>
      <p>The source code is published at <a href={LEGAL.repoUrl} rel="noopener noreferrer">{LEGAL.repoUrl}</a> under the licence in
        that repository. Third-party components keep their own licences.</p>

      <h2>7. No warranty and limit of liability</h2>
      <p>The service is provided &quot;as is&quot;, without any promise that it will be available, error-free or fit for a particular purpose. To the
        extent the law allows, the project team is not liable for indirect or consequential loss, or for loss arising from reliance on
        AI results. Nothing here limits liability that cannot be limited by law.</p>

      <h2>8. Changes and ending</h2>
      <p>We may change the service or these terms; the date above shows the latest version, and continued use means you accept the
        change. You may stop using the service at any time and ask for your account to be deleted.</p>

      <h2>9. Governing law and contact</h2>
      <p>These terms are governed by the laws of India, and the courts at Indore have jurisdiction, without removing any rights you
        have under mandatory consumer or data-protection law where you live. Questions:{' '}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</p>
    </LegalLayout>
  );
}
