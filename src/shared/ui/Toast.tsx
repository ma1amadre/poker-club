import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/errors';
import { cn } from '../lib/cn';
import { haptic } from '../telegram';
import { AlertIcon, CheckIcon } from './icons';
import { ToastContext, type ToastApi, type ToastTone } from './toastContext';

interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

const MAX_VISIBLE = 3;
let nextId = 1;

/** Короткие уведомления сверху экрана; ошибки висят дольше — их надо успеть прочитать. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback<ToastApi['show']>(
    (text, options = {}) => {
      const tone = options.tone ?? 'info';
      const id = nextId++;
      setItems((list) => [...list, { id, text, tone }].slice(-MAX_VISIBLE));
      if (tone === 'success') haptic.notify('success');
      if (tone === 'error') haptic.notify('error');
      const duration = options.durationMs ?? (tone === 'error' ? 5000 : 2500);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (text) => show(text, { tone: 'success' }),
      error: (textOrError) => show(errorMessage(textOrError), { tone: 'error' }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn('ui-toast', `ui-toast--${item.tone}`)}
            onClick={() => dismiss(item.id)}
          >
            {item.tone === 'success' && <CheckIcon className="ui-toast__icon" size={20} />}
            {item.tone === 'error' && <AlertIcon className="ui-toast__icon" size={20} />}
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
