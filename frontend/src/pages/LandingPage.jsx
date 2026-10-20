/**
 * LandingPage.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Canvas-based scroll-driven frame scrubber.
 * 192 frames at 24 fps → 8 s of footage served from /frames/desktop/
 *
 * Architecture:
 *  1. A <canvas> fills 100vh, position:sticky at top:0.
 *  2. A scroll-driver div provides height (SCROLL_MULT × 100vh) below.
 *  3. requestAnimationFrame reads scrollY, maps it to a frame index,
 *     draws that frame to the canvas.
 *  4. Text panels fade in/out at specific scroll progress checkpoints
 *     using CSS transitions driven by React state.
 *  5. Preloads all frames lazily in priority order:
 *     first, current ± 5; then the rest in chunks.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './LandingPage.css';

/* ─── config ──────────────────────────────────────────────── */
const TOTAL_FRAMES  = 192;
const SCROLL_MULT   = 8;       // height = SCROLL_MULT × 100vh — full tunnel plays first
const FRAME_BASE    = '/frames/desktop/frame_';
const FRAME_PAD     = 4;       // frame_0001.webp
const FRAME_EXT     = '.webp';
const POSTER        = '/frames/poster.webp';
const MOBILE_BASE   = '/frames/mobile/frame_';

// Progress threshold after which below-fold slides in (0–1)
const BELOW_FOLD_TRIGGER = 0.92;

// Scroll-progress thresholds for text panels (0–1)
const PANELS = [
  {
    id: 'hero',
    from: 0,
    to:   0.08,
    content: {
      eyebrow: null,
      headline: 'AI-Powered Inspection for\nHydropower Infrastructure',
      body: 'From reservoir surface to tunnel depth — intelligent structural inspection for safer hydroelectric infrastructure.',
      cta: 'Enter Dashboard',
    },
    position: 'left',
  },
  {
    id: 'descent',
    from: 0.18,
    to:   0.38,
    content: {
      eyebrow: 'SUBMERGING',
      headline: 'The tunnel is filled with water.\nSo is the inspection.',
      body: 'ROV drones traverse the live waterway, capturing continuous footage of tunnel walls without drainage.',
      cta: null,
    },
    position: 'center',
  },
  {
    id: 'detection',
    from: 0.50,
    to:   0.72,
    content: {
      eyebrow: 'AI DETECTION ACTIVE',
      headline: 'AI sees what human eyes cannot',
      body: 'YOLOv8s detects structural cracks, spalling, leakage and corrosion in real-time from ROV footage inside the filled tunnel.',
      cta: null,
    },
    position: 'left',
  },
  {
    id: 'cta',
    from: 0.82,
    to:   1.0,
    content: {
      eyebrow: 'INSPECTION COMPLETE',
      headline: 'Enter the HRT Dashboard',
      body: 'Review detections, inspect findings, explore the 3D tunnel view, and generate reports.',
      cta: 'Open Inspection Dashboard →',
    },
    position: 'center',
  },
];

function frameUrl(index, isMobile = false) {
  const n = String(Math.max(1, Math.min(TOTAL_FRAMES, index + 1))).padStart(FRAME_PAD, '0');
  return `${isMobile ? MOBILE_BASE : FRAME_BASE}${n}${FRAME_EXT}`;
}

function getPanelState(progress) {
  return PANELS.map(p => ({
    ...p,
    visible: progress >= p.from && progress <= p.to,
    opacity: (() => {
      if (progress < p.from) return 0;
      if (progress > p.to)   return 0;
      const fadeLen = (p.to - p.from) * 0.25;
      if (progress < p.from + fadeLen) return (progress - p.from) / fadeLen;
      if (progress > p.to - fadeLen)   return (p.to - progress) / fadeLen;
      return 1;
    })(),
  }));
}

