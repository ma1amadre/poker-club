import { describe, expect, it } from 'vitest';
import type { AchievementInput } from './achievements.ts';
import type { ScoredPrediction } from './predictions.ts';
import { eveningRecap, standingPlace } from './recap.ts';
import { seasonStandings } from './season.ts';
import { playEvening, simpleEvening } from './test-utils.ts';

const q4 = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;

// Сезон 2026-Q4. Очки: N − место + 0.5·KO + 1 за победу.
// e1: A, B, C, D без нокаутов → A 4, B 2, C 1, D 0.
const e1 = simpleEvening('e1', q4(1), ['A', 'B', 'C', 'D']);
// e2: B, A, C, D → B 4, A 2. После e2 A и B делят 1-е (6 очков, 1 победа, 0 KO).
const e2 = simpleEvening('e2', q4(8), ['B', 'A', 'C', 'D']);
// e3: D выбивают C и A вместе (сплит, первый нокаут клуба), B — C, B ребай, B — A, A — C.
// Места C, A, B, D. KO: C 3 (D/2, B, A), A 2 (D/2, B). Очки: C 3+1.5+1 = 5.5, A 2+1 = 3, B 1, D 0.
const e3 = playEvening(
  'e3',
  q4(15),
  ['A', 'B', 'C', 'D'],
  [
    ['bust', 'D', ['C', 'A']],
    ['bust', 'B', ['C']],
    ['rebuy', 'B'],
    ['bust', 'B', ['A']],
    ['bust', 'A', ['C']],
  ],
);

const predictions: ScoredPrediction[] = [
  { eveningId: 'e3', playerId: 'A', winner: 3, firstOut: 2, total: 5 },
  { eveningId: 'e3', playerId: 'B', winner: 0, firstOut: 2, total: 2 },
  { eveningId: 'e3', playerId: 'E', winner: 3, firstOut: 0, total: 3 }, // не играл
];

function input(extra: Partial<AchievementInput> = {}): AchievementInput {
  return {
    summaries: [e3, e1, e2], // порядок любой
    excluded: new Set(),
    predictions,
    stars: [],
    bestN: 10,
    currentSeasonKey: '2026-Q4',
    ...extra,
  };
}

