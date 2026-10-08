// Сезон в постах бота: какой вечер — финал квартала (строка «Финал сезона» в анонсе и посте дня игры)
// и какой сезон пора подводить постом «Итоги сезона» (cron-tick). Чистое (vitest); правила — домен
// (seasonCalendar: isSeasonFinale, seasonResultsWindow).
import {
  isSeasonFinale,
  SEASON_POST_HOUR,
  seasonKey,
  seasonResultsWindow,
  type CalendarEvening,
  type ClubSchedule,
} from './domain/index.ts';

/** Строка evenings для календаря сезона: только нужные колонки. Тренировки сюда не попадают. */
export interface CalendarRow {
  id: string;
  scheduled_at: string;
  slot_date: string | null;
  status: string;
}

export function calendarEvening(row: CalendarRow): CalendarEvening {
  return {
    id: row.id,
    scheduledAt: row.scheduled_at,
    slotDate: row.slot_date,
    cancelled: row.status === 'cancelled',
  };
}

/** Расписание клуба из settings; неверное — null (тогда финал определяется только по вечерам). */
export function clubSchedule(s: { game_weekday: number; game_time: string }): ClubSchedule | null {
  const ok =
    Number.isInteger(s.game_weekday) &&
    s.game_weekday >= 1 &&
    s.game_weekday <= 7 &&
    /^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(String(s.game_time ?? '').trim());
  return ok ? { weekday: s.game_weekday, time: String(s.game_time).trim() } : null;
}

/**
 * Сезон, финал которого этот вечер (последний вечер квартала — isSeasonFinale), или null. rows —
 * настоящие вечера клуба в любом статусе (отменённые держат свой слот расписания).
 */
export function finaleSeasonOf(
  evening: CalendarRow,
  rows: readonly CalendarRow[],
  schedule: ClubSchedule | null,
): string | null {
  return isSeasonFinale(calendarEvening(evening), rows.map(calendarEvening), schedule)
    ? seasonKey(evening.scheduled_at)
    : null;
}

/**
 * Сезон для поста «Итоги сезона» в момент nowMs: прошлый квартал — с 12:00 МСК первого дня нового
 * квартала и ещё SEASON_RESULTS_DAYS дней (если пост в первый день не ушёл — Telegram лежал, группы не
 * было, — он уйдёт позже, пока итоги ещё новость); иначе null.
 */
export function seasonPostDue(nowMs: number): string | null {
  return seasonResultsWindow(nowMs, { fromHour: SEASON_POST_HOUR })?.seasonKey ?? null;
}