export default function LandingPage() {
  const navigate     = useNavigate();
  const canvasRef    = useRef(null);
  const imagesRef    = useRef(new Array(TOTAL_FRAMES).fill(null));
  const loadedRef    = useRef(new Array(TOTAL_FRAMES).fill(false));
  const currentFrame = useRef(0);
  const rafRef       = useRef(null);
  const isMobile     = useRef(window.innerWidth < 768);

  const [panels, setPanels]         = useState(getPanelState(0));
  const [scrollProgress, setScrollProgress] = useState(0);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const [belowFoldIn, setBelowFoldIn]   = useState(false);

  /* ── Draw a frame index to canvas ── */
  const drawFrame = useCallback((index) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = imagesRef.current[index];
    if (!img) return;
    const ctx = canvas.getContext('2d');
    const { width: cw, height: ch } = canvas;
    // cover-fit: maintain aspect, fill canvas
    const iw = img.naturalWidth  || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.max(cw / iw, ch / ih);
    const sw = iw * scale, sh = ih * scale;
    const dx = (cw - sw) / 2, dy = (ch - sh) / 2;
    ctx.drawImage(img, dx, dy, sw, sh);
  }, []);

  /* ── Preload strategy ── */
  const preload = useCallback((centerIdx) => {
    const prioritized = [];
    // Priority 1: current ± 8
    for (let d = 0; d <= 8; d++) {
      [centerIdx + d, centerIdx - d].forEach(i => {
        if (i >= 0 && i < TOTAL_FRAMES && !loadedRef.current[i]) prioritized.push(i);
      });
    }
    // Priority 2: all remaining
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      if (!loadedRef.current[i] && !prioritized.includes(i)) prioritized.push(i);
    }

    let slot = 0;
    function loadNext() {
      if (slot >= prioritized.length) return;
      const idx = prioritized[slot++];
      if (loadedRef.current[idx]) { loadNext(); return; }
      const img = new Image();
      img.onload = () => {
        imagesRef.current[idx] = img;
        loadedRef.current[idx] = true;
        // If this is the current visible frame, re-draw
        if (idx === currentFrame.current) drawFrame(idx);
        loadNext();
      };
      img.onerror = loadNext;
      img.src = frameUrl(idx, isMobile.current);
    }

    // Run 4 concurrent loaders
    for (let i = 0; i < 4; i++) loadNext();
  }, [drawFrame]);

  /* ── Poster (first frame placeholder) ── */
  useEffect(() => {
    const poster = new Image();
    poster.onload = () => {
      imagesRef.current[0] = poster;
      loadedRef.current[0] = true;
      setPosterLoaded(true);
      drawFrame(0);
    };
    poster.src = POSTER;
  }, [drawFrame]);

  /* ── Start preloading all frames once poster is shown ── */
  useEffect(() => {
    if (posterLoaded) preload(0);
  }, [posterLoaded, preload]);

  /* ── Canvas resize ── */
  useEffect(() => {
    function resize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      isMobile.current = window.innerWidth < 768;
      drawFrame(currentFrame.current);
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [drawFrame]);

  /* ── RAF scroll loop ── */
  useEffect(() => {
    let lastFrame = -1;
    let lastProgress = -1;

    function tick() {
      const scrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? Math.min(1, scrollY / maxScroll) : 0;
      const frameIdx = Math.round(progress * (TOTAL_FRAMES - 1));

      if (frameIdx !== lastFrame) {
        currentFrame.current = frameIdx;
        drawFrame(frameIdx);
        lastFrame = frameIdx;
        // Trigger nearby preload
        preload(frameIdx);
      }

      if (Math.abs(progress - lastProgress) > 0.001) {
        setScrollProgress(progress);
        setPanels(getPanelState(progress));
        setBelowFoldIn(progress >= BELOW_FOLD_TRIGGER);
        lastProgress = progress;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame, preload]);

  const activePanel = panels.find(p => p.visible) || null;

  return (
    <div className="lp-root">
      {/* ── Sticky canvas stage ── */}
      <div className="lp-stage" aria-hidden="false">

        {/* Canvas — full viewport, always in front */}
        <canvas
          ref={canvasRef}
          className="lp-canvas"
          role="img"
          aria-label="Cinematic scroll experience: dam to HRT tunnel"
        />

        {/* Dark vignette overlay to make text readable */}
        <div className="lp-vignette" aria-hidden="true" />

        {/* ── Navbar ── */}
        <nav className="lp-nav" aria-label="Site navigation">
          <div className="lp-nav__brand">
            <span className="lp-nav__logo">HRT</span>
            <span className="lp-nav__sub">AI INSPECTION SYSTEM</span>
          </div>
          <ul className="lp-nav__links" role="list">
            <li><a href="#how-it-works" className="lp-nav__link">Technology</a></li>
            <li><a href="#impact" className="lp-nav__link">Impact</a></li>
            <li><a href="#about" className="lp-nav__link">About</a></li>
          </ul>
          <button
            className="lp-nav__cta"
            onClick={() => navigate('/dashboard')}
            id="nav-enter-dashboard"
          >
            Enter Dashboard
          </button>
        </nav>

        {/* ── Text panels (animated by scroll progress) ── */}
        {panels.map(panel => (
          <div
            key={panel.id}
            className={`lp-panel lp-panel--${panel.position}`}
            style={{
              opacity: panel.opacity,
              pointerEvents: panel.opacity > 0.1 ? 'auto' : 'none',
              transform: `translateY(${(1 - panel.opacity) * 24}px)`,
            }}
            aria-hidden={!panel.visible}
          >
            {panel.content.eyebrow && (
              <p className="lp-panel__eyebrow">{panel.content.eyebrow}</p>
            )}
            <h2 className="lp-panel__headline">
              {panel.content.headline.split('\n').map((line, i) => (
                <span key={i}>{line}<br /></span>
              ))}
            </h2>
            <p className="lp-panel__body">{panel.content.body}</p>
            {panel.content.cta && (
              <button
                className="lp-panel__cta"
                onClick={() => navigate('/dashboard')}
                id={`panel-${panel.id}-cta`}
              >
                {panel.content.cta}
              </button>
            )}
          </div>
        ))}

        {/* ── Scroll indicator (only at very top) ── */}
        <div
          className="lp-scroll-hint"
          style={{ opacity: panels[0]?.opacity ?? 0 }}
          aria-hidden="true"
        >
          <span className="lp-scroll-hint__line" />
          <span className="lp-scroll-hint__label">Scroll to descend</span>
        </div>

        {/* ── Frame / progress indicator ── */}
        <div className="lp-progress-bar" aria-hidden="true">
          <div
            className="lp-progress-bar__fill"
            style={{ width: `${Math.round(scrollProgress * 100)}%` }}
          />
        </div>
      </div>

      {/* ── Scroll driver: SCROLL_MULT × viewport heights ── */}
      <div
        className="lp-scroll-driver"
        style={{ height: `${SCROLL_MULT * 100}vh` }}
        aria-hidden="true"
      />

      {/* ── Below-fold: content sections ── */}
      <div className={`lp-below-fold${belowFoldIn ? ' lp-below-fold--in' : ''}`}>
        <section id="how-it-works" className="lp-section">
          <h2 className="lp-section__heading">How it works</h2>
          <div className="lp-tech-grid">
            {[
              { n: '01', title: 'ROV Inspection', body: 'An underwater drone traverses the water-filled HRT, recording high-resolution video of tunnel walls and floor.' },
              { n: '02', title: 'YOLOv8s Inference', body: 'A custom-trained model processes every frame, detecting cracks, spalling, leakage, and corrosion with bounding boxes and confidence scores.' },
              { n: '03', title: 'Spatial Mapping', body: 'Each detection is tagged with ROV chainage position and logged to the inspection database via REST API.' },
              { n: '04', title: 'Dashboard Review', body: 'Inspectors review detections, verify AI findings, generate reports, and export records.' },
            ].map(s => (
              <div className="lp-tech-step" key={s.n}>
                <span className="lp-tech-step__num">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="impact" className="lp-section lp-section--dark">
          <h2 className="lp-section__heading">Impact</h2>
          <div className="lp-impact-block">
            {[
              { v: '91%',   l: 'mAP@0.5 detection accuracy' },
              { v: '12,012',l: 'training images (Roboflow)' },
              { v: '~11M',  l: 'model parameters — fast & lightweight' },
            ].map(s => (
              <div className="lp-impact-stat" key={s.v}>
                <span className="lp-impact-stat__value">{s.v}</span>
                <span className="lp-impact-stat__label">{s.l}</span>
              </div>
            ))}
          </div>
          <p className="lp-impact-text">
            Hydroelectric tunnels are typically inspected by draining — a process that takes weeks and
            costs crores in lost generation. ROV-based submerged inspection eliminates drainage, reduces
            inspection time, and enables higher-frequency monitoring of critical infrastructure.
          </p>
        </section>

        <section id="about" className="lp-section">
          <h2 className="lp-section__heading">About the project</h2>
          <p className="lp-about-text">
            The HRT AI Inspection System is a major-project submission demonstrating an end-to-end
            pipeline for AI-powered structural inspection of submerged head race tunnels. It spans dataset
            curation (Roboflow — Underwater Crack Detection v3, 12,012 images), model training (YOLOv8s
            fine-tuned), inference with spatial telemetry, REST API integration, and this operational dashboard.
          </p>
          <button
            className="lp-cta-secondary"
            onClick={() => navigate('/dashboard')}
            id="about-enter-dashboard"
          >
            Explore the Dashboard
          </button>
        </section>

        <footer className="lp-footer">
          <span className="lp-footer__brand">HRT AI Inspection System</span>
          <span className="lp-footer__copy">YOLOv8s · Roboflow Underwater Crack Detection v3</span>
        </footer>
      </div>
    </div>
  );
}
