import { createContext, useContext } from 'react';

export const DiveContext = createContext({ dive: () => {} });
export const ToastContext = createContext({ success: () => {}, error: () => {}, info: () => {} });

/** dive(path, caption) plays the descent animation, then opens the page. */
export function useDive() {
  return useContext(DiveContext);
}

/** useToast().success('Saved'), .error('Failed'), .info('Note') */
export function useToast() {
  return useContext(ToastContext);
}
