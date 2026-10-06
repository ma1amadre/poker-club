import { describe, expect, it } from 'vitest';
import {
  allTimeStandings,
  bestNForSeason,
  compareSeasonKeys,
  hallOfFame,
  moneyStandings,
  oracleStandings,
  previousSeasonKey,
  seasonChampions,
  seasonKey,
  seasonStandings,
} from './season.ts';
import type { EveningSummary } from './summary.ts';
import { simpleEvening } from './test-utils.ts';

/** Итог вечера, собранный вручную: для таблиц нужны только места, очки, KO и деньги. */
function mk(
  id: string,
  date: string,
  points: Record<string, number>,
  extra: Partial<EveningSummary> = {},
): EveningSummary {
  const places = Object.entries(points)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
  return {
    eveningId: id,
    date,
    seasonKey: seasonKey(date),
    entrants: Object.keys(points),
    places,
    points,
    netRub: {},
    kos: {},
    koPairs: [],
    rebuys: {},
    bustLevel: {},
    firstBustPlayerId: null,
    busts: [],
    ...extra,
  };
}

describe('seasonKey', () => {
  it('квартал по Москве, а не по UTC', () => {
    expect(seasonKey('2026-10-08T16:00:00.000Z')).toBe('2026-Q4');
    // 31.12 23:30 UTC = 01.01 02:30 МСК → уже следующий год и квартал.
    expect(seasonKey('2026-12-31T23:30:00.000Z')).toBe('2027-Q1');
    expect(seasonKey('2026-12-31T23:30:00.000Z', 'UTC')).toBe('2026-Q4');
    expect(seasonKey('2026-12-31T20:59:59.000Z')).toBe('2026-Q4');
    expect(seasonKey('2026-12-31T21:00:00.000Z')).toBe('2027-Q1');
    expect(seasonKey('2026-03-31T20:59:00Z')).toBe('2026-Q1');
    expect(seasonKey('2026-03-31T21:00:00Z')).toBe('2026-Q2');
    expect(seasonKey('2026-06-30T21:00:00+00:00')).toBe('2026-Q3');
    expect(seasonKey('2026-09-30T23:00:00+03:00')).toBe('2026-Q3');
  });
  it('некорректная дата — ошибка', () => {
    expect(() => seasonKey('вчера')).toThrow();
  });
  it('соседние сезоны и сравнение', () => {
    expect(previousSeasonKey('2027-Q1')).toBe('2026-Q4');
    expect(previousSeasonKey('2026-Q3')).toBe('2026-Q2');
    expect(() => previousSeasonKey('2026-Q5')).toThrow();
    expect(compareSeasonKeys('2026-Q4', '2027-Q1')).toBeLessThan(0);
    expect(compareSeasonKeys('2026-Q4', '2026-Q4')).toBe(0);
  });
});

