// Календарь сезона: границы квартала по Москве, слоты расписания клуба внутри сезона, финал сезона
// (последний вечер квартала), сколько игровых дней осталось и окно «итогов сезона» после его конца.
// Москва живёт по UTC+3 круглый год (без перехода на летнее время с 26.10.2014) — смещение
// фиксированное, как у seasonEndIso ленты и clubTime фронта. Всё чистое: «сейчас» — параметром.
import { previousSeasonKey, seasonKey } from './season.ts';

/** Смещение клубного пояса (Москва) от UTC. */
export const CLUB_OFFSET_MS = 3 * 3_600_000;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Сколько после конца сезона он остаётся «событием»: карточка «Итоги сезона» на главной и окно, в
 * котором бот ещё публикует пост «Итоги сезона» (если в первый день квартала он не ушёл).
 */
export const SEASON_RESULTS_DAYS = 14;
/** Пост «Итоги сезона» — в первый день нового квартала не раньше этого часа по Москве. */
export const SEASON_POST_HOUR = 12;

function parseSeasonKey(key: string): { year: number; quarter: number } {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) throw new Error(`Некорректный ключ сезона: ${key}`);
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

/** Следующий сезон: '2026-Q4' → '2027-Q1'. */
export function nextSeasonKey(key: string): string {
  const { year, quarter } = parseSeasonKey(key);
  return quarter === 4 ? `${year + 1}-Q1` : `${year}-Q${quarter + 1}`;
}

/** Начало сезона — 00:00 первого дня квартала по Москве, мс UTC. */
export function seasonStartMs(key: string): number {
  const { year, quarter } = parseSeasonKey(key);
  return Date.UTC(year, (quarter - 1) * 3, 1) - CLUB_OFFSET_MS;
}

/** Конец сезона — начало следующего квартала по Москве (полуинтервал [начало, конец)), мс UTC. */
export function seasonEndMs(key: string): number {
  return seasonStartMs(nextSeasonKey(key));
}

