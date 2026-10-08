import { seasonStandings, type StandingRow } from '@domain/season.ts';
import { playEvening, simpleEvening } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import {
  defaultRatingSeason,
  markCountedEvenings,
  moneyPlaces,
  oraclePlaces,
  reigningChampions,
  seasonOptions,
  seasonPredictionScores,
  standingPlaces,
} from './stats';
import { formatSeason, formatSeasonGenitive, seasonMonths } from '../../shared/lib/season';

const oct = (d: number) => `2026-10-${String(d).padStart(2, '0')}T16:00:00.000Z`;

function row(playerId: string, total: number, wins = 0, kos = 0): StandingRow {
  return { playerId, total, counted: [], played: 1, wins, kos, netRub: 0 };
}

describe('подписи сезонов', () => {
  it('квартал и месяцы по-русски', () => {
    expect(formatSeason('2026-Q4')).toBe('4-й квартал 2026');
    expect(formatSeason('2027-Q1')).toBe('1-й квартал 2027');
    expect(seasonMonths('2026-Q3')).toBe('июль–сентябрь');
    expect(formatSeasonGenitive('2026-Q3')).toBe('3-го квартала 2026');
  });

  it('непонятный ключ показывается как есть', () => {
    expect(formatSeason('весна')).toBe('весна');
    expect(seasonMonths('весна')).toBe('');
  });

  it('в выборе — все сезоны с вечерами и текущий, новые сверху, без повторов', () => {
    const list = seasonOptions(
      [{ seasonKey: '2026-Q3' }, { seasonKey: '2025-Q4' }, { seasonKey: '2026-Q3' }],
      '2026-Q4',
    );
    expect(list).toEqual(['2026-Q4', '2026-Q3', '2025-Q4']);
  });
});

describe('места с дележом', () => {
  it('равные строки делят место, следующее пропускается', () => {
    const rows = [row('a', 10, 2, 1), row('b', 8, 1, 0), row('c', 8, 1, 0), row('d', 5)];
    expect(standingPlaces(rows)).toEqual([1, 2, 2, 4]);
  });

  it('равные очки, но разные победы — разные места (как sameRank домена)', () => {
    expect(standingPlaces([row('a', 8, 2), row('b', 8, 1)])).toEqual([1, 2]);
  });
});

describe('вечера в зачёте', () => {
  // A выигрывает 1-й и 3-й вечер, во 2-м — последний.
  const summaries = [
    simpleEvening('e1', oct(1), ['A', 'B', 'C']),
    simpleEvening('e2', oct(8), ['B', 'C', 'A']),
    simpleEvening('e3', oct(15), ['A', 'C', 'B']),
  ];

  it('лучшие N из таблицы домена помечаются, порядок хронологический', () => {
    const rows = seasonStandings(summaries, { bestN: 2, excluded: new Set() });
    const a = rows.find((r) => r.playerId === 'A');
    if (!a) throw new Error('нет строки A');
    const marks = markCountedEvenings(summaries, 'A', a.counted);
    expect(marks.map((m) => [m.eveningId, m.counted])).toEqual([
      ['e1', true],
      ['e2', false],
      ['e3', true],
    ]);
    // Сумма помеченных совпадает с total домена.
    expect(marks.filter((m) => m.counted).reduce((s, m) => s + m.points, 0)).toBe(a.total);
  });

  it('при равных очках в зачёт идёт более ранний вечер', () => {
    const rows = seasonStandings(summaries, { bestN: 1, excluded: new Set() });
    const a = rows.find((r) => r.playerId === 'A');
    if (!a) throw new Error('нет строки A');
    const marks = markCountedEvenings(summaries, 'A', a.counted);
    expect(marks.filter((m) => m.counted).map((m) => m.eveningId)).toEqual(['e1']);
  });

  it('если вечеров не больше N — в зачёте все', () => {
    const rows = seasonStandings(summaries, { bestN: 10, excluded: new Set() });
    const c = rows.find((r) => r.playerId === 'C');
    if (!c) throw new Error('нет строки C');
    expect(markCountedEvenings(summaries, 'C', c.counted).every((m) => m.counted)).toBe(true);
  });

  it('дробные очки за нокауты сопоставляются точно', () => {
    // B выбивает C и A — 2 KO: 2 + 2·0,5 + 1 = 4 очка.
    const s = playEvening(
      'k1',
      oct(22),
      ['A', 'B', 'C'],
      [
        ['bust', 'C', ['B']],
        ['bust', 'A', ['B']],
      ],
    );
    const all = [...summaries, s];
    const rows = seasonStandings(all, { bestN: 1, excluded: new Set() });
    const b = rows.find((r) => r.playerId === 'B');
    if (!b) throw new Error('нет строки B');
    expect(b.counted).toEqual([4]);
    const marks = markCountedEvenings(all, 'B', b.counted);
    expect(marks.filter((m) => m.counted).map((m) => m.eveningId)).toEqual(['k1']);
  });

  it('вечера, где игрок не играл, не попадают в список', () => {
    const marks = markCountedEvenings(summaries, 'Z', []);
    expect(marks).toEqual([]);
  });
});