describe('«Твой вечер»', () => {
  it('нокауты в обе стороны: сплит считается каждому и помечен', () => {
    const a = eveningRecap(input(), 'e3', 'A');
    expect(a).not.toBeNull();
    expect(a?.place).toBe(2);
    expect(a?.points).toBe(3);
    expect(a?.kos).toBe(2);
    expect(a?.kosBy).toEqual([
      { victimId: 'B', count: 1, shared: 0 },
      { victimId: 'D', count: 1, shared: 1 },
    ]);
    expect(a?.bustedBy).toEqual([{ by: ['C'], final: true }]);

    const c = eveningRecap(input(), 'e3', 'C');
    expect(c?.kosBy).toEqual([
      { victimId: 'A', count: 1, shared: 0 },
      { victimId: 'B', count: 1, shared: 0 },
      { victimId: 'D', count: 1, shared: 1 },
    ]);
    expect(c?.bustedBy).toEqual([]);
  });

  it('каждый вылет отдельно; не последний — не окончательный', () => {
    const b = eveningRecap(input(), 'e3', 'B');
    expect(b?.rebuys).toBe(1);
    expect(b?.bustedBy).toEqual([
      { by: ['C'], final: false },
      { by: ['A'], final: true },
    ]);
  });

  it('прогноз: что угадано и сколько очков Оракула', () => {
    expect(eveningRecap(input(), 'e3', 'A')?.prediction).toEqual({
      made: true,
      winnerHit: true,
      firstOutHit: true,
      points: 5,
    });
    expect(eveningRecap(input(), 'e3', 'B')?.prediction).toEqual({
      made: true,
      winnerHit: false,
      firstOutHit: true,
      points: 2,
    });
    expect(eveningRecap(input(), 'e3', 'D')?.prediction).toEqual({
      made: false,
      winnerHit: false,
      firstOutHit: false,
      points: 0,
    });
  });

  it('прогнозист, который не играл, получает карточку без мест; посторонний — null', () => {
    const e = eveningRecap(input(), 'e3', 'E');
    expect(e?.played).toBe(false);
    expect(e?.place).toBeNull();
    expect(e?.points).toBeNull();
    expect(e?.seasonPlaceAfter).toBeNull();
    expect(e?.prediction.points).toBe(3);
    expect(eveningRecap(input(), 'e3', 'Z')).toBeNull();
    expect(eveningRecap(input(), 'nope', 'A')).toBeNull();
  });

  it('место в сезоне до и после вечера', () => {
    // До e3: A 6, B 6 (делят 1-е), C 2, D 0. После: A 9, C 7.5, B 7, D 0.
    const c = eveningRecap(input(), 'e3', 'C');
    expect([c?.seasonPlaceBefore, c?.seasonPlaceAfter, c?.seasonPlaceDelta]).toEqual([3, 2, 1]);
    const b = eveningRecap(input(), 'e3', 'B');
    expect([b?.seasonPlaceBefore, b?.seasonPlaceAfter, b?.seasonPlaceDelta]).toEqual([1, 3, -2]);
    // Первый вечер сезона: «до» места нет.
    const first = eveningRecap(input(), 'e1', 'A');
    expect([first?.seasonPlaceBefore, first?.seasonPlaceAfter, first?.seasonPlaceDelta]).toEqual([
      null,
      1,
      null,
    ]);
  });

  it('место в сезоне — с замороженными «лучшими N»', () => {
    // N = 1: до e3 A 4, B 4, C 1; после A 4, B 4, C 5.5 → C с 3-го на 1-е.
    const c = eveningRecap(input({ bestNBySeason: { '2026-Q4': 1 } }), 'e3', 'C');
    expect([c?.seasonPlaceBefore, c?.seasonPlaceAfter, c?.seasonPlaceDelta]).toEqual([3, 1, 2]);
  });

  it('новые ачивки — только этого вечера и этого игрока', () => {
    const c = eveningRecap(input(), 'e3', 'C');
    expect(c?.newAchievements.map((a) => a.code).sort()).toEqual([
      'clean_win',
      'first_blood',
      'hunter',
    ]);
    // Уровень и «впервые» — как у computeAchievements: первый «Охотник» C — уровень I.
    expect(c?.newAchievements.find((a) => a.code === 'hunter')).toMatchObject({
      level: 1,
      first: true,
      targetId: null,
    });
    expect(eveningRecap(input(), 'e3', 'A')?.newAchievements.map((a) => a.code)).toEqual([
      'first_blood',
    ]);
    // e2: B выигрывает без ребаев — «Чистая победа»; у A в e2 ачивок нет.
    expect(eveningRecap(input(), 'e2', 'B')?.newAchievements.map((a) => a.code)).toEqual([
      'clean_win',
    ]);
    expect(eveningRecap(input(), 'e2', 'A')?.newAchievements).toEqual([]);
  });

  it('гость: без ачивок и мест в сезоне, но с нокаутами и прогнозом', () => {
    const d = eveningRecap(input({ excluded: new Set(['C']) }), 'e3', 'C');
    expect(d?.guest).toBe(true);
    expect(d?.kos).toBe(3);
    expect(d?.newAchievements).toEqual([]);
    expect(d?.seasonPlaceBefore).toBeNull();
    expect(d?.seasonPlaceAfter).toBeNull();
    // Рекорды игрока гостю не засчитываются — остаются рекорды самого вечера.
    expect(d?.records.every((r) => r.playerIds.length === 0)).toBe(true);
  });

  it('звания и рекорды вечера', () => {
    // Форма: после e1 — A, после e2 — B (равная сумма, но B лучше в последнем вечере), после e3 — A.
    expect(eveningRecap(input(), 'e3', 'D')?.titleChanges).toEqual([
      { title: 'form', from: 'B', to: 'A', victimId: null, eveningId: 'e3' },
    ]);
    const c = eveningRecap(input(), 'e3', 'C');
    expect(c?.records.map((r) => [r.kind, r.status, r.playerIds])).toEqual([
      ['biggest_win', 'new', ['C']],
      ['most_kos', 'new', ['C']],
      ['biggest_pool', 'new', []],
      ['longest_game', 'new', []],
    ]);
    // У A — только рекорды самого вечера.
    expect(eveningRecap(input(), 'e3', 'A')?.records.map((r) => r.kind)).toEqual([
      'biggest_pool',
      'longest_game',
    ]);
  });
});

describe('standingPlace', () => {
  it('место с дележом, как на главной', () => {
    const rows = seasonStandings([e1, e2], { bestN: 10, excluded: new Set() });
    expect(['A', 'B', 'C', 'D', 'Z'].map((id) => standingPlace(rows, id))).toEqual([
      1,
      1,
      3,
      4,
      null,
    ]);
  });
});
