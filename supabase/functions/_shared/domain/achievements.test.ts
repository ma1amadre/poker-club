import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_META,
  computeAchievements,
  diffAchievements,
  titles,
  type Achievement,
  type AchievementCode,
  type AchievementInput,
} from './achievements.ts';
import type { ScoredPrediction } from './predictions.ts';
import { seasonKey } from './season.ts';
import type { EveningSummary } from './summary.ts';
import { playEvening, simpleEvening, type Step } from './test-utils.ts';

// Q3 2026 — завершённый сезон, Q4 — текущий.
const CURRENT = '2026-Q4';
const q3 = (n: number) => `2026-07-${String(n).padStart(2, '0')}T16:00:00.000Z`;
const q4 = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;

function run(summaries: EveningSummary[], extra: Partial<AchievementInput> = {}): Achievement[] {
  return computeAchievements({
    summaries,
    excluded: new Set(['G']),
    predictions: [],
    stars: [],
    bestN: 10,
    currentSeasonKey: CURRENT,
    ...extra,
  });
}
const only = (list: Achievement[], code: AchievementCode) =>
  list
    .filter((a) => a.code === code)
    .map((a) => [a.playerId, a.eveningId ?? a.seasonKey, a.count] as const);

describe('ачивки', () => {
  it('у каждого кода есть русское название и описание', () => {
    const codes = Object.keys(ACHIEVEMENT_META);
    expect(codes.sort()).toEqual([
      'champion',
      'comeback',
      'first_blood',
      'hat_trick',
      'hunter',
      'iron_chair',
      'oracle',
      'rebuy_king',
      'star',
      'sworn_enemy',
    ]);
    for (const m of Object.values(ACHIEVEMENT_META)) {
      expect(m.title).toMatch(/[А-Яа-яЁё]/);
      expect(m.description).toMatch(/[А-Яа-яЁё]/);
    }
  });

  describe('first_blood', () => {
    const noKo = simpleEvening('e1', q3(2), ['A', 'B', 'C'], 'none');
    const split = playEvening(
      'e2',
      q3(9),
      ['A', 'B', 'C'],
      [
        ['bust', 'C', ['A', 'B']],
        ['bust', 'B', ['A']],
      ],
    );

    it('первый нокаут клуба; при дележе — всем выбившим', () => {
      // Порядок массива не важен — хронология по дате.
      expect(only(run([split, noKo]), 'first_blood')).toEqual([
        ['A', 'e2', 1],
        ['B', 'e2', 1],
      ]);
    });
    it('последующие нокауты не дают ачивку', () => {
      const earlier = playEvening(
        'e0',
        q3(1),
        ['A', 'B', 'C'],
        [
          ['bust', 'A', ['C']],
          ['bust', 'B', []],
        ],
      );
      expect(only(run([split, noKo, earlier]), 'first_blood')).toEqual([['C', 'e0', 1]]);
    });
    it('без нокаутов — ни у кого; первый нокаут гостя — тоже ни у кого', () => {
      expect(only(run([noKo]), 'first_blood')).toEqual([]);
      const guest = playEvening(
        'g',
        q3(1),
        ['A', 'G', 'C'],
        [
          ['bust', 'A', ['G']],
          ['bust', 'C', []],
        ],
      );
      expect(only(run([guest, split]), 'first_blood')).toEqual([]);
    });
  });

  describe('hunter', () => {
    it('3+ KO за вечер', () => {
      expect(
        only(run([simpleEvening('h', q4(1), ['A', 'B', 'C', 'D'], 'winner')]), 'hunter'),
      ).toEqual([['A', 'h', 1]]);
    });
    it('2 KO — мало; гостю не положено', () => {
      expect(only(run([simpleEvening('h', q4(1), ['A', 'B', 'C'], 'winner')]), 'hunter')).toEqual(
        [],
      );
      expect(
        only(run([simpleEvening('h', q4(1), ['G', 'B', 'C', 'D'], 'winner')]), 'hunter'),
      ).toEqual([]);
    });
  });

  describe('comeback', () => {
    it('победа после 2+ ребаев', () => {
      expect(
        only(run([simpleEvening('c', q4(1), ['A', 'B', 'C'], 'none', { A: 2 })]), 'comeback'),
      ).toEqual([['A', 'c', 1]]);
    });
    it('1 ребай — не камбэк; 2 ребая без победы — тоже', () => {
      expect(
        only(run([simpleEvening('c', q4(1), ['A', 'B', 'C'], 'none', { A: 1 })]), 'comeback'),
      ).toEqual([]);
      expect(
        only(run([simpleEvening('c', q4(1), ['B', 'A', 'C'], 'none', { A: 2 })]), 'comeback'),
      ).toEqual([]);
    });
  });

  describe('rebuy_king', () => {
    const r1 = simpleEvening('r1', q3(2), ['A', 'B', 'C'], 'none', { A: 2, B: 1 });
    const r2 = simpleEvening('r2', q3(9), ['B', 'A', 'G'], 'none', { A: 1, B: 1, G: 5 });
    it('больше всех ребаев за завершённый сезон; гость не отнимает титул', () => {
      expect(only(run([r1, r2]), 'rebuy_king')).toEqual([['A', '2026-Q3', 1]]);
    });
    it('текущий сезон не считается; без ребаев — никому; ничья — обоим', () => {
      const cur = simpleEvening('r3', q4(1), ['A', 'B'], 'none', { B: 10 });
      expect(only(run([cur]), 'rebuy_king')).toEqual([]);
      expect(only(run([simpleEvening('z', q3(2), ['A', 'B'])]), 'rebuy_king')).toEqual([]);
      const tie = simpleEvening('t', q3(2), ['A', 'B', 'C'], 'none', { A: 1, B: 1 });
      expect(only(run([tie]), 'rebuy_king')).toEqual([
        ['A', '2026-Q3', 1],
        ['B', '2026-Q3', 1],
      ]);
    });
  });

  describe('iron_chair', () => {
    const i1 = simpleEvening('i1', q3(2), ['A', 'B', 'C']);
    const i2 = simpleEvening('i2', q3(9), ['A', 'B']);
    const i3 = simpleEvening('i3', q3(16), ['C', 'A', 'G']);
    it('все вечера завершённого сезона', () => {
      expect(only(run([i1, i2, i3]), 'iron_chair')).toEqual([['A', '2026-Q3', 1]]);
    });
    it('пропустил хоть один — нет; текущий сезон — нет', () => {
      expect(only(run([i1, i2, i3]), 'iron_chair').some(([p]) => p === 'B' || p === 'C')).toBe(
        false,
      );
      expect(only(run([simpleEvening('x', q4(1), ['A', 'B'])]), 'iron_chair')).toEqual([]);
    });
  });

  describe('hat_trick', () => {
    it('3 победы подряд в вечерах, где играл (пропуск вечера серию не рвёт)', () => {
      const list = [
        simpleEvening('h1', q4(1), ['A', 'B']),
        simpleEvening('h2', q4(2), ['A', 'B']),
        simpleEvening('h3', q4(3), ['B', 'C']), // A не играл
        simpleEvening('h4', q4(4), ['A', 'B']),
      ];
      expect(only(run(list), 'hat_trick')).toEqual([['A', 'h4', 1]]);
    });
    it('проигрыш рвёт серию; 6 побед подряд — два хет-трика', () => {
      const broken = [
        simpleEvening('k1', q4(1), ['A', 'B']),
        simpleEvening('k2', q4(2), ['A', 'B']),
        simpleEvening('k3', q4(3), ['B', 'A']),
        simpleEvening('k4', q4(4), ['A', 'B']),
      ];
      expect(only(run(broken), 'hat_trick')).toEqual([]);
      const six = [1, 2, 3, 4, 5, 6].map((n) => simpleEvening(`s${n}`, q4(n), ['A', 'B']));
      expect(only(run(six), 'hat_trick')).toEqual([
        ['A', 's3', 1],
        ['A', 's6', 1],
      ]);
    });
  });

  describe('sworn_enemy', () => {
    const steps: Step[] = [
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['A', 'C']],
      ['rebuy', 'B'], // сплит считается обоим
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['A']], // 4-й нокаут A по B
      ['bust', 'C', ['A']],
    ];
    const s1 = playEvening('s1', q4(1), ['A', 'B', 'C'], steps);
    it('5 нокаутов одного и того же игрока — в вечере, где случился 5-й', () => {
      const s2 = simpleEvening('s2', q4(8), ['A', 'B'], 'winner');
      expect(only(run([s1, s2]), 'sworn_enemy')).toEqual([['A', 's2', 1]]);
      // Шестой нокаут ачивку не повторяет.
      const s3 = simpleEvening('s3', q4(15), ['A', 'B'], 'winner');
      expect(only(run([s1, s2, s3]), 'sworn_enemy')).toEqual([['A', 's2', 1]]);
    });
    it('4 нокаута — ещё нет', () => {
      expect(only(run([s1]), 'sworn_enemy')).toEqual([]);
    });
  });

  describe('oracle', () => {
    const ev = [
      simpleEvening('o1', q4(1), ['A', 'B']),
      simpleEvening('o2', q4(2), ['B', 'A']),
      simpleEvening('o3', q4(3), ['A', 'B']),
      simpleEvening('o4', q4(4), ['A', 'B']),
    ];
    const p = (playerId: string, eveningId: string, hit: boolean): ScoredPrediction => ({
      playerId,
      eveningId,
      winner: hit ? 3 : 0,
      firstOut: 0,
      total: hit ? 3 : 0,
    });
    it('3 угаданных победителя подряд в вечерах, где делал прогноз', () => {
      // X не прогнозировал o3 — серия o1, o2, o4 не прерывается.
      const preds = [p('X', 'o4', true), p('X', 'o1', true), p('X', 'o2', true)];
      expect(only(run(ev, { predictions: preds }), 'oracle')).toEqual([['X', 'o4', 1]]);
    });
    it('промах рвёт серию; прогноз на незавершённый вечер не считается; гостю не положено', () => {
      const preds = [
        p('Y', 'o1', true),
        p('Y', 'o2', false),
        p('Y', 'o3', true),
        p('Y', 'o4', true),
        p('Z', 'o1', true),
        p('Z', 'o2', true),
        p('Z', 'o5', true),
        p('G', 'o1', true),
        p('G', 'o2', true),
        p('G', 'o3', true),
      ];
      expect(only(run(ev, { predictions: preds }), 'oracle')).toEqual([]);
    });
  });

  describe('star', () => {
    it('победа в номинации; две номинации — count 2; ничья — обоим', () => {
      const stars = [
        { eveningId: 'e1', category: 'hand' as const, winners: ['A'] },
        { eveningId: 'e1', category: 'bluff' as const, winners: ['A', 'B'] },
        { eveningId: 'e1', category: 'badbeat' as const, winners: ['G'] },
      ];
      expect(only(run([], { stars }), 'star')).toEqual([
        ['A', 'e1', 2],
        ['B', 'e1', 1],
      ]);
    });
    it('без голосов — никому', () => {
      expect(
        only(run([], { stars: [{ eveningId: 'e1', category: 'hand', winners: [] }] }), 'star'),
      ).toEqual([]);
    });
  });

  describe('champion', () => {
    it('1-е место завершённого сезона, гость пропускается', () => {
      const list = [
        simpleEvening('c1', q3(2), ['G', 'A', 'B'], 'winner'),
        simpleEvening('c2', q3(9), ['A', 'B', 'G']),
        simpleEvening('c3', q4(1), ['B', 'A'], 'winner'),
        simpleEvening('c4', q4(2), ['B', 'A'], 'winner'),
      ];
      expect(only(run(list), 'champion')).toEqual([['A', '2026-Q3', 1]]);
    });
    it('текущий сезон чемпиона не даёт', () => {
      expect(only(run([simpleEvening('c', q4(1), ['A', 'B'])]), 'champion')).toEqual([]);
    });
  });

  it('гости не получают ничего', () => {
    const list = [
      simpleEvening('a', q3(2), ['G', 'A', 'B', 'C'], 'winner', { G: 2 }),
      simpleEvening('b', q3(9), ['G', 'A'], 'winner'),
      simpleEvening('c', q3(16), ['G', 'A'], 'winner'),
    ];
    const res = run(list, { stars: [{ eveningId: 'a', category: 'hand', winners: ['G'] }] });
    expect(res.filter((a) => a.playerId === 'G')).toEqual([]);
    // Без исключения тот же гость собрал бы почти всё.
    const raw = computeAchievements({
      summaries: list,
      excluded: new Set(),
      predictions: [],
      bestN: 10,
      currentSeasonKey: CURRENT,
      stars: [{ eveningId: 'a', category: 'hand', winners: ['G'] }],
    });
    expect(new Set(raw.filter((a) => a.playerId === 'G').map((a) => a.code))).toEqual(
      new Set([
        'first_blood',
        'hunter',
        'comeback',
        'rebuy_king',
        'iron_chair',
        'hat_trick',
        'star',
        'champion',
      ]),
    );
  });
});

