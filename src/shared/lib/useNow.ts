import { useEffect, useState } from 'react';
import { serverNow } from './serverClock';

/**
 * Текущее время по часам сервера (мс, см. serverClock.ts), обновляется раз в intervalMs. Тики
 * выровнены по границе интервала серверных часов: секунды таймера на телефоне банкира, у игроков
 * и на табло меняются одновременно, даже если часы устройств расходятся.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = intervalMs - (serverNow() % intervalMs);
      timer = setTimeout(() => {
        setNow(serverNow());
        schedule();
      }, delay);
    };
    schedule();

    // В фоне браузер душит таймеры; при возврате на экран обновляемся сразу.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(serverNow());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return now;
}
