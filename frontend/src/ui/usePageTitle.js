import { useEffect } from 'react';

/** Sets the browser tab title for the current page. */
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · HRT` : 'HRT AI Inspection System';
  }, [title]);
}
