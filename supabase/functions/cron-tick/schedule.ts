// Клубное расписание: ближайшая игра по дню недели и времени из settings — по Москве.
// Без внешних библиотек: «стенные часы» пояса даёт Intl.DateTimeFormat (clubParts), смещение
// от UTC вычисляем из них же, а не хардкодим +3 — на случай, если правила пояса поменяются.
import { clubParts } from '../_shared/messages.ts';

/** Смещение клубного пояса от UTC в момент ms (мс, Москва сейчас = +3 ч). */
export function clubOffsetMs(ms: number): number {
  const p = clubParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * «Стенное» время Москвы → момент UTC (мс). Смещение уточняем вторым проходом: первое
 * приближение берёт смещение в точке «наивного» UTC, которое у границы перевода часов
 * может отличаться от смещения в искомый момент.
 */
export function fromClubWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const first = naive - clubOffsetMs(naive);
  return naive - clubOffsetMs(first);
}

/** settings.game_time ('19:00' или '19:00:00') → часы и минуты. */
export function parseGameTime(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  const hour = Number(m?.[1]);
  const minute = Number(m?.[2]);
  if (!m || hour > 23 || minute > 59) throw new Error(`Некорректное время игры: ${value}`);
  return { hour, minute };
}

/**
 * Ближайшая игра по расписанию строго позже nowMs (мс UTC).
 * weekday — 1=пн … 7=вс (как settings.game_weekday), gameTime — время Москвы.
 * Если сегодня день игры, но время уже прошло, — игра через неделю.
 */
export function nextGameAt(nowMs: number, weekday: number, gameTime: string): number {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new Error(`Некорректный день игры: ${weekday}`);
  }
  const { hour, minute } = parseGameTime(gameTime);
  const today = clubParts(nowMs);
  for (let k = 0; k <= 7; k++) {
    // Календарная арифметика через Date.UTC: переполнение дня само переносит месяц и год.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + k));
    const wd = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (wd !== weekday) continue;
    const at = fromClubWallClock(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      minute,
    );
    if (at > nowMs) return at;
  }
  // Сюда не попасть: за 8 дней подходящий день недели встречается минимум один раз в будущем.
  throw new Error('Не удалось вычислить дату ближайшей игры');
}

/** Клубный (московский) день, в который попадает ms: [startMs, endMs) в UTC. */
export function clubDayRange(ms: number): { startMs: number; endMs: number } {
  const p = clubParts(ms);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return {
    startMs: fromClubWallClock(p.year, p.month, p.day, 0, 0),
    endMs: fromClubWallClock(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      0,
      0,
    ),
  };
}
