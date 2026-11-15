import { useEffect, useRef, useState } from 'react';

/** Animates a number from its previous value to the new one (ends immediately with reduced motion). */
export default function CountUp({ value, duration = 900, suffix = '' }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const origin = from.current;
    let raf;
    const tick = (now) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = origin + (target - origin) * eased;
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return <>{Math.round(shown)}{suffix}</>;
}
