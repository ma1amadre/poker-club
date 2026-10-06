// Сверка часов устройства с сервером (RPC server_now, доступна и без входа — для табло).
// Сама оценка смещения — src/shared/lib/serverClock.ts; здесь только замеры по сети.
import { useEffect } from 'react';
import { addClockSample } from '../lib/serverClock';
import { supabase } from '../supabase';

/** Замеров за одну сверку: из них в оценку идёт самый быстрый. */
const SAMPLES_PER_SYNC = 3;
/** Не чаще: возврат в Mini App из чата случается постоянно. */
const MIN_SYNC_INTERVAL_MS = 60_000;

let lastSyncMs = 0;
let running: Promise<void> | null = null;

async function sampleOnce(): Promise<void> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('server_now');
  const t1 = Date.now();
  if (error || typeof data !== 'string') return;
  addClockSample(data, t0, t1);
}

/** Несколько замеров подряд; ошибки сети не мешают работе — останется прежнее смещение. */
export function syncServerClock(force = false): Promise<void> {
  if (running) return running;
  if (!force && Date.now() - lastSyncMs < MIN_SYNC_INTERVAL_MS) return Promise.resolve();
  lastSyncMs = Date.now();
  running = (async () => {
    try {
      for (let i = 0; i < SAMPLES_PER_SYNC; i += 1) await sampleOnce();
    } catch {
      // нет сети — сверимся при следующем возврате на экран
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Сверка при старте приложения и при каждом возврате на экран (часы устройства могли перевести). */
export function useServerClockSync(): void {
  useEffect(() => {
    void syncServerClock(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncServerClock();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);
}
