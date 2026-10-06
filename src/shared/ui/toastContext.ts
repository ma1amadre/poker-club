import { createContext, useContext } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastApi {
  show: (text: string, options?: { tone?: ToastTone; durationMs?: number }) => void;
  success: (text: string) => void;
  /** Принимает и текст, и пойманную ошибку (переводится errorMessage). */
  error: (textOrError: unknown) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast вызван вне ToastProvider');
  return api;
}
