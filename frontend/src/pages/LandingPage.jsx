/**
 * LandingPage.jsx: "Survey console".
 * One fixed Three.js tunnel stays behind the page and flies faster as you scroll,
 * while a chainage ruler on the left tracks how far down the tunnel you are.
 * Palette: jet black with sky blue, nothing else.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useDive } from '../ui/contexts';
import './LandingPage.css';

const TunnelScene = lazy(() => import('../auth/TunnelScene'));
const TUNNEL_M = 250;

const CHAPTERS = [
  { n: '01', tag: 'Capture', title: 'Bring the footage.', body: 'Upload a tunnel inspection video. HRT does not record anything itself; it works on the footage you already have, wherever it came from.', spec: ['Input: video file', 'Frames analysed in the browser', 'No special camera needed'] },
  { n: '02', tag: 'Detect', title: 'The model runs in your browser.', body: 'A YOLOv8n-seg network, run through ONNX Runtime Web, is tiled over every frame to find cracks and spalling. The weights are third-party and pretrained; the pipeline around them is ours.', spec: ['Model: YOLOv8n-seg', 'Tiled inference', 'Cracks and spalling'] },
  { n: '03', tag: 'Locate', title: 'Every defect gets an address.', body: 'A chainage in metres from the intake, and a clock position around the lining. Each finding is placed on a 3D twin of the tunnel so engineers can go and look.', spec: ['Origin at the intake', '+Z is chainage', 'Clock-face angle'] },
  { n: '04', tag: 'Track', title: 'Same crack, next inspection.', body: 'Findings from different inspections are matched by class, chainage and angle, so growth is measured instead of guessed. A before and after slider shows what changed.', spec: ['Match within 3 m', 'Growth in % of area', 'Before / after view'] },
  { n: '05', tag: 'Report', title: 'From finding to paper.', body: 'Engineers review, flag and annotate. Managers export reports. Every role sees only what it is allowed to, enforced on the server.', spec: ['Five roles', 'Flag and observe', 'PDF reports'] },
];

const MARQUEE = ['Cracks', 'Spalling', 'Chainage', 'Clock position', 'Repeat inspections', 'Digital twin', 'Role-based access'];

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.18 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, startDemo } = useAuth();
  const { dive } = useDive();
  const boost = useRef(0);
  const rulerRef = useRef(null);
  const markRef = useRef(null);
  const readoutRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  useReveal();

  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const tick = () => {
      const y = window.scrollY;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const p = Math.min(1, y / max);
      boost.current = Math.min(1, boost.current * 0.92 + Math.abs(y - last) / 90);
      last = y;
      if (markRef.current) markRef.current.style.transform = `translateY(${p * 100}%)`;
      if (readoutRef.current) readoutRef.current.textContent = `${String(Math.round(p * TUNNEL_M)).padStart(3, '0')} m`;
      setScrolled((s) => (s !== y > 40 ? y > 40 : s));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const enter = () => (user ? dive('/dashboard') : navigate('/login'));
  const demo = () => { startDemo(); dive('/dashboard', 'Loading the demo…'); };

  return (
    <div className="lp">
      <div className="lp-scene" aria-hidden="true">
        <Suspense fallback={null}><TunnelScene boost={boost} mono hud={false} /></Suspense>
      </div>

      <header className={`lp-nav${scrolled ? ' is-scrolled' : ''}`}>
        <Link to="/" className="lp-logo" aria-label="HRT home">HRT<span>/ inspection</span></Link>
        <nav aria-label="Primary">
          <button type="button" className="lp-pill" onClick={demo}>Try the demo</button>
          <button type="button" className="lp-pill lp-pill--solid" onClick={enter}>{user ? 'Dashboard' : 'Sign in'}</button>
        </nav>
      </header>

      <aside className="lp-ruler" aria-hidden="true">
        <div className="lp-ruler__track" ref={rulerRef}>
          {Array.from({ length: 26 }, (_, i) => <i key={i} className={i % 5 === 0 ? 'major' : ''} />)}
          <b className="lp-ruler__mark" ref={markRef}><em ref={readoutRef}>000 m</em></b>
        </div>
      </aside>

      <main>
        <section className="lp-hero">
          <p className="lp-mono lp-hero__tag">Tunnel inspection / BTCS706N / SVVV</p>
          <h1 className="lp-display">
            <span className="lp-line"><span>See inside</span></span>
            <span className="lp-line lp-line--outline"><span>the mountain.</span></span>
          </h1>
          <div className="lp-hero__foot">
            <p>AI-assisted inspection for hydropower tunnels. Video in, defects out, placed to the metre and tracked from one inspection to the next.</p>
            <div className="lp-hero__cta">
              <button type="button" className="lp-btn" onClick={enter}>{user ? 'Open the console' : 'Sign in'} <span aria-hidden="true">→</span></button>
              <button type="button" className="lp-link" onClick={demo}>or try the read-only demo</button>
            </div>
            <span className="lp-scroll lp-mono" aria-hidden="true">Scroll to fly down the tunnel</span>
          </div>
        </section>

        <div className="lp-marquee" aria-hidden="true">
          <div>{[...MARQUEE, ...MARQUEE, ...MARQUEE].map((m, i) => <span key={i}>{m}<i /></span>)}</div>
        </div>

        {CHAPTERS.map((c) => (
          <section className="lp-chapter" key={c.n} aria-labelledby={`ch-${c.n}`}>
            <div className="lp-chapter__num lp-display" data-reveal aria-hidden="true">{c.n}</div>
            <div className="lp-chapter__body">
              <p className="lp-mono lp-chapter__tag" data-reveal>{c.tag}</p>
              <h2 id={`ch-${c.n}`} className="lp-display lp-chapter__title" data-reveal>{c.title}</h2>
              <p className="lp-chapter__text" data-reveal>{c.body}</p>
              <ul className="lp-spec lp-mono" data-reveal>{c.spec.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </section>
        ))}

        <section className="lp-facts" aria-label="Key facts">
          {[['250 m', 'Tunnel modelled in 3D'], ['2.95 m', 'Lining radius for defect placement'], ['12', 'Clock positions around the lining'], ['5', 'Roles enforced by the API']].map(([v, l]) => (
            <div key={l} data-reveal><b className="lp-display">{v}</b><span className="lp-mono">{l}</span></div>
          ))}
        </section>

        <section className="lp-end">
          <p className="lp-mono" data-reveal>End of the tunnel</p>
          <button type="button" className="lp-giant lp-display" onClick={enter} data-reveal>
            <span>Enter the console</span><i aria-hidden="true">→</i>
          </button>
          <button type="button" className="lp-link" onClick={demo}>or open the read-only demo</button>
        </section>
      </main>

      <footer className="lp-foot lp-mono">
        <span>HRT AI Inspection System</span>
        <span>Shri Vaishnav Vidyapeeth Vishwavidyalaya / major project</span>
      </footer>
    </div>
  );
}
