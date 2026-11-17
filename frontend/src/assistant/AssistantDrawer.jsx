import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X, Send } from 'lucide-react';
import { assistantStatus, askAssistant } from './api';
import { isDemo } from '../demo/demoMode';
import { WakeNotice } from '../ui/Sonar';
import './assistant.css';

const SUGGESTIONS = [
  'Which critical defects are past 100 m?',
  'What changed since the last inspection?',
  'How many defects are there of each severity?',
  'Show the largest cracks',
];
const KEEP = 10; // turns sent with each question

/** Slide-in assistant. Answers come from the server's read-only tools, and every cited defect links to its page. */
export default function AssistantDrawer({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(null); // null = not checked yet
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const demo = isDemo();

  useEffect(() => {
    if (!open) return undefined;
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || demo || enabled !== null) return;
    assistantStatus().then((s) => setEnabled(Boolean(s.enabled))).catch(() => setEnabled(false));
  }, [open, demo, enabled]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, busy]);

  async function send(text) {
    const q = text.trim();
    if (!q || busy) return;
    setError('');
    const next = [...messages, { role: 'user', text: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    const timer = setTimeout(() => setSlow(true), 4000);
    try {
      const out = await askAssistant(next.slice(-KEEP).map(({ role, text: t }) => ({ role, text: t })));
      setMessages([...next, { role: 'assistant', text: out.answer, sources: out.sources || [], truncated: out.truncated }]);
    } catch (err) {
      setError(err.message || 'The assistant could not answer.');
    } finally {
      clearTimeout(timer);
      setSlow(false);
      setBusy(false);
    }
  }

  if (!open) return null;
  const unavailable = demo ? 'The assistant needs a signed-in account. The demo is read-only and has no server behind it.'
    : enabled === false ? 'The assistant is not switched on for this server yet. An administrator needs to add an AI key.' : '';

  return (
    <aside className="ai" role="dialog" aria-label="HRT assistant">
      <header className="ai__head">
        <h2><Sparkles size={16} /> Ask HRT</h2>
        <button type="button" onClick={onClose} aria-label="Close the assistant"><X size={18} /></button>
      </header>

      <div className="ai__list" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="ai__intro">
            <p>Ask about the defects in plain words. Answers come straight from the inspection data, and each defect they mention is linked.</p>
            <p className="ai__note">AI predictions are not human-verified. The assistant reports what the data shows and never decides on repairs.</p>
            {!unavailable && (
              <ul>{SUGGESTIONS.map((s) => <li key={s}><button type="button" onClick={() => send(s)}>{s}</button></li>)}</ul>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai__msg ai__msg--${m.role}`}>
            <p>{m.text}</p>
            {m.truncated && <small>The answer was cut short; ask for more detail if you need it.</small>}
            {m.sources?.length > 0 && (
              <div className="ai__sources">
                <span>Defects mentioned</span>
                {m.sources.map((id, n) => <Link key={id} to={`/dashboard/detections/${id}`} onClick={onClose}>{n + 1}</Link>)}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="ai__msg ai__msg--assistant ai__typing" aria-label="Thinking"><i /><i /><i /></div>}
        {slow && <WakeNotice>Still working. The first request after a quiet period can take up to 30 seconds.</WakeNotice>}
        {error && <div className="ai__error" role="alert">{error}</div>}
        {unavailable && <div className="ai__error" role="status">{unavailable}</div>}
      </div>

      <form className="ai__form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} disabled={Boolean(unavailable)}
          placeholder={unavailable ? 'Not available' : 'Ask about defects, chainage, growth…'} aria-label="Your question" />
        <button type="submit" disabled={busy || !input.trim() || Boolean(unavailable)} aria-label="Send"><Send size={16} /></button>
      </form>
    </aside>
  );
}
