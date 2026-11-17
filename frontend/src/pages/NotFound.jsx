import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../ui/usePageTitle';
import './NotFound.css';

const TunnelScene = lazy(() => import('../auth/TunnelScene'));

export default function NotFound() {
  usePageTitle('Page not found');
  return (
    <main className="nf">
      <Suspense fallback={null}><TunnelScene mono hud={false} /></Suspense>
      <div className="nf__body">
        <p className="nf__code">404 / chainage not found</p>
        <h1>No tunnel<br /><span>here.</span></h1>
        <p className="nf__text">The page you asked for is not at this address. The tunnel carries on in the other direction.</p>
        <div className="nf__actions">
          <Link to="/" className="nf__btn">Back to the start</Link>
          <Link to="/dashboard" className="nf__link">Open the console</Link>
        </div>
      </div>
    </main>
  );
}
