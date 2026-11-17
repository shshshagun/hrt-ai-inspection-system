import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X, Download, RefreshCw, Loader2 } from 'lucide-react';
import { reportDraft } from '../../assistant/api';
import { generateReport, useDetections } from '../../hooks/useApi';
import { isDemo } from '../../demo/demoMode';
import { buildReportFacts, templateDraft } from '../../utils/reportDraft';
import { useToast } from '../../ui/contexts';
import { WakeNotice } from '../../ui/Sonar';
import './ReportDraftPanel.css';

const LIMIT = 3500;

/**
 * Draft, edit and export the summary of one inspection report. The server writes the draft from the database (with an AI when one is
 * configured, otherwise the standard summary); the engineer edits it; the PDF carries it. Nothing is added to a report without the engineer.
 */
export default function ReportDraftPanel({ inspectionId, title, onClose }) {
  const toast = useToast();
  const { data: detections } = useDetections();
  const [state, setState] = useState({ loading: true });
  const [text, setText] = useState('');
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(null);

  const load = useCallback(async () => {
    setState({ loading: true });
    const timer = setTimeout(() => setSlow(true), 4000);
    try {
      let out;
      if (isDemo()) {
        const facts = buildReportFacts(detections || [], inspectionId);
        out = { draft: templateDraft(facts), source: 'template', note: 'Demo: this is the standard summary. Signed-in users with the AI switched on get an AI-written draft.', facts };
      } else {
        out = await reportDraft(inspectionId);
      }
      setState({ ...out });
      setText(out.draft);
    } catch (err) {
      setState({ error: err.message || 'Could not prepare the summary.' });
    } finally {
      clearTimeout(timer);
      setSlow(false);
    }
  }, [inspectionId, detections]);

  // wait for the demo detections to be there before drafting from them
  useEffect(() => { if (!isDemo() || (detections && detections.length)) load(); }, [load, detections]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function download() {
    setBusy(true);
    try {
      await generateReport({ inspection_id: inspectionId, format: 'pdf', narrative: text.trim(), narrative_ai: state.source === 'ai' });
      toast.success('PDF report downloaded with your summary.');
    } catch (err) {
      toast.error(err.message || 'The PDF could not be created.');
    } finally {
      setBusy(false);
    }
  }

  const f = state.facts;
  return (
    <div className="rd-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="rd" role="dialog" aria-modal="true" aria-label={`Summary for ${title || inspectionId}`} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2><Sparkles size={16} /> Report summary</h2>
          <button type="button" ref={closeRef} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <p className="rd__sub">{title || inspectionId}</p>

        {state.loading && (
          <div className="rd__wait" role="status">
            <Loader2 size={18} className="sp-dl-btn__spin" /> Preparing the summary from the findings…
            {slow && <WakeNotice>Still working. The first request after a quiet period can take up to 30 seconds.</WakeNotice>}
          </div>
        )}
        {state.error && <div className="rd__error" role="alert">{state.error}</div>}

        {!state.loading && !state.error && (
          <>
            <div className="rd__badges">
              <span className={`rd__badge rd__badge--${state.source}`}>{state.source === 'ai' ? 'Drafted by AI from the findings' : 'Standard summary'}</span>
              <span className="rd__count">{text.length} / {LIMIT}</span>
            </div>
            {state.note && <p className="rd__note">{state.note}</p>}
            <label className="rd__label" htmlFor="rd-text">Summary (edit freely; this text goes into the PDF)</label>
            <textarea id="rd-text" value={text} maxLength={LIMIT} rows={11} onChange={(e) => setText(e.target.value)} />
            <p className="rd__warn">AI drafts can be wrong. Every number was checked against the findings, but you are responsible for what the report says. Findings stay AI predictions until an engineer verifies them.</p>
            {f && (
              <details className="rd__facts">
                <summary>Facts the summary is based on</summary>
                <dl>
                  <div><dt>Defects</dt><dd>{f.total} ({Object.entries(f.by_severity).filter(([, n]) => n).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ') || 'none'})</dd></div>
                  {f.chainage_range_m && <div><dt>Chainage range</dt><dd>{f.chainage_range_m[0]} to {f.chainage_range_m[1]} m</dd></div>}
                  {f.hotspots[0] && <div><dt>Busiest stretch</dt><dd>{f.hotspots[0].range}, {f.hotspots[0].count} defects</dd></div>}
                  {f.compared_with_previous && <div><dt>Compared with {f.compared_with_previous.inspection_id}</dt><dd>{f.compared_with_previous.new} new, {f.compared_with_previous.grown_20_percent_or_more} grown, {f.compared_with_previous.steady} steady, {f.compared_with_previous.not_seen_again} not seen again</dd></div>}
                  <div><dt>Without a recorded position</dt><dd>{f.without_position}</dd></div>
                  <div><dt>Sizes measured</dt><dd>{f.with_measured_size} of {f.total}</dd></div>
                </dl>
              </details>
            )}
            <footer>
              <button type="button" className="rd__btn rd__btn--ghost" onClick={load} disabled={busy}><RefreshCw size={15} /> Draft again</button>
              <button type="button" className="rd__btn" onClick={download} disabled={busy || !text.trim()}>
                {busy ? <><Loader2 size={15} className="sp-dl-btn__spin" /> Creating…</> : <><Download size={15} /> Download PDF with this summary</>}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
