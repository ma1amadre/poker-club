import { describe, expect, it } from 'vitest';
import {
  clubDateKey,
  holdsSlot,
  nextGameAt as cronNextGameAt,
  slotFilter,
} from '../../../supabase/functions/cron-tick/schedule.ts';
import {
  announceMoment,
  clubWeekday,
  firstFreeSlot,
  isoToMoscow,
  moscowDateKey,
  moscowToIso,
  nextGameSlot,
  normalizeTime,
  parseClubDate,
  WEEKDAYS,
} from './clubTime';

// 06.10.2026 — вторник; 15:00 по Москве = 12:00 UTC.
const NOW = Date.parse('2026-10-06T12:00:00Z');

describe('moscowToIso / isoToMoscow', () => {
  it('19:00 по Москве — это 16:00 UTC', () => {
    expect(moscowToIso('2026-10-08', '19:00')).toBe('2026-10-08T16:00:00.000Z');
  });

  it('раннее утро по Москве — ещё вчерашний день в UTC', () => {
    expect(moscowToIso('2026-10-08', '01:30')).toBe('2026-10-07T22:30:00.000Z');
  });

  it('принимает время из Postgres с секундами', () => {
    expect(moscowToIso('2026-10-08', '19:00:00')).toBe('2026-10-08T16:00:00.000Z');
  });

  it('переход через год', () => {
    expect(moscowToIso('2027-01-01', '00:15')).toBe('2026-12-31T21:15:00.000Z');
    expect(isoToMoscow('2026-12-31T21:15:00Z')).toEqual({ date: '2027-01-01', time: '00:15' });
  });

  it('неверный ввод — null, а не «Invalid Date»', () => {
    expect(moscowToIso('2026-02-30', '19:00')).toBeNull();
    expect(moscowToIso('2026-10-08', '24:00')).toBeNull();
    expect(moscowToIso('', '19:00')).toBeNull();
    expect(moscowToIso('2026-10-08', '')).toBeNull();
    expect(moscowToIso('08.10.2026', '19:00')).toBeNull();
  });

  it('туда и обратно без потерь — летом и зимой одинаково (UTC+3 круглый год)', () => {
    for (const [date, time] of [
      ['2026-07-15', '19:00'],
      ['2026-12-20', '23:59'],
      ['2026-03-29', '02:30'],
      ['2026-10-25', '03:00'],
    ] as const) {
      const iso = moscowToIso(date, time);
      expect(iso).not.toBeNull();
      expect(isoToMoscow(iso as string)).toEqual({ date, time });
    }
  });

  it('isoToMoscow принимает мс и Date, а мусор — ошибка', () => {
    expect(isoToMoscow(NOW)).toEqual({ date: '2026-10-06', time: '15:00' });
    expect(isoToMoscow(new Date(NOW))).toEqual({ date: '2026-10-06', time: '15:00' });
    expect(() => isoToMoscow('не дата')).toThrow();
  });

  it('совпадает с часами Intl для Europe/Moscow', () => {
    const intl = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    for (
      let ms = Date.parse('2026-01-01T00:00:00Z');
      ms < Date.parse('2027-01-01T00:00:00Z');
      ms += 37 * 3_600_000 + 17 * 60_000
    ) {
      const parts = Object.fromEntries(intl.formatToParts(ms).map((p) => [p.type, p.value]));
      expect(isoToMoscow(ms)).toEqual({
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`,
      });
    }
  });

  it('moscowDateKey — день по Москве', () => {
    expect(moscowDateKey('2026-10-07T21:30:00Z')).toBe('2026-10-08');
    expect(moscowDateKey('2026-10-07T20:59:00Z')).toBe('2026-10-07');
  });
});

describe('parseClubDate / normalizeTime / clubWeekday', () => {
  it('разбирает дату и отсекает несуществующие', () => {
    expect(parseClubDate('2026-10-08')).toEqual({ year: 2026, month: 10, day: 8 });
    expect(parseClubDate(' 2028-02-29 ')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseClubDate('2026-02-29')).toBeNull();
    expect(parseClubDate('2026-13-01')).toBeNull();
    expect(parseClubDate('2026-1-1')).toBeNull();
  });

  it('нормализует время', () => {
    expect(normalizeTime('19:00:00')).toBe('19:00');
    expect(normalizeTime('9:05')).toBe('09:05');
    expect(normalizeTime('19:00:00.000')).toBe('19:00');
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('19:60')).toBeNull();
    expect(normalizeTime('')).toBeNull();
    expect(normalizeTime(null)).toBeNull();
    expect(normalizeTime('семь')).toBeNull();
  });

  it('день недели в нумерации settings: 1 = пн … 7 = вс', () => {
    expect(clubWeekday('2026-10-05')).toBe(1);
    expect(clubWeekday('2026-10-08')).toBe(4);
    expect(clubWeekday('2026-10-11')).toBe(7);
    expect(clubWeekday('мусор')).toBeNull();
  });

  it('WEEKDAYS по порядку settings.game_weekday', () => {
    expect(WEEKDAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(WEEKDAYS[3]?.on).toBe('в четверг');
  });
});

describe('nextGameSlot', () => {
  it('во вторник ближайший четверг — через два дня', () => {
    expect(nextGameSlot(NOW, 4, '19:00')).toEqual({ date: '2026-10-08', time: '19:00' });
  });

  it('сегодня день игры, время ещё не пришло — сегодня', () => {
    expect(nextGameSlot(NOW, 2, '19:00:00')).toEqual({ date: '2026-10-06', time: '19:00' });
  });

  it('сегодня день игры, но время прошло или ровно сейчас — через неделю', () => {
    expect(nextGameSlot(NOW, 2, '14:00')).toEqual({ date: '2026-10-13', time: '14:00' });
    expect(nextGameSlot(NOW, 2, '15:00')).toEqual({ date: '2026-10-13', time: '15:00' });
  });

  it('неверные настройки — null', () => {
    expect(nextGameSlot(NOW, 0, '19:00')).toBeNull();
    expect(nextGameSlot(NOW, 8, '19:00')).toBeNull();
    expect(nextGameSlot(NOW, 4, '25:00')).toBeNull();
  });

  it('то же правило, что у cron-tick (nextGameAt)', () => {
    const times = ['00:00', '03:15', '15:00', '19:00', '23:59'];
    for (let ms = NOW; ms < NOW + 9 * 86_400_000; ms += 5 * 3_600_000 + 13 * 60_000) {
      for (let weekday = 1; weekday <= 7; weekday++) {
        for (const time of times) {
          const slot = nextGameSlot(ms, weekday, time);
          expect(slot).not.toBeNull();
          const iso = moscowToIso(slot!.date, slot!.time);
          expect(Date.parse(iso!)).toBe(cronNextGameAt(ms, weekday, time));
        }
      }
    }
  });
});

describe('firstFreeSlot', () => {
  it('ближайший четверг свободен — он и есть', () => {
    expect(firstFreeSlot(NOW, 4, '19:00', new Set())).toEqual({
      date: '2026-10-08',
      time: '19:00',
    });
  });

  it('на ближайший четверг cron уже создал вечер — следующий четверг', () => {
    expect(firstFreeSlot(NOW, 4, '19:00', new Set(['2026-10-08']))).toEqual({
      date: '2026-10-15',
      time: '19:00',
    });
    expect(firstFreeSlot(NOW, 4, '19:00', new Set(['2026-10-08', '2026-10-15']))).toEqual({
      date: '2026-10-22',
      time: '19:00',
    });
  });

  it('всё занято на maxWeeks вперёд — null', () => {
    const taken = new Set(['2026-10-08', '2026-10-15']);
    expect(firstFreeSlot(NOW, 4, '19:00', taken, 2)).toBeNull();
  });

  it('неверные настройки — null', () => {
    expect(firstFreeSlot(NOW, 9, '19:00', new Set())).toBeNull();
  });
});

describe('announceMoment', () => {
  it('за 48 ч до четверга 19:00 — вторник 19:00', () => {
    expect(announceMoment(4, '19:00', 48)).toEqual({ weekday: 2, time: '19:00' });
  });

  it('переход через начало недели', () => {
    expect(announceMoment(1, '10:00', 24)).toEqual({ weekday: 7, time: '10:00' });
    expect(announceMoment(1, '10:00', 11)).toEqual({ weekday: 7, time: '23:00' });
  });

  it('некратное суткам окно', () => {
    expect(announceMoment(4, '19:00', 5)).toEqual({ weekday: 4, time: '14:00' });
    expect(announceMoment(4, '19:00', 20)).toEqual({ weekday: 3, time: '23:00' });
  });

  it('окно в неделю и больше или неверный ввод — null', () => {
    expect(announceMoment(4, '19:00', 168)).toBeNull();
    expect(announceMoment(4, '19:00', 336)).toBeNull();
    expect(announceMoment(4, '19:00', 0)).toBeNull();
    expect(announceMoment(4, '19:00', 1.5)).toBeNull();
    expect(announceMoment(0, '19:00', 48)).toBeNull();
    expect(announceMoment(4, 'вечер', 48)).toBeNull();
  });
});

describe('cron-tick: занят ли слот расписания (holdsSlot, миграция 010)', () => {
  // Ближайшая игра по расписанию — чт 08.10.2026, 19:00 МСК.
  const GAME = Date.parse('2026-10-08T16:00:00Z');

  it('московский день слота', () => {
    expect(clubDateKey(GAME)).toBe('2026-10-08');
    // 23:30 МСК 08.10 — ещё 8-е, хотя в UTC тоже 8-е; 00:30 МСК 09.10 — уже 9-е (в UTC 8-е).
    expect(clubDateKey(Date.parse('2026-10-08T20:30:00Z'))).toBe('2026-10-08');
    expect(clubDateKey(Date.parse('2026-10-08T21:30:00Z'))).toBe('2026-10-09');
  });

  it('вечер в этот день — слот занят, даже на другое время', () => {
    const at = (iso: string) => ({ scheduled_at: iso, slot_date: '2026-10-08' });
    expect(holdsSlot(at('2026-10-08T16:00:00Z'), GAME)).toBe(true);
    expect(holdsSlot({ scheduled_at: '2026-10-08T18:00:00Z', slot_date: null }, GAME)).toBe(true);
    expect(holdsSlot(at('2026-10-07T21:00:00Z'), GAME)).toBe(true); // 00:00 МСК 08.10
  });

  it('вечер перенесли с четверга на пятницу — четверг остаётся за ним', () => {
    const moved = { scheduled_at: '2026-10-09T17:00:00Z', slot_date: '2026-10-08' };
    expect(holdsSlot(moved, GAME)).toBe(true);
    // А пятничный слот через неделю ему не принадлежит.
    expect(holdsSlot(moved, Date.parse('2026-10-15T16:00:00Z'))).toBe(false);
  });

  it('вечер другого дня без слота на этот день — слот свободен', () => {
    expect(holdsSlot({ scheduled_at: '2026-10-09T17:00:00Z', slot_date: '2026-10-09' }, GAME)).toBe(
      false,
    );
    expect(holdsSlot({ scheduled_at: '2026-10-01T16:00:00Z', slot_date: '2026-10-01' }, GAME)).toBe(
      false,
    );
  });

  it('фильтр PostgREST: тот же московский день по времени или слот', () => {
    expect(slotFilter(GAME)).toBe(
      'and(scheduled_at.gte.2026-10-07T21:00:00.000Z,scheduled_at.lt.2026-10-08T21:00:00.000Z),slot_date.eq.2026-10-08',
    );
  });
});
