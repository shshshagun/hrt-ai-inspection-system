import { useEffect } from 'react';

/**
 * Keyboard control of the inspection video: Space play/pause, comma and period step one frame,
 * S starts the scan, Escape stops it, ? toggles the help card. Ignored while typing in a field.
 */
export function useVideoShortcuts({ videoRef, enabled, scanning, onStart, onStop, onHelp, fps = 30 }) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = videoRef.current;
      if (e.key === '?') { e.preventDefault(); onHelp?.(); return; }
      if (e.key === 'Escape' && scanning) { onStop?.(); return; }
      if (!v) return;
      if (e.code === 'Space' && !scanning) { e.preventDefault(); if (v.paused) v.play(); else v.pause(); }
      else if (e.key === ',' && !scanning) { v.pause(); v.currentTime = Math.max(0, v.currentTime - 1 / fps); }
      else if (e.key === '.' && !scanning) { v.pause(); v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 1 / fps); }
      else if ((e.key === 's' || e.key === 'S') && !scanning) onStart?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoRef, enabled, scanning, onStart, onStop, onHelp, fps]);
}