/** Московский день момента: «2026-12-25» — как evenings.slot_date. */
export function clubDateKey(ms: number): string {
  const d = new Date(ms + CLUB_OFFSET_MS);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Игровой день вечера — московская дата его начала (scheduled_at): «2026-10-09». В один день бывает
 * несколько игр (evenings.game_no, миграция 026) — «Железный стул» считается по игровым дням.
 */
export function gameDayKey(dateIso: string): string {
  return clubDateKey(Date.parse(dateIso));
}

/** Начало московского дня момента, мс UTC. */
function clubDayStartMs(ms: number): number {
  return Math.floor((ms + CLUB_OFFSET_MS) / DAY_MS) * DAY_MS - CLUB_OFFSET_MS;
}

/** Расписание клуба: settings.game_weekday (1 = пн … 7 = вс) и game_time по Москве ('19:00[:00]'). */
export interface ClubSchedule {
  weekday: number;
  time: string;
}

/** Минута дня начала игры; неверное время или день недели — null. */
function slotMinute(schedule: ClubSchedule): number | null {
  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 1 || schedule.weekday > 7) {
    return null;
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(schedule.time.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour > 23 || minute > 59 ? null : hour * 60 + minute;
}

/** Предел перебора дней: квартал — до 92 дней, запас — на произвольные интервалы. */
const MAX_SCAN_DAYS = 400;

/**
 * Слоты расписания (моменты начала игры, мс UTC) в полуинтервале [fromMs, toMs), по возрастанию.
 * Неверное расписание — пусто.
 */
export function scheduleSlots(schedule: ClubSchedule, fromMs: number, toMs: number): number[] {
  const minute = slotMinute(schedule);
  if (minute === null || !(toMs > fromMs)) return [];
  const out: number[] = [];
  let day = clubDayStartMs(fromMs);
  for (let i = 0; i < MAX_SCAN_DAYS && day < toMs; i++, day += DAY_MS) {
    // День недели московского дня: начало дня + смещение — полночь этого дня «как UTC».
    const js = new Date(day + CLUB_OFFSET_MS).getUTCDay();
    if ((js === 0 ? 7 : js) !== schedule.weekday) continue;
    const at = day + minute * MINUTE_MS;
    if (at >= fromMs && at < toMs) out.push(at);
  }
  return out;
}

/**
 * Сколько игровых дней по расписанию осталось в сезоне момента nowMs: слоты строго позже nowMs и до
 * конца квартала. Отмены и переносы не учитываются — это счёт по расписанию («до конца сезона
 * 3 пятницы»).
 */
export function gameDaysLeft(schedule: ClubSchedule, nowMs: number): number {
  const end = seasonEndMs(seasonKey(new Date(nowMs).toISOString()));
  return scheduleSlots(schedule, nowMs + 1, end).length;
}

/** Вечер глазами календаря сезона. Тренировки сюда не передают: день клуба они не занимают. */
export interface CalendarEvening {
  id: string;
  scheduledAt: string;
  /** evenings.slot_date — день расписания, за которым вечер закреплён (миграция 010). */
  slotDate?: string | null;
  /** Отменённый вечер: финалом не бывает, но свой слот держит — cron-tick его не пересоздаёт. */
  cancelled?: boolean;
}

/**
 * Финал сезона — последний вечер квартала: после его московского дня и до конца квартала нет ни
 * другого неотменённого вечера, ни свободного слота расписания. Слот занят, если на его день назначен
 * или за ним закреплён (slot_date) хоть один вечер в любом статусе — то же правило, что holdsSlot у
 * cron-tick: на свободный слот cron-tick создаст вечер, на занятый — нет. Без расписания (schedule
 * null) — только по вечерам. others — остальные настоящие вечера клуба (сам вечер в списке не мешает).
 */
export function isSeasonFinale(
  evening: CalendarEvening,
  others: readonly CalendarEvening[],
  schedule: ClubSchedule | null,
): boolean {
  if (evening.cancelled) return false;
  const atMs = Date.parse(evening.scheduledAt);
  if (Number.isNaN(atMs)) return false;
  const key = seasonKey(evening.scheduledAt);
  const end = seasonEndMs(key);
  const rest = others.filter((o) => o.id !== evening.id);

  const later = rest.some((o) => {
    if (o.cancelled) return false;
    const ms = Date.parse(o.scheduledAt);
    return !Number.isNaN(ms) && ms > atMs && ms < end;
  });
  if (later) return false;
  if (!schedule) return true;

  const held = new Set<string>();
  for (const o of [evening, ...rest]) {
    const ms = Date.parse(o.scheduledAt);
    if (!Number.isNaN(ms)) held.add(clubDateKey(ms));
    if (o.slotDate) held.add(o.slotDate);
  }
  const fromMs = clubDayStartMs(atMs) + DAY_MS; // со следующего московского дня
  return scheduleSlots(schedule, fromMs, end).every((slot) => held.has(clubDateKey(slot)));
}

/**
 * Сезон, который сейчас время подводить: прошлый квартал — с SEASON_POST_HOUR часов первого дня нового
 * квартала по Москве и SEASON_RESULTS_DAYS дней после его конца; иначе null. Пост «Итоги сезона» и
 * карточка на главной — в одном окне (карточка — с начала квартала, пост — с полудня).
 */
export function seasonResultsWindow(
  nowMs: number,
  opts: { fromHour?: number } = {},
): { seasonKey: string; endMs: number } | null {
  const current = seasonKey(new Date(nowMs).toISOString());
  const startMs = seasonStartMs(current);
  const fromMs = startMs + (opts.fromHour ?? 0) * 3_600_000;
  if (nowMs < fromMs || nowMs >= startMs + SEASON_RESULTS_DAYS * DAY_MS) return null;
  return { seasonKey: previousSeasonKey(current), endMs: startMs };
}