/** Ручной итог — только для званий: нужны участники, очки и пары нокаутов. */
function manual(
  id: string,
  date: string,
  points: Record<string, number>,
  koPairs: [string, string][] = [],
): EveningSummary {
  return {
    eveningId: id,
    date,
    seasonKey: seasonKey(date),
    entrants: Object.keys(points),
    places: [],
    points,
    netRub: {},
    kos: {},
    koPairs,
    rebuys: {},
    bustLevel: {},
    firstBustPlayerId: null,
    busts: [],
  };
}

describe('звания', () => {
  it('немезида: кто чаще всех выбивал, минимум 2 раза; при равенстве — догнавший последним', () => {
    const steps: Step[] = [
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['C']],
      ['rebuy', 'B'],
      ['bust', 'C', ['A']],
      ['rebuy', 'C'],
      ['bust', 'D', ['A']],
      ['rebuy', 'D'],
      ['bust', 'D', ['A']],
      ['rebuy', 'D'],
      ['bust', 'D', ['E']],
      ['rebuy', 'D'],
      ['bust', 'D', ['E']],
      ['rebuy', 'D'],
      // гость выбивает E трижды — немезидой стать не может
      ['bust', 'E', ['G']],
      ['rebuy', 'E'],
      ['bust', 'E', ['G']],
      ['rebuy', 'E'],
      ['bust', 'E', ['G']],
      ['rebuy', 'E'],
      ['bust', 'G', []],
      ['bust', 'E', []],
      ['bust', 'D', []],
      ['bust', 'C', []],
      ['bust', 'B', []],
    ];
    const ev = playEvening('n1', q4(1), ['A', 'B', 'C', 'D', 'E', 'G'], steps);
    const t = titles({ summaries: [ev], excluded: new Set(['G']) });
    expect(t.nemesis).toEqual({ A: null, B: 'A', C: null, D: 'E', E: null });
  });

  it('немезида переходит: догнавший по ходу истории забирает звание', () => {
    const list = [
      manual('m1', q4(1), { A: 1, B: 0, C: 0 }, [
        ['A', 'B'],
        ['A', 'B'],
      ]),
      manual('m2', q4(2), { A: 1, B: 0, C: 0 }, [
        ['C', 'B'],
        ['C', 'B'],
      ]),
    ];
    expect(titles({ summaries: list, excluded: new Set() }).nemesis.B).toBe('C');
    // Порядок массива не важен: по датам m2 позже.
    expect(titles({ summaries: [...list].reverse(), excluded: new Set() }).nemesis.B).toBe('C');
  });

  it('форма: лучшая сумма за последние 5 вечеров клуба', () => {
    const list = [
      simpleEvening('f1', q4(1), ['A', 'X1', 'X2', 'X3', 'X4', 'X5'], 'winner'), // A 8.5 — за окном
      simpleEvening('f2', q4(2), ['B', 'A', 'C']),
      simpleEvening('f3', q4(3), ['C', 'B', 'A']),
      simpleEvening('f4', q4(4), ['B', 'C', 'A']),
      simpleEvening('f5', q4(5), ['C', 'A', 'B']),
      simpleEvening('f6', q4(6), ['A', 'B', 'C']),
    ];
    // В окне f2–f6: B 3+1+3+0+1 = 8, C 7, A 5. С f1 у A было бы 13.5.
    expect(titles({ summaries: list, excluded: new Set() }).form).toBe('B');
    expect(titles({ summaries: list.slice(0, 5), excluded: new Set() }).form).toBe('A');
  });

  it('форма: при равной сумме решает последний вечер; полная ничья или нули — никому; гость не берёт', () => {
    const tie = [
      simpleEvening('g1', q4(1), ['A', 'B', 'C']),
      simpleEvening('g2', q4(2), ['B', 'A', 'C']),
    ];
    expect(titles({ summaries: tie, excluded: new Set() }).form).toBe('B');
    expect(
      titles({ summaries: [manual('x', q4(1), { A: 2, B: 2 })], excluded: new Set() }).form,
    ).toBeNull();
    expect(
      titles({ summaries: [manual('x', q4(1), { A: 0, B: 0 })], excluded: new Set() }).form,
    ).toBeNull();
    expect(
      titles({ summaries: [manual('x', q4(1), { G: 5, A: 2 })], excluded: new Set(['G']) }).form,
    ).toBe('A');
    expect(titles({ summaries: [], excluded: new Set() })).toEqual({ nemesis: {}, form: null });
  });
});

describe('diffAchievements', () => {
  it('новые строки и прирост count — для поста бота', () => {
    const e1 = simpleEvening('d1', q4(1), ['A', 'B', 'C', 'D'], 'winner');
    const e2 = simpleEvening('d2', q4(2), ['B', 'A', 'C', 'D'], 'winner');
    const stars1 = [{ eveningId: 'd2', category: 'hand' as const, winners: ['C'] }];
    const stars2 = [...stars1, { eveningId: 'd2', category: 'bluff' as const, winners: ['C'] }];
    const before = run([e1], { stars: stars1 });
    const after = run([e1, e2], { stars: stars2 });
    expect(diffAchievements(before, after)).toEqual([
      { playerId: 'B', code: 'hunter', eveningId: 'd2', seasonKey: null, count: 1 },
      { playerId: 'C', code: 'star', eveningId: 'd2', seasonKey: null, count: 1 },
    ]);
    expect(diffAchievements(after, after)).toEqual([]);
    expect(diffAchievements([], before)).toEqual(before);
  });
});
