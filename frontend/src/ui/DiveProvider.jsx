import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DiveContext } from './contexts';
import './ui.css';

const BUBBLES = Array.from({ length: 18 }, (_, i) => ({
  left: `${(i * 37 + 8) % 96}%`,
  size: 8 + ((i * 13) % 26),
  delay: `${((i * 7) % 9) / 10}s`,
  duration: `${0.9 + ((i * 5) % 7) / 10}s`,
}));

/**
 * Wraps the routes. dive(path) plays a short "descent" animation (water rising over the screen,
 * bubbles, a caption) and switches page behind it, so signing in feels like the landing-page dive continues.
 * With reduced-motion enabled it just navigates.
 */
export function DiveProvider({ children }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ active: false, caption: '' });
  const timers = useRef([]);

  const dive = useCallback((to, caption = 'Descending to the dashboard…') => {
    timers.current.forEach(clearTimeout);
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { navigate(to, { replace: true }); return; }
    setState({ active: true, caption });
    timers.current = [
      setTimeout(() => navigate(to, { replace: true }), 850),
      setTimeout(() => setState((s) => ({ ...s, active: false })), 1750),
    ];
  }, [navigate]);

  const value = useMemo(() => ({ dive }), [dive]);
  return (
    <DiveContext.Provider value={value}>
      {children}
      {state.active && (
        <div className="dive" aria-hidden="true">
          <div className="dive__water" />
          {BUBBLES.map((b, i) => (
            <span key={i} className="dive__bubble" style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay, animationDuration: b.duration }} />
          ))}
          <p className="dive__caption">{state.caption}</p>
        </div>
      )}
    </DiveContext.Provider>
  );
}

