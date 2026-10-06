import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '../api/errors';
import { haptic } from '../telegram';
import { Button } from './Button';
import { Toast, ToastRegion } from './materia';
import { ToastContext, type ToastApi, type ToastOptions, type ToastTone } from './toastContext';

interface ToastItem {
  id: number;
  title: string;
  detail?: string;
  tone: ToastTone;
  action?: ToastOptions['action'];
}

// Правила Toast «Материи»: не больше трёх, новые снизу; 5–8 с, ошибка и тост с действием — пока не
// закроют; таймер стоит, пока палец/курсор или фокус на тостах.
const MAX_VISIBLE = 3;
const DEFAULT_MS = 5000;
let nextId = 1;

type Timer = { handle: ReturnType<typeof setTimeout>; endsAt: number };

/**
 * Тосты сверху экрана (снизу они перекрывали бы навигацию и пульт банкира) — ToastRegion и Toast
 * «Материи». Результат действия — тост; ошибка, которая мешает работе, — Notice на экране.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, Timer>());
  // Остаток времени тостов, пока таймеры на паузе (или тост пришёл во время паузы).
  const remaining = useRef(new Map<number, number>());
  const paused = useRef(false);

  const forget = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer.handle);
    timers.current.delete(id);
    remaining.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      forget(id);
      setItems((list) => list.filter((item) => item.id !== id));
    },
    [forget],
  );

  const startTimer = useCallback(
    (id: number, ms: number) => {
      const old = timers.current.get(id);
      if (old) clearTimeout(old.handle);
      timers.current.set(id, {
        handle: setTimeout(() => dismiss(id), ms),
        endsAt: Date.now() + ms,
      });
    },
    [dismiss],
  );

  const show = useCallback<ToastApi['show']>(
    (text, options = {}) => {
      const tone = options.tone ?? 'info';
      const sticky =
        options.durationMs === undefined && (tone === 'critical' || Boolean(options.action));
      const id = nextId++;
      // Сфорсированные лимитом тосты убираем вместе с их таймерами (повтор в StrictMode безвреден).
      setItems((list) => {
        const next = [
          ...list,
          { id, title: text, detail: options.detail, tone, action: options.action },
        ];
        for (const dropped of next.slice(0, Math.max(0, next.length - MAX_VISIBLE)))
          forget(dropped.id);
        return next.slice(-MAX_VISIBLE);
      });
      if (!sticky) {
        const ms = options.durationMs ?? DEFAULT_MS;
        if (paused.current) remaining.current.set(id, ms);
        else startTimer(id, ms);
      }
      if (tone === 'positive') haptic.notify('success');
      if (tone === 'critical') haptic.notify('error');
      if (tone === 'caution') haptic.notify('warning');
    },
    [forget, startTimer],
  );

  // Пауза: запоминаем остаток каждого таймера; продолжение — с остатка, а не заново.
  const pause = useCallback(() => {
    if (paused.current) return;
    paused.current = true;
    const now = Date.now();
    for (const [id, timer] of timers.current) {
      clearTimeout(timer.handle);
      remaining.current.set(id, Math.max(0, timer.endsAt - now));
    }
    timers.current.clear();
  }, []);

  const resume = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    // Секунда сверху: тост не должен исчезнуть в тот же миг, как палец ушёл с него.
    for (const [id, ms] of remaining.current) startTimer(id, Math.max(ms, 1000));
    remaining.current.clear();
  }, [startTimer]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer.handle);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (text, options) => show(text, { ...options, tone: 'positive' }),
      error: (textOrError, options) =>
        show(errorMessage(textOrError), { ...options, tone: 'critical' }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className="ui-toasts"
          onPointerEnter={pause}
          onPointerLeave={resume}
          onFocus={pause}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume();
          }}
        >
          <ToastRegion position="top-end" className="ui-toast-region">
            {items.map((item) => (
              <Toast
                key={item.id}
                tone={item.tone}
                title={item.title}
                onClose={() => dismiss(item.id)}
                action={
                  item.action ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        item.action?.onClick();
                        dismiss(item.id);
                      }}
                    >
                      {item.action.label}
                    </Button>
                  ) : undefined
                }
              >
                {item.detail}
              </Toast>
            ))}
          </ToastRegion>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
