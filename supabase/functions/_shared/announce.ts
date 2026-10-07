// Что группа знает о вечере из постов бота (evenings.announce_snapshot, миграция 008) и о чём ей
// нужно написать после правки вечера: перенос времени, уточнение или смена места, отмена,
// возврат отменённого.
// Чистые функции без БД — их проверяет vitest (announce.test.ts), а применяет notify/changes.ts.

export interface AnnounceSnapshot {
  /** Начало вечера, ISO UTC (toISOString). */
  scheduledAt: string;
  /** Место без пробелов по краям; пустое — null. */
  location: string | null;
  cancelled: boolean;
}

export interface AnnounceEveningLike {
  scheduled_at: string;
  location: string | null;
  status: string;
}

/** Снимок текущего состояния вечера — так его запоминают после поста. */
export function announceSnapshot(evening: AnnounceEveningLike): AnnounceSnapshot {
  const ms = Date.parse(evening.scheduled_at);
  return {
    scheduledAt: Number.isNaN(ms) ? evening.scheduled_at : new Date(ms).toISOString(),
    location: evening.location?.trim() || null,
    cancelled: evening.status === 'cancelled',
  };
}

/** Снимок из jsonb; кривой или пустой — null (тогда «что знает группа» неизвестно). */
export function parseSnapshot(value: unknown): AnnounceSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.scheduledAt !== 'string' || Number.isNaN(Date.parse(v.scheduledAt))) return null;
  if (v.location !== null && v.location !== undefined && typeof v.location !== 'string')
    return null;
  if (typeof v.cancelled !== 'boolean') return null;
  return {
    scheduledAt: v.scheduledAt,
    location: typeof v.location === 'string' ? v.location.trim() || null : null,
    cancelled: v.cancelled,
  };
}

export const sameTime = (a: AnnounceSnapshot, b: AnnounceSnapshot): boolean =>
  Date.parse(a.scheduledAt) === Date.parse(b.scheduledAt);

export const samePlace = (a: AnnounceSnapshot, b: AnnounceSnapshot): boolean =>
  a.location === b.location;

export function sameSnapshot(a: AnnounceSnapshot, b: AnnounceSnapshot): boolean {
  return sameTime(a, b) && samePlace(a, b) && a.cancelled === b.cancelled;
}

export type AnnounceChange = 'moved' | 'cancelled' | 'restored';

/**
 * Какая правка стоит за change = 'moved' — от неё зависит пост:
 * - rescheduled — новое время или дата (место могло смениться вместе с ним) → «Вечер перенесён»;
 * - place_set   — время прежнее, в анонсе места не было, теперь есть → «Место вечера: …»
 *                 (уточнение, не перенос);
 * - relocated   — время прежнее, место было и сменилось (или его убрали) → «Вечер переезжает».
 */
export type MoveKind = 'rescheduled' | 'place_set' | 'relocated';

export function moveKind(before: AnnounceSnapshot, after: AnnounceSnapshot): MoveKind {
  if (!sameTime(before, after)) return 'rescheduled';
  return before.location === null && after.location !== null ? 'place_set' : 'relocated';
}

/**
 * Что делать после правки вечера, чей анонс уже в группе:
 * - none   — группа знает актуальное, ничего не делать;
 * - silent — запомнить новое состояние без поста (снимка не было; правка вечера, который уже
 *            прошёл, — «перенос на вчера» группе не нужен; правка отменённого вечера);
 * - post   — написать в группу и запомнить.
 */
export type AnnounceDecision =
  { action: 'none' } | { action: 'silent' } | { action: 'post'; change: AnnounceChange };

export function decideAnnounceChange(
  known: AnnounceSnapshot | null,
  current: AnnounceSnapshot,
  nowMs: number,
): AnnounceDecision {
  if (!known) return { action: 'silent' };
  if (sameSnapshot(known, current)) return { action: 'none' };

  const ahead = (s: AnnounceSnapshot) => Date.parse(s.scheduledAt) > nowMs;
  if (current.cancelled && !known.cancelled) {
    // Отменять стоит только то, чего ещё ждут.
    return ahead(known) ? { action: 'post', change: 'cancelled' } : { action: 'silent' };
  }
  if (!current.cancelled && known.cancelled) {
    return ahead(current) ? { action: 'post', change: 'restored' } : { action: 'silent' };
  }
  if (current.cancelled) return { action: 'silent' }; // правка отменённого вечера
  return ahead(current) ? { action: 'post', change: 'moved' } : { action: 'silent' };
}
