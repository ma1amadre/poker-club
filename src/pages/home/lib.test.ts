import { DEFAULT_FORMAT } from '@domain/format.ts';
import type { EveningEvent, EventPayload, EventType } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import type { RsvpStatus } from '../../shared/api';
import {
  groupRsvps,
  myResult,
  nameWithMe,
  openSettlements,
  pickTraining,
  pickUpcoming,
  type PlayerLike,
  playerName,
  seasonEveningPending,
  type SettleEveningLike,
  STALE_ANNOUNCE_MS,
  type UpcomingLike,
  upsertRsvp,
} from './lib';
import { capitalize, keepNumbersTogether, pointsWord, signedNumber } from '../../shared/lib/text';
import { nextGameAt } from '../../shared/lib/clubTime';
import { formatSeason } from '../../shared/lib/season';

const NOW = Date.parse('2026-10-06T12:00:00Z'); // вторник, 15:00 МСК

describe('pickUpcoming', () => {
  const ev = (id: string, status: UpcomingLike['status'], scheduled: string, started?: string) => ({
    id,
    status,
    scheduled_at: scheduled,
    started_at: started ?? null,
  });

  it('идущая игра важнее анонса', () => {
    const list = [
      ev('a', 'announced', '2026-10-08T16:00:00Z'),
      ev('l', 'live', '2026-10-01T16:00:00Z', '2026-10-01T16:10:00Z'),
    ];
    expect(pickUpcoming(list, NOW)?.id).toBe('l');
  });

  it('из нескольких анонсов — самый ранний не забытый', () => {
    const list = [
      ev('late', 'announced', '2026-10-15T16:00:00Z'),
      ev('soon', 'announced', '2026-10-08T16:00:00Z'),
      ev('old', 'announced', '2026-09-24T16:00:00Z'),
    ];
    expect(pickUpcoming(list, NOW)?.id).toBe('soon');
  });

  it('анонс на сегодня, время которого прошло недавно, ещё показываем', () => {
    const list = [ev('today', 'announced', new Date(NOW - 2 * 3600_000).toISOString())];
    expect(pickUpcoming(list, NOW)?.id).toBe('today');
  });

  it('только забытые анонсы — последний из них', () => {
    const list = [
      ev('old1', 'announced', new Date(NOW - STALE_ANNOUNCE_MS - 7 * 86400_000).toISOString()),
      ev('old2', 'announced', new Date(NOW - STALE_ANNOUNCE_MS - 1000).toISOString()),
    ];
    expect(pickUpcoming(list, NOW)?.id).toBe('old2');
  });

  it('завершённые и отменённые не берём', () => {
    const list = [
      ev('f', 'finished', '2026-10-01T16:00:00Z'),
      ev('c', 'cancelled', '2026-10-08T16:00:00Z'),
    ];
    expect(pickUpcoming(list, NOW)).toBeNull();
  });
});

describe('nextGameAt', () => {
  it('ближайший четверг 19:00 МСК = 16:00 UTC', () => {
    expect(new Date(nextGameAt(NOW, 4, '19:00:00') ?? 0).toISOString()).toBe(
      '2026-10-08T16:00:00.000Z',
    );
  });

  it('в день игры до начала — сегодня, после — через неделю', () => {
    const thuMorning = Date.parse('2026-10-08T06:00:00Z');
    const thuNight = Date.parse('2026-10-08T17:00:00Z');
    expect(new Date(nextGameAt(thuMorning, 4, '19:00') ?? 0).toISOString()).toBe(
      '2026-10-08T16:00:00.000Z',
    );
    expect(new Date(nextGameAt(thuNight, 4, '19:00') ?? 0).toISOString()).toBe(
      '2026-10-15T16:00:00.000Z',
    );
  });

  it('день считается по Москве, а не по UTC', () => {
    // Среда 22:30 UTC = четверг 01:30 МСК: игра в четверг 00:30 МСК уже прошла.
    const wedLateUtc = Date.parse('2026-10-07T22:30:00Z');
    expect(new Date(nextGameAt(wedLateUtc, 4, '00:30') ?? 0).toISOString()).toBe(
      '2026-10-14T21:30:00.000Z',
    );
  });

  it('воскресенье = 7, переход через месяц', () => {
    const at = nextGameAt(Date.parse('2026-10-30T12:00:00Z'), 7, '18:00');
    expect(new Date(at ?? 0).toISOString()).toBe('2026-11-01T15:00:00.000Z');
  });

  it('некорректные настройки — null', () => {
    expect(nextGameAt(NOW, 0, '19:00')).toBeNull();
    expect(nextGameAt(NOW, 4, '25:00')).toBeNull();
    expect(nextGameAt(NOW, 4, 'вечером')).toBeNull();
  });
});

