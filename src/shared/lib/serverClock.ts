// Серверные часы на клиенте. Время событий журнала (`at`) ставит сервер (now() в add_event),
// а таймер считает клиент: replay(format, events, nowMs). Если подставить в nowMs часы устройства,
// то при их расхождении с сервером таймер после каждого события замирает (отстающие часы) или
// убегает вперёд (спешащие), экраны показывают разный уровень, а canApply пропускает ребай,
// который replay по серверному `at` потом отвергнет. Поэтому «сейчас» везде — serverNow().
//
// Смещение оценивается как в NTP: запрос ушёл в t0, ответ пришёл в t1, сервер ответил временем S —
// смещение ≈ S − (t0 + t1) / 2, погрешность не больше половины RTT. Из последних замеров берём
// замер с наименьшим RTT: он точнее всех.
// Модуль без React и без сети: замеры подают api/serverClock.ts (server_now), табло (board_state)
// и ответы add_event.

export interface ClockSample {
  /** Сервер минус устройство, мс. */
  offsetMs: number;
  /** Время запроса туда-обратно, мс: чем меньше, тем точнее замер. */
  rttMs: number;
  /** Когда замер сделан (часы устройства) — старые замеры выбрасываем: часы устройства дрейфуют. */
  atMs: number;
}

/** Сколько замеров помнить. */
const MAX_SAMPLES = 8;
/** Замер старше — не учитываем (часы устройства могли подвести или их перевели). */
export const SAMPLE_TTL_MS = 15 * 60_000;
/** Замер с таким RTT ничего не говорит о часах. */
const MAX_RTT_MS = 10_000;

/** Замер из времени сервера (ISO или мс) и моментов отправки/получения на устройстве. */
export function clockSample(server: string | number, t0: number, t1: number): ClockSample | null {
  const serverMs = typeof server === 'number' ? server : Date.parse(server);
  if (!Number.isFinite(serverMs) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  const rttMs = t1 - t0;
  if (rttMs < 0 || rttMs > MAX_RTT_MS) return null;
  return { offsetMs: Math.round(serverMs - (t0 + t1) / 2), rttMs, atMs: t1 };
}

/** Смещение по самому точному из свежих замеров; null — свежих замеров нет. */
export function estimateOffset(samples: readonly ClockSample[], nowMs: number): number | null {
  let best: ClockSample | null = null;
  for (const s of samples) {
    if (nowMs - s.atMs > SAMPLE_TTL_MS) continue;
    if (!best || s.rttMs < best.rttMs) best = s;
  }
  return best ? best.offsetMs : null;
}

// --- Состояние модуля (одно на вкладку) ---------------------------------------------------------

let samples: ClockSample[] = [];
let offsetMs = 0;

/** Добавить замер. Возвращает новое смещение. */
export function addClockSample(server: string | number, t0: number, t1: number): number {
  const s = clockSample(server, t0, t1);
  if (!s) return offsetMs;
  samples = [...samples, s].slice(-MAX_SAMPLES);
  const next = estimateOffset(samples, s.atMs);
  if (next !== null) offsetMs = next;
  return offsetMs;
}

/** Текущее смещение «сервер − устройство», мс (0, пока замеров не было). */
export function clockOffsetMs(): number {
  return offsetMs;
}

/** «Сейчас» по часам сервера, мс. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Только для тестов. */
export function resetServerClock(): void {
  samples = [];
  offsetMs = 0;
}