describe('таблица сезона', () => {
  const Q4 = (d: number) => `2026-10-${String(d).padStart(2, '0')}T16:00:00.000Z`;
  const evenings = [
    mk('e1', Q4(1), { A: 7, B: 3, G: 5 }, { kos: { A: 2 }, netRub: { A: 1000, B: -500, G: -500 } }),
    mk('e2', Q4(8), { A: 1, B: 6, G: 3 }, { netRub: { A: -500, B: 1200, G: -700 } }),
    mk('e3', Q4(15), { A: 2, B: 5 }, { netRub: { A: -300, B: 300 } }),
    mk('old', '2026-09-20T16:00:00.000Z', { A: 100 }),
  ];
  const guests = new Set(['G']);

  it('лучшие N вечеров, гости исключены, вечера другого сезона не считаются', () => {
    const rows = seasonStandings(evenings, { bestN: 2, excluded: guests, seasonKey: '2026-Q4' });
    expect(rows).toEqual([
      { playerId: 'B', total: 11, counted: [6, 5], played: 3, wins: 2, kos: 0, netRub: 1000 },
      { playerId: 'A', total: 9, counted: [7, 2], played: 3, wins: 1, kos: 2, netRub: 200 },
    ]);
  });

  it('bestN больше числа вечеров — считаются все', () => {
    const rows = seasonStandings(evenings, {
      bestN: 10,
      excluded: new Set(),
      seasonKey: '2026-Q4',
    });
    expect(rows.map((r) => [r.playerId, r.total])).toEqual([
      ['B', 14],
      ['A', 10],
      ['G', 8],
    ]);
  });

  it('при равенстве очков выше тот, у кого больше побед, потом нокаутов', () => {
    const rows = seasonStandings(
      [mk('x', Q4(1), { A: 3, B: 2 }, { kos: { B: 1 } }), mk('y', Q4(2), { A: 0, B: 1, C: 2 })],
      { bestN: 10, excluded: new Set() },
    );
    // A и B по 3 очка: у A победа, у B только нокаут — победа важнее.
    expect(rows.map((r) => r.playerId)).toEqual(['A', 'B', 'C']);
    const tie = seasonStandings(
      [mk('x', Q4(1), { A: 1, B: 1, C: 2 }, { places: ['C', 'A', 'B'], kos: { B: 1 } })],
      { bestN: 10, excluded: new Set() },
    );
    expect(tie.map((r) => r.playerId)).toEqual(['C', 'B', 'A']);
  });

  it('всё время и деньги', () => {
    const all = allTimeStandings(evenings, { excluded: guests });
    expect(all.map((r) => [r.playerId, r.total, r.played])).toEqual([
      ['A', 110, 4],
      ['B', 14, 3],
    ]);
    const money = moneyStandings(evenings, { excluded: guests, seasonKey: '2026-Q4' });
    expect(money.map((r) => [r.playerId, r.netRub])).toEqual([
      ['B', 1000],
      ['A', 200],
    ]);
  });

  it('чемпионы: делят первую строку; пусто без очков', () => {
    expect(
      seasonChampions(
        seasonStandings([mk('x', Q4(1), { A: 0, B: 0 })], { bestN: 1, excluded: new Set() }),
      ),
    ).toEqual([]);
    const rows = seasonStandings([mk('x', Q4(1), { A: 1, B: 1 }, { places: [] })], {
      bestN: 1,
      excluded: new Set(),
    });
    expect(seasonChampions(rows).sort()).toEqual(['A', 'B']);
  });

  it('зал славы: только завершённые сезоны, новые сверху, без гостей', () => {
    const list = [
      ...evenings,
      mk('q2', '2026-05-01T16:00:00.000Z', { G: 50, B: 4 }),
      mk('q1', '2026-02-01T16:00:00.000Z', { A: 0 }),
    ];
    expect(hallOfFame(list, { bestN: 10, excluded: guests, currentSeasonKey: '2026-Q4' })).toEqual([
      { seasonKey: '2026-Q3', champions: ['A'], total: 100 },
      { seasonKey: '2026-Q2', champions: ['B'], total: 4 },
    ]);
  });

  it('на реальных итогах вечеров', () => {
    const s1 = simpleEvening('s1', Q4(1), ['A', 'B', 'C'], 'winner');
    const s2 = simpleEvening('s2', Q4(8), ['B', 'C', 'A']);
    const rows = seasonStandings([s1, s2], { bestN: 10, excluded: new Set() });
    // s1: A 2+1+1 = 4, B 1, C 0; s2: B 2+1 = 3, C 1, A 0.
    expect(rows.map((r) => [r.playerId, r.total, r.wins, r.kos])).toEqual([
      ['A', 4, 1, 2],
      ['B', 4, 1, 0],
      ['C', 1, 0, 0],
    ]);
  });
});

