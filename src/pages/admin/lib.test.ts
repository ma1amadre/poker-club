import { describe, expect, it } from 'vitest';
import {
  adminErrorText,
  bankerCandidates,
  decimalToInput,
  type EveningLike,
  groupPlayers,
  intToInput,
  nameError,
  parseDecimalInput,
  parseIntInput,
  type PlayerLike,
  splitEvenings,
  takenDates,
} from './lib';
import { normalizeName } from '../../shared/lib/text';

describe('parseIntInput', () => {
  it('целые числа, разряды и знаки минуса', () => {
    expect(parseIntInput('500')).toBe(500);
    expect(parseIntInput(' 1 500 ')).toBe(1500);
    expect(parseIntInput('1 500')).toBe(1500);
    expect(parseIntInput('-1001234567890')).toBe(-1001234567890);
    expect(parseIntInput('−1001234567890')).toBe(-1001234567890);
    expect(parseIntInput('–100')).toBe(-100);
  });

  it('пусто — null, мусор и дроби — NaN', () => {
    expect(parseIntInput('')).toBeNull();
    expect(parseIntInput('   ')).toBeNull();
    expect(parseIntInput('12,5')).toBeNaN();
    expect(parseIntInput('abc')).toBeNaN();
    expect(parseIntInput('1e3')).toBeNaN();
    expect(parseIntInput('99999999999999999999')).toBeNaN();
  });
});

describe('parseDecimalInput / decimalToInput / intToInput', () => {
  it('запятая и точка', () => {
    expect(parseDecimalInput('0,5')).toBe(0.5);
    expect(parseDecimalInput('0.5')).toBe(0.5);
    expect(parseDecimalInput('1')).toBe(1);
    expect(parseDecimalInput(',5')).toBe(0.5);
    expect(parseDecimalInput('33,3')).toBe(33.3);
  });

  it('пусто — null, мусор — NaN', () => {
    expect(parseDecimalInput('')).toBeNull();
    expect(parseDecimalInput('0,5,1')).toBeNaN();
    expect(parseDecimalInput('пол')).toBeNaN();
  });

  it('обратно в поле — с запятой', () => {
    expect(decimalToInput(0.5)).toBe('0,5');
    expect(decimalToInput(1)).toBe('1');
    expect(decimalToInput(null)).toBe('');
    expect(decimalToInput(Number.NaN)).toBe('');
    expect(intToInput(500)).toBe('500');
    expect(intToInput(undefined)).toBe('');
  });
});

describe('имена', () => {
  it('схлопывает пробелы как сервер', () => {
    expect(normalizeName('  Вова   Петров ')).toBe('Вова Петров');
  });

  it('1–40 символов', () => {
    expect(nameError('Вова')).toBeNull();
    expect(nameError('   ')).toMatch(/Введите имя/);
    expect(nameError('я'.repeat(40))).toBeNull();
    expect(nameError('я'.repeat(41))).toMatch(/длиннее 40/);
  });
});

const player = (id: string, name: string, extra: Partial<PlayerLike> = {}): PlayerLike => ({
  id,
  display_name: name,
  is_guest: false,
  is_active: true,
  is_admin: false,
  ...extra,
});

describe('groupPlayers / bankerCandidates', () => {
  const list = [
    player('3', 'Саша'),
    player('1', 'Женя', { is_admin: true }),
    player('9', 'Вова (гость)', { is_guest: true }),
    player('5', 'Миша', { is_active: false }),
    player('6', 'Костя', { is_guest: true, is_active: false }),
  ];

  it('участники, гости и отключённые — по имени', () => {
    const g = groupPlayers(list);
    expect(g.members.map((p) => p.display_name)).toEqual(['Женя', 'Саша']);
    expect(g.guests.map((p) => p.display_name)).toEqual(['Вова (гость)']);
    expect(g.inactive.map((p) => p.display_name)).toEqual(['Костя', 'Миша']);
  });

  it('банкир — активный участник с Telegram, но назначенного не теряем', () => {
    const withExGuest = [...list, player('8', 'Боря', { tg_id: null })];
    expect(bankerCandidates(withExGuest, null).map((p) => p.id)).toEqual(['1', '3']);
    expect(bankerCandidates(withExGuest, '8').map((p) => p.id)).toEqual(['1', '3', '8']);
    expect(bankerCandidates(list, '5').map((p) => p.id)).toEqual(['1', '3', '5']);
    expect(bankerCandidates(list, '3').map((p) => p.id)).toEqual(['1', '3']);
  });
});

describe('splitEvenings / takenDates', () => {
  const ev = (id: string, status: EveningLike['status'], at: string): EveningLike => ({
    id,
    status,
    scheduled_at: at,
  });
  const list = [
    ev('a', 'settled', '2026-09-24T16:00:00Z'),
    ev('b', 'announced', '2026-10-15T16:00:00Z'),
    ev('c', 'cancelled', '2026-09-03T16:00:00Z'),
    ev('d', 'announced', '2026-10-08T16:00:00Z'),
    ev('e', 'live', '2026-10-01T16:00:00Z'),
    ev('f', 'finished', '2026-10-01T15:00:00Z'),
  ];

  it('впереди — идущий вечер, затем анонсы от ближайшего; прошли — новые сверху', () => {
    const { upcoming, past } = splitEvenings(list);
    expect(upcoming.map((e) => e.id)).toEqual(['e', 'd', 'b']);
    expect(past.map((e) => e.id)).toEqual(['f', 'a', 'c']);
  });

  it('занятые дни — по Москве, без отменённых и без самого вечера', () => {
    const late = ev('g', 'announced', '2026-10-21T22:30:00Z'); // 22 октября, 01:30 МСК
    const taken = takenDates([...list, late], 'd');
    expect(taken.has('2026-10-08')).toBe(false);
    expect(taken.has('2026-10-15')).toBe(true);
    expect(taken.has('2026-09-03')).toBe(false);
    expect(taken.has('2026-10-22')).toBe(true);
    expect(taken.has('2026-10-21')).toBe(false);
  });
});

describe('adminErrorText', () => {
  it('второй вечер на день — по-русски и с подсказкой', () => {
    const pg = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "evenings_one_per_club_day_idx"',
    };
    const wrapped = Object.assign(new Error(pg.message), { cause: pg });
    expect(adminErrorText(wrapped)).toMatch(/На этот день уже есть вечер/);
    expect(adminErrorText(pg)).toMatch(/На этот день уже есть вечер/);
  });

  it('нарушение check — общая подсказка', () => {
    expect(adminErrorText({ code: '23514', message: 'violates check constraint' })).toMatch(
      /вне допустимых пределов/,
    );
  });

  it('остальное — как errorMessage', () => {
    expect(adminErrorText(new Error('Нет прав'))).toBe('Нет прав');
    expect(adminErrorText({ message: 'Failed to fetch' })).toMatch(/Нет связи/);
  });
});
