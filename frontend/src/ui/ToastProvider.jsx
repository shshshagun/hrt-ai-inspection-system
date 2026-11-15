import { useCallback, useMemo, useRef, useState } from 'react';
import { ToastContext } from './contexts';
import './ui.css';

/** Small non-blocking messages in the bottom-right corner. useToast().success('Saved') */
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const remove = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((kind, message, ms = 4500) => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-3), { id, kind, message }]);
    setTimeout(() => remove(id), ms);
  }, [remove]);

  const api = useMemo(() => ({
    success: (m) => push('success', m),
    error: (m) => push('error', m, 7000),
    info: (m) => push('info', m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => remove(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

