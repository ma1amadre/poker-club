// Табло часами висит на ТВ: полноэкранный режим по кнопке (Fullscreen API) и удержание экрана
// от сна (Screen Wake Lock). Браузер снимает wake lock, когда вкладка уходит в фон, — при
// возврате (visibilitychange → visible) берём его заново.
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

export type WakeLockStatus = 'unsupported' | 'held' | 'released';

/** Не даёт экрану погаснуть, пока табло открыто и видно. */
export function useWakeLock(): WakeLockStatus {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [status, setStatus] = useState<WakeLockStatus>(supported ? 'released' : 'unsupported');

  useEffect(() => {
    if (!supported) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    let pending = false;

    const acquire = async () => {
      if (disposed || pending || sentinel || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) {
          void lock.release();
          return;
        }
        sentinel = lock;
        setStatus('held');
        lock.addEventListener('release', () => {
          sentinel = null;
          if (!disposed) setStatus('released');
        });
      } catch {
        // Отказ браузера (энергосбережение, нет жеста) — попробуем при следующем возврате на экран.
        if (!disposed) setStatus('released');
      } finally {
        pending = false;
      }
    };

    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Некоторые браузеры дают wake lock только после жеста пользователя — пробуем на первом касании.
    document.addEventListener('pointerdown', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('pointerdown', onVisible);
      void sentinel?.release();
    };
  }, [supported]);

  return status;
}