const player = (id: string, name: string, extra: Partial<PlayerLike> = {}): PlayerLike => ({
  id,
  display_name: name,
  photo_url: null,
  is_guest: false,
  is_active: true,
  is_spectator: null,
  ...extra,
});

describe('состав', () => {
  const players = [
    player('j', 'Женя'),
    player('s', 'Саша'),
    player('d', 'Дима'),
    player('m', 'Миша'),
    player('k', 'Костя'),
    player('old', 'Бывший', { is_active: false }),
    player('g1', 'Вова (гость)', { is_guest: true }),
    player('g2', 'Петя (гость)', { is_guest: true }),
  ];
  const rsvps = [
    { player_id: 's', status: 'yes' as const },
    { player_id: 'j', status: 'yes' as const },
    { player_id: 'd', status: 'maybe' as const },
    { player_id: 'm', status: 'no' as const },
    { player_id: 'g1', status: 'yes' as const },
  ];

  it('группы ответов: порядок ответов, молчуны — постоянные активные без ответа', () => {
    const g = groupRsvps(players, rsvps);
    expect(g.yes.map((p) => p.id)).toEqual(['s', 'j', 'g1']);
    expect(g.maybe.map((p) => p.id)).toEqual(['d']);
    expect(g.no.map((p) => p.id)).toEqual(['m']);
    expect(g.silent.map((p) => p.id)).toEqual(['k']);
  });

  it('болельщик (миграция 024): без ответа — не молчун; ответил — в своей группе; за столом — молчун', () => {
    const fans = [
      ...players,
      player('f1', 'Аня', { is_spectator: true }),
      player('f2', 'Оля', { is_spectator: true }),
      player('f3', 'Таня', { is_spectator: false }),
    ];
    const g = groupRsvps(fans, [...rsvps, { player_id: 'f2', status: 'yes' as const }]);
    expect(g.silent.map((p) => p.id)).toEqual(['k', 'f3']);
    expect(g.yes.map((p) => p.id)).toEqual(['s', 'j', 'g1', 'f2']);
    // Посадили за стол без ответа — на этот вечер игрок, как любой посаженный молчун.
    expect(groupRsvps(fans, rsvps, new Set(['f1'])).silent.map((p) => p.id)).toEqual([
      'f1',
      'k',
      'f3',
    ]);
  });

  it('оптимистичный ответ: моя строка заменяется и уходит в конец', () => {
    const rows: { player_id: string; status: RsvpStatus; updated_at: string }[] = [
      { player_id: 'j', status: 'yes', updated_at: '1' },
      { player_id: 's', status: 'maybe', updated_at: '2' },
    ];
    const next = upsertRsvp(rows, { player_id: 'j', status: 'no', updated_at: '3' });
    expect(next.map((r) => [r.player_id, r.status])).toEqual([
      ['s', 'maybe'],
      ['j', 'no'],
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe('сезон на главной', () => {
  // Пт 25.12.2026 — последний слот IV квартала (15:00 МСК = 12:00 UTC).
  const FINAL = '2026-12-25T12:00:00.000Z';
  const ev = (status: UpcomingLike['status'], scheduled: string): UpcomingLike => ({
    status,
    scheduled_at: scheduled,
    started_at: status === 'live' ? scheduled : null,
  });

  it('несыгранный вечер сезона: идущий или объявленный, кроме забытых анонсов', () => {
    const at = (iso: string) => Date.parse(iso);
    // Финал идёт — слотов уже нет, но игра в сезоне есть.
    expect(seasonEveningPending([ev('live', FINAL)], '2026-Q4', at('2026-12-25T12:30:00Z'))).toBe(
      true,
    );
    // Финал перенесён с пятницы на субботу: в пятницу вечером он ещё впереди.
    expect(
      seasonEveningPending(
        [ev('announced', '2026-12-26T12:00:00.000Z')],
        '2026-Q4',
        at('2026-12-25T13:00:00Z'),
      ),
    ).toBe(true);
    // Сыгран или отменён — игр в сезоне не осталось.
    for (const status of ['finished', 'settled', 'cancelled'] as const) {
      expect(seasonEveningPending([ev(status, FINAL)], '2026-Q4', at('2026-12-25T18:00:00Z'))).toBe(
        false,
      );
    }
    // Забытый анонс (время прошло больше чем на STALE_ANNOUNCE_MS) не держит сезон.
    expect(
      seasonEveningPending([ev('announced', FINAL)], '2026-Q4', at(FINAL) + STALE_ANNOUNCE_MS + 1),
    ).toBe(false);
    // Вечер следующего сезона не в счёт.
    expect(
      seasonEveningPending(
        [ev('announced', '2027-01-08T12:00:00.000Z')],
        '2026-Q4',
        at('2026-12-28T12:00:00Z'),
      ),
    ).toBe(false);
  });

  it('подпись сезона', () => {
    expect(formatSeason('2026-Q4')).toBe('4-й квартал 2026');
    expect(formatSeason('что-то')).toBe('что-то');
  });
});

describe('незакрытые расчёты', () => {
  function events(list: [EventType, EventPayload][]): EveningEvent[] {
    const start = Date.parse('2026-10-01T16:00:00Z');
    return list.map(([type, payload], i) => ({
      id: i + 1,
      type,
      payload,
      at: new Date(start + i * 60_000).toISOString(),
      voided: false,
    }));
  }

  // A выбивает B. Фонд 2 × 500 = 1000 → 700 / 300 (нокаут на деньги не влияет). A: взнос 500,
  // приз 700 → банкир должен A 200. B: взнос 500, приз 300 → B должен банкиру 200.
  const log = events([
    ['join', { playerId: 'A' }],
    ['join', { playerId: 'B' }],
    ['timer_start', {}],
    ['bust', { playerId: 'B', by: ['A'] }],
    ['finish', {}],
  ]);
  const evening = (patch: Partial<SettleEveningLike> = {}): SettleEveningLike => ({
    id: 'e1',
    status: 'finished',
    scheduled_at: '2026-10-01T16:00:00Z',
    banker_id: 'C',
    format: DEFAULT_FORMAT,
    ...patch,
  });

  it('кто кому должен', () => {
    const map = new Map([['e1', log]]);
    expect(openSettlements([evening()], map, 'A').debts).toEqual([
      expect.objectContaining({ kind: 'await', amountRub: 200, bankerId: 'C' }),
    ]);
    expect(openSettlements([evening()], map, 'B').debts).toEqual([
      expect.objectContaining({ kind: 'owe', amountRub: 200 }),
    ]);
    expect(openSettlements([evening()], map, 'Z').debts).toEqual([]);
  });

  it('частичная оплата уменьшает долг, полная — убирает', () => {
    const partial = [...log, ...events([['payment', { playerId: 'B', amountRub: 100 }]])].map(
      (e, i) => ({ ...e, id: i + 1 }),
    );
    const full = [...log, ...events([['payment', { playerId: 'B', amountRub: 200 }]])].map(
      (e, i) => ({ ...e, id: i + 1 }),
    );
    expect(openSettlements([evening()], new Map([['e1', partial]]), 'B').debts[0]?.amountRub).toBe(
      100,
    );
    expect(openSettlements([evening()], new Map([['e1', full]]), 'B').debts).toEqual([]);
  });

  it('банкир видит, сколько игроков ещё не рассчитано, без своей строки', () => {
    const map = new Map([['e1', log]]);
    const res = openSettlements([evening({ banker_id: 'A' })], map, 'A');
    expect(res.debts).toEqual([]);
    expect(res.banker).toEqual([expect.objectContaining({ eveningId: 'e1', pending: 1 })]);
  });

  it('банкир-игрок: остальные рассчитались — напоминание про свою строку и закрытие', () => {
    // Банкир A выиграл: ему причитается 200 (своя строка −200), B должен 200.
    const paid = [...log, ...events([['payment', { playerId: 'B', amountRub: 200 }]])].map(
      (e, i) => ({ ...e, id: i + 1 }),
    );
    const own = [...paid, ...events([['payment', { playerId: 'A', amountRub: -200 }]])].map(
      (e, i) => ({ ...e, id: i + 1 }),
    );
    const onlySelf = openSettlements([evening({ banker_id: 'A' })], new Map([['e1', paid]]), 'A');
    expect(onlySelf.banker).toEqual([
      expect.objectContaining({ pending: 0, selfRemainingRub: -200, allSettled: false }),
    ]);
    const allZero = openSettlements([evening({ banker_id: 'A' })], new Map([['e1', own]]), 'A');
    expect(allZero.banker).toEqual([
      expect.objectContaining({ pending: 0, selfRemainingRub: 0, allSettled: true }),
    ]);
    // После «Закрыть расчёт» напоминаний нет.
    expect(
      openSettlements([evening({ banker_id: 'A', status: 'settled' })], new Map([['e1', own]]), 'A')
        .banker,
    ).toEqual([]);
  });

  it('расчёт открылся сам после правки журнала — долг снова виден с пометкой', () => {
    const map = new Map([['e1', log]]);
    const reopened = evening({ settle_reopened_at: '2026-10-03T10:00:00Z' });
    expect(openSettlements([reopened], map, 'B').debts).toEqual([
      expect.objectContaining({ kind: 'owe', amountRub: 200, reopened: true }),
    ]);
    expect(openSettlements([evening()], map, 'B').debts[0]?.reopened).toBe(false);
    expect(openSettlements([{ ...reopened, banker_id: 'A' }], map, 'A').banker[0]?.reopened).toBe(
      true,
    );
  });

  it('рассчитанные и незавершённые по журналу вечера пропускаются', () => {
    const unfinished = log.filter((e) => e.type !== 'finish');
    expect(
      openSettlements([evening({ status: 'settled' })], new Map([['e1', log]]), 'B').debts,
    ).toEqual([]);
    expect(openSettlements([evening()], new Map([['e1', unfinished]]), 'B').debts).toEqual([]);
  });
});

describe('мой итог вечера', () => {
  const summary = {
    entrants: ['a', 'b', 'c'],
    places: ['b', 'a', 'c'],
    points: { a: 2, b: 4.5, c: 0 },
    netRub: { a: -200, b: 700, c: -500 },
  };

  it('место, число участников, очки и нетто — как в итоге домена', () => {
    expect(myResult(summary, 'a')).toEqual({ place: 2, of: 3, points: 2, netRub: -200 });
    expect(myResult(summary, 'b')).toEqual({ place: 1, of: 3, points: 4.5, netRub: 700 });
  });

  it('не играл — null', () => {
    expect(myResult(summary, 'z')).toBeNull();
  });
});

describe('текст', () => {
  it('очки: целые склоняются, дробные — «очка»', () => {
    expect(pointsWord(1)).toBe('очко');
    expect(pointsWord(3)).toBe('очка');
    expect(pointsWord(12)).toBe('очков');
    expect(pointsWord(21)).toBe('очко');
    expect(pointsWord(12.5)).toBe('очка');
    expect(pointsWord(0)).toBe('очков');
  });

  it('число держится за следующее слово', () => {
    expect(keepNumbersTogether('Четверг, 8 октября, 19:00')).toBe('Четверг, 8 октября, 19:00');
    expect(keepNumbersTogether('в 2026 году 3 очка')).toBe('в 2026 году 3 очка');
    expect(keepNumbersTogether('19:00 по Москве')).toBe('19:00 по Москве');
  });

  it('заглавная в начале', () => {
    expect(capitalize('четверг, 8 октября')).toBe('Четверг, 8 октября');
    expect(capitalize('')).toBe('');
  });

  it('число со знаком: плюс, типографский минус, ноль без знака', () => {
    expect(signedNumber(1500)).toBe('+1 500');
    expect(signedNumber(-300)).toBe('−300');
    expect(signedNumber(0)).toBe('0');
  });
});

describe('имена', () => {
  const byId = new Map([['a', { display_name: 'Саша' }]]);

  it('имя по id, пропавший игрок, пустой id', () => {
    expect(playerName(byId, 'a')).toBe('Саша');
    expect(playerName(byId, 'x')).toBe('Игрок без имени');
    expect(playerName(byId, null)).toBeNull();
  });

  it('себя видно сразу', () => {
    expect(nameWithMe(byId, 'a', 'a')).toBe('Саша (ты)');
    expect(nameWithMe(byId, 'a', 'b')).toBe('Саша');
  });
});

describe('pickTraining — тренировка на главной (миграция 023)', () => {
  const ev = (id: string, status: UpcomingLike['status'], scheduled: string, started?: string) => ({
    id,
    status,
    scheduled_at: scheduled,
    started_at: started ?? null,
  });

  it('идущая важнее объявленной; из объявленных — ближайшая', () => {
    expect(
      pickTraining(
        [
          ev('soon', 'announced', '2026-10-06T13:00:00Z'),
          ev('live', 'live', '2026-10-06T11:00:00Z', '2026-10-06T11:05:00Z'),
        ],
        NOW,
      )?.id,
    ).toBe('live');
    expect(
      pickTraining(
        [
          ev('later', 'announced', '2026-10-07T13:00:00Z'),
          ev('soon', 'announced', '2026-10-06T13:00:00Z'),
        ],
        NOW,
      )?.id,
    ).toBe('soon');
  });

  it('забытую, завершённую и отменённую всем не показываем', () => {
    expect(
      pickTraining(
        [
          ev('old', 'announced', new Date(NOW - STALE_ANNOUNCE_MS - 1000).toISOString()),
          ev('done', 'finished', '2026-10-06T10:00:00Z'),
          ev('off', 'cancelled', '2026-10-06T13:00:00Z'),
        ],
        NOW,
      ),
    ).toBeNull();
  });
});
