import { describe, expect, it } from 'vitest';
import { seasonEndIso } from './feed.ts';
import { seasonKey } from './season.ts';
import {
  clubDateKey,
  gameDaysLeft,
  isSeasonFinale,
  nextSeasonKey,
  scheduleSlots,
  seasonEndMs,
  seasonResultsWindow,
  seasonStartMs,
  type CalendarEvening,
  type ClubSchedule,
} from './seasonCalendar.ts';

/** Пятница 15:00 по Москве — расписание клуба на первый сезон. */
const FRIDAY: ClubSchedule = { weekday: 5, time: '15:00:00' };
/** Вечер в 15:00 МСК (12:00 UTC) дня «2026-12-25». */
const at = (date: string, time = '12:00'): string => `${date}T${time}:00.000Z`;
const ev = (id: string, date: string, extra: Partial<CalendarEvening> = {}): CalendarEvening => ({
  id,
  scheduledAt: at(date),
  slotDate: date,
  ...extra,
});

describe('границы сезона', () => {
  it('квартал по Москве: начало, конец, следующий', () => {
    expect(seasonStartMs('2026-Q4')).toBe(Date.parse('2026-09-30T21:00:00.000Z'));
    expect(seasonEndMs('2026-Q4')).toBe(Date.parse('2026-12-31T21:00:00.000Z'));
    expect(nextSeasonKey('2026-Q4')).toBe('2027-Q1');
    expect(nextSeasonKey('2027-Q2')).toBe('2027-Q3');
    expect(() => seasonStartMs('2026-Q5')).toThrow();
  });

  it('совпадают с seasonKey и с моментом сезонных ачивок ленты', () => {
    for (const key of ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1']) {
      const start = seasonStartMs(key);
      expect(seasonKey(new Date(start).toISOString())).toBe(key);
      expect(seasonKey(new Date(start - 1).toISOString())).not.toBe(key);
      expect(seasonEndMs(key)).toBe(Date.parse(seasonEndIso(key)));
    }
  });

  it('московский день', () => {
    expect(clubDateKey(Date.parse('2026-12-25T20:59:00Z'))).toBe('2026-12-25');
    expect(clubDateKey(Date.parse('2026-12-25T21:00:00Z'))).toBe('2026-12-26');
  });
});

describe('слоты расписания', () => {
  it('пятницы IV квартала 2026: 13 вечеров, последняя — 25 декабря', () => {
    const slots = scheduleSlots(FRIDAY, seasonStartMs('2026-Q4'), seasonEndMs('2026-Q4'));
    expect(slots).toHaveLength(13);
    expect(new Date(slots[0] ?? 0).toISOString()).toBe('2026-10-02T12:00:00.000Z');
    expect(new Date(slots.at(-1) ?? 0).toISOString()).toBe('2026-12-25T12:00:00.000Z');
  });

  it('полуинтервал [from, to) и неверное расписание', () => {
    const friday = Date.parse(at('2026-12-25'));
    expect(scheduleSlots(FRIDAY, friday, friday + 1)).toEqual([friday]);
    expect(scheduleSlots(FRIDAY, friday + 1, friday + 7 * 86_400_000)).toEqual([]);
    expect(scheduleSlots({ weekday: 8, time: '15:00' }, 0, 1e12)).toEqual([]);
    expect(scheduleSlots({ weekday: 5, time: '25:00' }, 0, 1e12)).toEqual([]);
    expect(scheduleSlots(FRIDAY, friday, friday)).toEqual([]);
  });

  it('игровых дней до конца сезона — строго после «сейчас»', () => {
    expect(gameDaysLeft(FRIDAY, Date.parse('2026-12-01T09:00:00Z'))).toBe(4);
    expect(gameDaysLeft(FRIDAY, Date.parse('2026-12-25T11:59:00Z'))).toBe(1);
    expect(gameDaysLeft(FRIDAY, Date.parse('2026-12-25T12:00:00Z'))).toBe(0);
    expect(gameDaysLeft(FRIDAY, Date.parse('2026-12-28T12:00:00Z'))).toBe(0);
    // Первый день нового сезона: считаются пятницы уже нового квартала.
    expect(gameDaysLeft(FRIDAY, Date.parse('2026-12-31T21:00:00Z'))).toBe(13);
  });
});

