import { useEffect, useState } from 'react';

/**
 * Текущее время (мс), обновляется раз в intervalMs. Тики выровнены по границе интервала
 * настенных часов: секунды таймера на телефоне банкира, у игроков и на табло меняются
 * одновременно, а не «как повезло» с моментом монтирования.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = intervalMs - (Date.now() % intervalMs);
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, delay);
    };
    schedule();

    // В фоне браузер душит таймеры; при возврате на экран обновляемся сразу.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  return now;
}
