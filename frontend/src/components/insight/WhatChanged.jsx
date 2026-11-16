import { diffInspections } from '../../utils/defectHistory';
import './console.css';

const GROUPS = [
  { key: 'fresh', label: 'New', hint: 'first seen in the latest inspection' },
  { key: 'grown', label: 'Grown', hint: 'larger by 20% or more' },
  { key: 'steady', label: 'Steady', hint: 'seen again, little change' },
  { key: 'notSeen', label: 'Not seen', hint: 'not matched in the latest inspection' },
];

/** Compares the two most recent inspections. Click a group to move the scrubber to its first defect. */
export default function WhatChanged({ detections, onJump }) {
  const diff = diffInspections(detections);
  if (!diff) return null;
  return (
    <section className="wc" aria-label="What changed since the last inspection">
      <header>
        <h2>What changed</h2>
        <p>{diff.previousId} → {diff.latestId}</p>
      </header>
      <ul>
        {GROUPS.map(({ key, label, hint }) => {
          const items = diff[key];
          const first = items[0];
          return (
            <li key={key} className={`wc__${key}`}>
              <button type="button" disabled={!first} onClick={() => first && onJump(first.site.z)}>
                <b>{items.length}</b>
                <span>{label}</span>
                <em>{key === 'grown' && first ? `largest +${first.percent}%` : hint}</em>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="wc__note">"Not seen" does not mean repaired: the latest footage may not have covered that stretch.</p>
    </section>
  );
}