describe('финал сезона', () => {
  it('последняя пятница квартала — финал, предпоследняя — нет', () => {
    const last = ev('a', '2026-12-25');
    const before = ev('b', '2026-12-18');
    expect(isSeasonFinale(last, [before], FRIDAY)).toBe(true);
    expect(isSeasonFinale(before, [last], FRIDAY)).toBe(false);
  });

  it('свободный слот расписания впереди — не финал: в него cron-tick создаст вечер', () => {
    expect(isSeasonFinale(ev('b', '2026-12-18'), [], FRIDAY)).toBe(false);
    // Без расписания судим только по вечерам.
    expect(isSeasonFinale(ev('b', '2026-12-18'), [], null)).toBe(true);
  });

  it('слот держит и отменённый вечер, и вечер, перенесённый с него на другой день', () => {
    const before = ev('b', '2026-12-18');
    expect(isSeasonFinale(before, [ev('c', '2026-12-25', { cancelled: true })], FRIDAY)).toBe(true);
    // Вечер с 25.12 перенесли на 17.12: слот 25.12 за ним, 18.12 — последний.
    const moved = ev('m', '2026-12-17', { slotDate: '2026-12-25' });
    expect(isSeasonFinale(before, [moved], FRIDAY)).toBe(true);
    expect(isSeasonFinale(moved, [before], FRIDAY)).toBe(false);
  });

  it('вечер позже в том же квартале — финал он, а не этот; отменённый не в счёт', () => {
    const last = ev('a', '2026-12-25');
    expect(isSeasonFinale(last, [ev('x', '2026-12-30')], FRIDAY)).toBe(false);
    expect(isSeasonFinale(last, [ev('x', '2026-12-30', { cancelled: true })], FRIDAY)).toBe(true);
    // Вечер следующего квартала не мешает.
    expect(isSeasonFinale(last, [ev('y', '2027-01-08')], FRIDAY)).toBe(true);
  });

  it('перенос финала на субботу и другое расписание', () => {
    expect(isSeasonFinale(ev('a', '2026-12-26', { slotDate: '2026-12-25' }), [], FRIDAY)).toBe(
      true,
    );
    // По четвергам 31.12 — ещё игровой день IV квартала.
    expect(isSeasonFinale(ev('a', '2026-12-24'), [], { weekday: 4, time: '19:00' })).toBe(false);
    expect(isSeasonFinale(ev('a', '2026-12-31'), [], { weekday: 4, time: '19:00' })).toBe(true);
  });

  it('отменённый вечер финалом не бывает; сам вечер в списке не мешает', () => {
    const last = ev('a', '2026-12-25');
    expect(isSeasonFinale({ ...last, cancelled: true }, [], FRIDAY)).toBe(false);
    expect(isSeasonFinale(last, [last], FRIDAY)).toBe(true);
  });
});

describe('окно итогов сезона', () => {
  it('с начала квартала (пост — с 12:00 МСК) и 14 дней', () => {
    const noon = { fromHour: 12 };
    expect(seasonResultsWindow(Date.parse('2027-01-01T08:59:00Z'), noon)).toBeNull();
    expect(seasonResultsWindow(Date.parse('2027-01-01T09:00:00Z'), noon)).toEqual({
      seasonKey: '2026-Q4',
      endMs: Date.parse('2026-12-31T21:00:00Z'),
    });
    expect(seasonResultsWindow(Date.parse('2026-12-31T21:00:00Z'))?.seasonKey).toBe('2026-Q4');
    expect(seasonResultsWindow(Date.parse('2027-01-14T20:59:00Z'))?.seasonKey).toBe('2026-Q4');
    expect(seasonResultsWindow(Date.parse('2027-01-14T21:00:00Z'))).toBeNull();
    expect(seasonResultsWindow(Date.parse('2026-11-15T12:00:00Z'))).toBeNull();
  });
});
