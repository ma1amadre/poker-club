import { createContext, useContext } from 'react';

/** Тоны Toast «Материи»: info, positive (сделано), caution, critical (не получилось). */
export type ToastTone = 'info' | 'positive' | 'caution' | 'critical';

export interface ToastOptions {
  tone?: ToastTone;
  /** Вторая строка под заголовком (m-toast-text). */
  detail?: string;
  /**
   * Сколько держать, мс. По умолчанию 5 с; critical и тосты с действием висят, пока их не закроют
   * (правило Toast «Материи»).
   */
  durationMs?: number;
  /** Одно действие одним глаголом: «Отменить», «Повторить». */
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  /** Текст — прошедшее время без «успешно»: «Ребай записан», «Событие отменено». */
  show: (text: string, options?: ToastOptions) => void;
  success: (text: string, options?: Omit<ToastOptions, 'tone'>) => void;
  /** Принимает и текст, и пойманную ошибку (переводится errorMessage). */
  error: (textOrError: unknown, options?: Omit<ToastOptions, 'tone'>) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast вызван вне ToastProvider');
  return api;
}
