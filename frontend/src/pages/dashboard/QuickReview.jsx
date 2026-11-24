import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X, SkipForward, Undo2 } from 'lucide-react';
import { apiFetch, reviewDetection } from '../../hooks/useApi';
import { REJECT_REASONS } from '../../utils/crackVerdict';
import { useToast } from '../../ui/contexts';
import './QuickReview.css';

const REASON_LABEL = { shadow: 'Shadow', stain: 'Stain', ring_joint: 'Ring joint', debris: 'Debris', texture: 'Texture', other: 'Other' };
const WHY = {
  texture_heuristic: 'texture check, not the model', too_small: 'very small', low_confidence: 'low confidence', blob_shape: 'blob-shaped',
  compact_box: 'compact box', few_frames: 'seen in few frames', classifier_not_crack: 'checker says no', classifier_unsure: 'checker not sure',
  classifier_unavailable: 'checker could not load', low_score: 'just short',
};
const SWIPE_PX = 110;

/**
 * One detection at a time, full screen: swipe right (or press →) for a crack, left (←) for not a crack, ↓ to skip, Z to undo.
 * Each answer is saved straight away. The crop the classifier saw is fetched per card, because the list leaves it out.
 */
export default function QuickReview({ items, onClose }) {
  const toast = useToast();
  const [deck] = useState(() => items.slice());
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]); // [{ id, status }]
  const [reason, setReason] = useState('other');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [crops, setCrops] = useState({}); // id -> { crop, image } once loaded
  const start = useRef(null);
  const requested = useRef(new Set()); // ids whose picture has been asked for

  const card = deck[index] || null;

  // Load the crop for this card and the next two
  useEffect(() => {
    for (const d of deck.slice(index, index + 3)) {
      if (requested.current.has(d.id)) continue;
      requested.current.add(d.id);
      apiFetch(`/api/detections/${encodeURIComponent(d.id)}`)
        .then((full) => setCrops((c) => ({ ...c, [d.id]: { crop: full?.crop_url || null, image: full?.image_url || d.imageUrl || null } })))
        .catch(() => setCrops((c) => ({ ...c, [d.id]: { crop: null, image: d.imageUrl || null } })));
    }
  }, [deck, index]);

  const decide = useCallback(async (status) => {
    if (!card || busy) return;
    if (status === 'skip') { setHistory((h) => [...h, { id: card.id, status: 'skip' }]); setIndex((i) => i + 1); setDrag(0); return; }
    setBusy(true);
    try {
      await reviewDetection(card.id, status === 'rejected' ? { review_status: 'rejected', reject_reason: reason } : { review_status: 'confirmed' });
      setHistory((h) => [...h, { id: card.id, status }]);
      setIndex((i) => i + 1);
    } catch (err) {
      toast.error(err.message || 'The answer could not be saved.');
    } finally {
      setBusy(false);
      setDrag(0);
    }
  }, [card, busy, reason, toast]);

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || busy) return;
    setBusy(true);
    try {
      if (last.status !== 'skip') await reviewDetection(last.id, { review_status: 'pending' });
      setHistory((h) => h.slice(0, -1));
      setIndex((i) => Math.max(0, i - 1));
    } catch (err) {
      toast.error(err.message || 'Could not undo.');
    } finally {
      setBusy(false);
    }
  }, [history, busy, toast]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') decide('confirmed');
      else if (e.key === 'ArrowLeft') decide('rejected');
      else if (e.key === 'ArrowDown') decide('skip');
      else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') undo();
      else if (/^[1-6]$/.test(e.key)) setReason(REJECT_REASONS[Number(e.key) - 1]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, undo, onClose]);

  const onDown = (e) => { if (busy) return; start.current = e.clientX; setDragging(true); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (start.current !== null) setDrag(e.clientX - start.current); };
  const onUp = () => {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (drag > SWIPE_PX) decide('confirmed');
    else if (drag < -SWIPE_PX) decide('rejected');
    else setDrag(0);
  };

  const done = history.filter((h) => h.status !== 'skip');
  const cracks = done.filter((h) => h.status === 'confirmed').length;
  const pics = card ? crops[card.id] : null;
  const hint = drag > 40 ? 'crack' : drag < -40 ? 'not' : null;

  return (
    <div className="qr" role="dialog" aria-modal="true" aria-label="Quick review">
      <div className="qr__top">
        <span className="qr__count">{Math.min(index + 1, deck.length)} / {deck.length}</span>
        <span className="qr__tally">{cracks} crack{cracks === 1 ? '' : 's'} · {done.length - cracks} not</span>
        <button type="button" className="qr__close" onClick={onClose} aria-label="Close quick review"><X size={18} /></button>
      </div>

      {card ? (
        <>
          <div
            className={`qr__card${hint ? ` qr__card--${hint}` : ''}`}
            style={{ transform: `translateX(${drag}px) rotate(${drag / 22}deg)`, transition: dragging ? 'none' : 'transform 0.2s ease' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          >
            <div className="qr__pic">
              {pics === undefined || pics === null ? <span className="qr__loading">Loading picture…</span>
                : pics.crop ? <img src={pics.crop} alt="The detection, as the crack checker saw it" draggable="false" />
                  : pics.image ? <img src={pics.image} alt="The frame the detection came from" draggable="false" />
                    : <span className="qr__loading">No picture stored for this detection</span>}
              {hint && <span className={`qr__stamp qr__stamp--${hint}`}>{hint === 'crack' ? 'CRACK' : 'NOT A CRACK'}</span>}
            </div>
            <div className="qr__meta">
              <span>{card.id}</span>
              <span>{Math.round((card.confidence ?? 0) * 100)}% detector · {card.severity}</span>
              <span>{Number(card.chainage ?? 0).toFixed(1)} m · {card.orientation}</span>
              {card.classifier_score != null && <span>checker {Math.round(card.classifier_score * 100)}%</span>}
              {card.verdict_reason?.length > 0 && <span className="qr__why">held back: {card.verdict_reason.map((r) => WHY[r] || r).join(', ')}</span>}
            </div>
          </div>

          <div className="qr__reasons" role="group" aria-label="Reason used when you say not a crack">
            {REJECT_REASONS.map((r, i) => (
              <button key={r} type="button" className={`qr__chip${reason === r ? ' qr__chip--on' : ''}`} onClick={() => setReason(r)}>
                <kbd>{i + 1}</kbd> {REASON_LABEL[r]}
              </button>
            ))}
          </div>

          <div className="qr__actions">
            <button type="button" className="qr__btn qr__btn--undo" onClick={undo} disabled={busy || !history.length} aria-label="Undo (Z)"><Undo2 size={18} /></button>
            <button type="button" className="qr__btn qr__btn--no" onClick={() => decide('rejected')} disabled={busy} aria-label="Not a crack (left arrow)"><X size={26} /></button>
            <button type="button" className="qr__btn qr__btn--skip" onClick={() => decide('skip')} disabled={busy} aria-label="Skip (down arrow)"><SkipForward size={18} /></button>
            <button type="button" className="qr__btn qr__btn--yes" onClick={() => decide('confirmed')} disabled={busy} aria-label="Crack (right arrow)"><Check size={26} /></button>
          </div>
          <p className="qr__keys">Swipe, or ← not a crack · → crack · ↓ skip · Z undo · 1–6 reason · Esc close</p>
        </>
      ) : (
        <div className="qr__end">
          <p><b>All done.</b> {cracks} confirmed as cracks, {done.length - cracks} rejected, {history.length - done.length} skipped.</p>
          <div className="qr__end-row">
            {history.length > 0 && <button type="button" className="qr__chip" onClick={undo} disabled={busy}>Undo last</button>}
            <button type="button" className="qr__chip qr__chip--on" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