describe('«лучшие N» закрытых сезонов (season_rules)', () => {
  const Q3 = (d: number) => `2026-09-${String(d).padStart(2, '0')}T16:00:00.000Z`;
  const Q4 = (d: number) => `2026-10-${String(d).padStart(2, '0')}T16:00:00.000Z`;
  // В 2026-Q3 у A один крупный вечер (5), у B два по 3: при N = 10 чемпион B (6 > 5), при N = 1 — A.
  const q3 = [
    mk('a', Q3(3), { A: 5, B: 0 }),
    mk('b', Q3(10), { B: 3, A: 0 }),
    mk('c', Q3(17), { B: 3, A: 0 }),
  ];
  const q4 = [mk('d', Q4(1), { A: 2, B: 0 }), mk('e', Q4(8), { B: 1, A: 0 })];
  const frozen = { '2026-Q3': 10 };
  const none = new Set<string>();

  it('замороженное значение закрытого сезона, иначе текущее', () => {
    expect(bestNForSeason('2026-Q3', 1, frozen)).toBe(10);
    expect(bestNForSeason('2026-Q4', 1, frozen)).toBe(1);
    expect(bestNForSeason('2026-Q3', 1)).toBe(1);
    // Мусор в таблице не ломает подсчёт: БД такого не пропустит, но домен не доверяет на слово.
    expect(bestNForSeason('2026-Q3', 4, { '2026-Q3': 0 })).toBe(4);
    expect(bestNForSeason('2026-Q3', 4, { '2026-Q3': 2.5 })).toBe(4);
  });

  it('смена best_n не меняет таблицу закрытого сезона, текущий живёт по настройке', () => {
    const before = seasonStandings([...q3, ...q4], {
      bestN: 10,
      excluded: none,
      seasonKey: '2026-Q3',
    });
    // Админ сменил «лучшие N» на 1 уже в 2026-Q4; 2026-Q3 заморожен прежним значением 10.
    const after = seasonStandings([...q3, ...q4], {
      bestN: 1,
      excluded: none,
      seasonKey: '2026-Q3',
      bestNBySeason: frozen,
    });
    expect(after).toEqual(before);
    expect(after.map((r) => [r.playerId, r.total])).toEqual([
      ['B', 6],
      ['A', 5],
    ]);
    const current = seasonStandings([...q3, ...q4], {
      bestN: 1,
      excluded: none,
      seasonKey: '2026-Q4',
      bestNBySeason: frozen,
    });
    expect(current.map((r) => [r.playerId, r.counted])).toEqual([
      ['A', [2]],
      ['B', [1]],
    ]);
  });

  it('без seasonKey: сезон берётся из итогов, если он один; смешанный список — текущее значение', () => {
    const single = seasonStandings(q3, { bestN: 1, excluded: none, bestNBySeason: frozen });
    expect(single.map((r) => r.total)).toEqual([6, 5]);
    const mixed = seasonStandings([...q3, ...q4], {
      bestN: 1,
      excluded: none,
      bestNBySeason: frozen,
    });
    expect(mixed.map((r) => r.counted.length)).toEqual([1, 1]);
  });

  it('Зал славы стабилен при смене best_n', () => {
    const opts = { excluded: none, currentSeasonKey: '2026-Q4' };
    const was = hallOfFame([...q3, ...q4], { ...opts, bestN: 10 });
    expect(was).toEqual([{ seasonKey: '2026-Q3', champions: ['B'], total: 6 }]);
    expect(hallOfFame([...q3, ...q4], { ...opts, bestN: 1, bestNBySeason: frozen })).toEqual(was);
    // Без заморозки (как до миграции 013) чемпион прошлого сезона сменился бы.
    expect(hallOfFame([...q3, ...q4], { ...opts, bestN: 1 })).toEqual([
      { seasonKey: '2026-Q3', champions: ['A'], total: 5 },
    ]);
  });
});

describe('оракул', () => {
  it('сумма очков прогнозов, участвуют и неигравшие', () => {
    const rows = oracleStandings([
      { eveningId: 'e1', playerId: 'X', winner: 3, firstOut: 2, total: 5 },
      { eveningId: 'e2', playerId: 'X', winner: 0, firstOut: 0, total: 0 },
      { eveningId: 'e1', playerId: 'Y', winner: 3, firstOut: 0, total: 3 },
      { eveningId: 'e2', playerId: 'Y', winner: 0, firstOut: 2, total: 2 },
      { eveningId: 'e1', playerId: 'Z', winner: 0, firstOut: 2, total: 2 },
    ]);
    expect(rows).toEqual([
      { playerId: 'X', total: 5, predictions: 2, winnerHits: 1, firstOutHits: 1 },
      { playerId: 'Y', total: 5, predictions: 2, winnerHits: 1, firstOutHits: 1 },
      { playerId: 'Z', total: 2, predictions: 1, winnerHits: 0, firstOutHits: 1 },
    ]);
  });
});
