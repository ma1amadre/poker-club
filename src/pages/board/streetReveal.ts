// Раскрытие улиц олл-ина на табло по очереди. Банкир часто вносит стол с опозданием — флоп, тёрн и
// ривер одной отправкой, — и табло показало бы итог сразу. Здесь табло само раскрывает улицы:
// пришло больше одной — сначала флоп, через REVEAL_STEP_MS тёрн, ещё через столько же ривер.
// Чистый модуль (тесты — streetReveal.test.ts), хук — useStreetReveal в ShowdownBoard.
//
// Правила:
// - первый кадр табло (открыли посреди раздачи) показывает стол как есть — история не разыгрывается;
// - новая раздача (другой showdownId) — сразу первая пришедшая улица: до флопа — руки, иначе флоп;
// - та же раздача, карт стало больше — следующая улица, но не раньше REVEAL_STEP_MS после прошлого
//   шага (каждая улица видна хотя бы столько; поздний флоп после долгого префлопа — сразу);
// - карт стало меньше (банкир отменил ривер) — сразу, правка назад не ждёт.

/** Пауза между улицами на табло. Табло тикает раз в секунду: на экране это 3–4 с. */
export const REVEAL_STEP_MS = 3000;

/** Улицы по числу карт стола: до флопа, флоп, тёрн, ривер. */
const STREET_SIZES = [0, 3, 4, 5] as const;

export interface RevealState {
  /** Раздача, которую раскрываем; null — олл-ина на табло не было. */
  showdownId: string | null;
  /** Сколько карт стола показано. */
  shown: number;
  /** Когда показан последний шаг, мс. */
  at: number;
}

export interface RevealTarget {
  showdownId: string;
  /** Карт стола в журнале. */
  size: number;
}

/** Состояние первого кадра: что пришло — то и показано. */
export function revealStart(target: RevealTarget | null, nowMs: number): RevealState {
  return target
    ? { showdownId: target.showdownId, shown: target.size, at: nowMs }
    : { showdownId: null, shown: 0, at: nowMs };
}

function nextStreetSize(shown: number): number {
  return STREET_SIZES.find((s) => s > shown) ?? 5;
}

/**
 * Следующее состояние раскрытия. Возвращает prev как есть, если ничего не меняется (удобно для
 * React: «сменилось ли» — сравнением ссылок). Олл-ина нет — память о прошлой раздаче остаётся.
 */
export function revealStep(
  prev: RevealState,
  target: RevealTarget | null,
  nowMs: number,
): RevealState {
  if (!target) return prev;
  if (target.showdownId !== prev.showdownId) {
    return {
      showdownId: target.showdownId,
      shown: target.size >= 3 ? 3 : target.size,
      at: nowMs,
    };
  }
  if (target.size === prev.shown) return prev;
  if (target.size < prev.shown) return { ...prev, shown: target.size, at: nowMs };
  if (nowMs - prev.at < REVEAL_STEP_MS) return prev;
  return { ...prev, shown: Math.min(target.size, nextStreetSize(prev.shown)), at: nowMs };
}

/** Сколько карт стола показать сейчас (не больше, чем в журнале). */
export function revealedSize(state: RevealState, target: RevealTarget): number {
  return state.showdownId === target.showdownId ? Math.min(state.shown, target.size) : target.size;
}