describe('места в деньгах и оракуле', () => {
  it('деньги делят место только при равном нетто', () => {
    const rows = [
      { ...row('a', 0), netRub: 900 },
      { ...row('b', 9), netRub: 900 },
      { ...row('c', 1), netRub: -400 },
    ];
    expect(moneyPlaces(rows)).toEqual([1, 1, 3]);
  });

  it('оракул делит место при равных очках и угаданных победителях', () => {
    const o = (playerId: string, total: number, winnerHits: number) => ({
      playerId,
      total,
      predictions: 3,
      winnerHits,
      firstOutHits: 0,
    });
    expect(oraclePlaces([o('a', 5, 1), o('b', 5, 1), o('c', 5, 0), o('d', 2, 0)])).toEqual([
      1, 1, 3, 4,
    ]);
  });
});

describe('прогнозы сезона', () => {
  const score = (eveningId: string, playerId: string, total: number) => ({
    eveningId,
    playerId,
    winner: 0 as const,
    firstOut: 0 as const,
    total,
  });
  const seasons = new Map([
    ['e1', '2026-Q3'],
    ['e2', '2026-Q4'],
  ]);

  it('только вечера выбранного сезона, без гостей и вечеров без итога', () => {
    const list = [
      score('e1', 'A', 3),
      score('e2', 'A', 2),
      score('e2', 'G', 5),
      score('x', 'B', 3),
    ];
    const picked = seasonPredictionScores(list, (id) => seasons.get(id), '2026-Q4', new Set(['G']));
    expect(picked.map((p) => [p.eveningId, p.playerId])).toEqual([['e2', 'A']]);
  });
});

describe('действующий чемпион', () => {
  const hall = [
    { seasonKey: '2026-Q3', champions: ['A'], total: 30 },
    { seasonKey: '2026-Q2', champions: ['B', 'C'], total: 20 },
  ];

  it('чемпион прошлого сезона носит значок в текущем', () => {
    expect(reigningChampions(hall, '2026-Q4')).toEqual({ seasonKey: '2026-Q3', champions: ['A'] });
  });

  it('через сезон значок снимается', () => {
    expect(reigningChampions(hall, '2027-Q1')).toBeNull();
  });

  it('ключ после первого квартала — четвёртый квартал прошлого года', () => {
    expect(
      reigningChampions([{ seasonKey: '2026-Q4', champions: ['D'], total: 1 }], '2027-Q1'),
    ).toEqual({ seasonKey: '2026-Q4', champions: ['D'] });
  });

  it('битый ключ сезона не роняет экран', () => {
    expect(reigningChampions(hall, 'весна')).toBeNull();
  });
});

describe('места и участники в вечерах сезона', () => {
  it('место и число участников берутся из итога вечера', () => {
    const s = simpleEvening('m1', oct(1), ['B', 'A', 'C']);
    expect(markCountedEvenings([s], 'A', [s.points.A ?? 0])).toEqual([
      { eveningId: 'm1', date: oct(1), points: s.points.A, place: 2, entrants: 3, counted: true },
    ]);
  });
});

describe('сезон рейтинга по умолчанию', () => {
  it('текущий; пока в нём нет вечеров — последний сезон с вечерами (финальная таблица)', () => {
    const q = (seasonKey: string) => ({ seasonKey });
    expect(defaultRatingSeason([q('2026-Q3'), q('2026-Q4')], '2026-Q4')).toBe('2026-Q4');
    expect(defaultRatingSeason([q('2026-Q2'), q('2026-Q3')], '2026-Q4')).toBe('2026-Q3');
    expect(defaultRatingSeason([], '2026-Q4')).toBe('2026-Q4');
  });
});
