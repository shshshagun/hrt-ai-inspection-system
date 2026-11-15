import './ui.css';

/** Placeholder block shown while data loads (replaces spinners and "0" flashes). */
export default function Skeleton({ width = '100%', height = 16, style }) {
  return <span className="skeleton" style={{ width, height, ...style }} aria-hidden="true" />;
}
