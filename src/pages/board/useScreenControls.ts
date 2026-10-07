// Табло часами висит на ТВ: полноэкранный режим по кнопке (Fullscreen API). Удержание экрана от сна
// (Screen Wake Lock) — общий хук shared/lib/useWakeLock: его же берёт пульт идущего вечера.
import { useCallback, useEffect, useState } from 'react';

export interface FullscreenControl {
  /** Браузер умеет полноэкранный режим для страницы (на iPhone — нет). */
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

export function useFullscreen(): FullscreenControl {
  const supported = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
  const [active, setActive] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    const onChange = () => setActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement
        .requestFullscreen({ navigationUI: 'hide' })
        .catch(() => undefined);
    }
  }, []);

  return { supported, active, toggle };
}
