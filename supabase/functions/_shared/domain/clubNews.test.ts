import { describe, expect, it } from 'vitest';
import { eveningClubNews, hasClubNews, type ClubNewsInput } from './clubNews.ts';
import { playEvening, simpleEvening } from './test-utils.ts';

const q4 = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;

// Те же вечера, что в recap.test.ts. Очки: N − место + 0.5·KO + 1 за победу.
// e1: A, B, C, D без нокаутов → A 4, B 2, C 1, D 0.
const e1 = simpleEvening('e1', q4(1), ['A', 'B', 'C', 'D']);
// e2: B, A, C, D → B 4, A 2. После e2 A и B делят 1-е (6 очков, 1 победа, 0 KO).
const e2 = simpleEvening('e2', q4(8), ['B', 'A', 'C', 'D']);
// e3: места C, A, B, D; первый вылет — D. После e3: A 9, C 7.5, B 7, D 0.
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

function input(extra: Partial<ClubNewsInput> = {}): ClubNewsInput {
  return {
    summaries: [e3, e1, e2], // порядок любой
    excluded: new Set(),
    predictions: [
      { eveningId: 'e3', playerId: 'A', winnerId: 'C', firstOutId: 'D' }, // оба угаданы
      { eveningId: 'e3', playerId: 'B', winnerId: 'A', firstOutId: 'D' }, // только первый вылет
      { eveningId: 'e3', playerId: 'E', winnerId: 'C', firstOutId: 'B' }, // не играл, победитель
      { eveningId: 'e3', playerId: 'F', winnerId: null, firstOutId: null }, // снят — не считается
      { eveningId: 'e2', playerId: 'C', winnerId: 'B', firstOutId: 'D' }, // другой вечер
    ],
    bestN: 10,
    ...extra,
  };
}

describe('«Жизнь клуба» в посте итогов', () => {
  it('прогнозы: сколько сделано и кто угадал победителя и первый вылет', () => {
    expect(eveningClubNews(input(), 'e3')?.predictions).toEqual({
      made: 3,
      winnerGuessedBy: ['A', 'E'],
      firstOutGuessedBy: ['A', 'B'],
    });
    expect(eveningClubNews(input({ predictions: [] }), 'e3')?.predictions).toEqual({
      made: 0,
      winnerGuessedBy: [],
      firstOutGuessedBy: [],
    });
  });

  it('рекорды и звания — только этого вечера', () => {
    const news = eveningClubNews(input(), 'e3');
    expect(news?.records.map((r) => [r.kind, r.status, r.playerIds])).toEqual([
      ['biggest_win', 'new', ['C']],
      ['most_kos', 'new', ['C']],
      ['biggest_pool', 'new', []],
      ['longest_game', 'new', []],
    ]);
    // Форма: после e2 — B, после e3 — A.
    expect(news?.titleChanges).toEqual([
      { title: 'form', from: 'B', to: 'A', victimId: null, eveningId: 'e3' },
    ]);
    // Первый вечер клуба рекордов не ставит.
    expect(eveningClubNews(input(), 'e1')?.records).toEqual([]);
  });

  it('сезон: делёж первого места распался — лидер один, подъём — у C', () => {
    // До e3: A 6, B 6 (делят 1-е), C 2, D 0. После: A 9, C 7.5, B 7, D 0.
    expect(eveningClubNews(input(), 'e3')?.season).toEqual({
      seasonKey: '2026-Q4',
      leaders: [{ playerId: 'A', total: 9 }],
      leadersBefore: ['A', 'B'],
      climbers: [{ playerId: 'C', from: 3, to: 2 }],
    });
  });

  it('сезон: первое место стали делить двое', () => {
    // После e1 лидер A; после e2 A и B по 6.
    expect(eveningClubNews(input({ summaries: [e1, e2] }), 'e2')?.season).toEqual({
      seasonKey: '2026-Q4',
      leaders: [
        { playerId: 'A', total: 6 },
        { playerId: 'B', total: 6 },
      ],
      leadersBefore: ['A'],
      climbers: [],
    });
  });

  it('сезон: первого вечера сезона, вечера с более поздними в том же сезоне и вечера без сдвигов нет', () => {
    expect(eveningClubNews(input(), 'e1')?.season).toBeNull();
    // Итоги e2 публикуются после e3 (исправленный пост) — о «сейчас» по e2 судить нельзя.
    expect(eveningClubNews(input(), 'e2')?.season).toBeNull();
    // Тот же порядок мест, что и в e1: лидер прежний, никто не поднялся.
    const again = simpleEvening('e2', q4(8), ['A', 'B', 'C', 'D']);
    expect(eveningClubNews(input({ summaries: [e1, again] }), 'e2')?.season).toBeNull();
  });

  it('сезон: вечер прошлого сезона после него в новом сезоне не мешает', () => {
    const q3a = simpleEvening('q3a', '2026-09-03T16:00:00.000Z', ['A', 'B', 'C']);
    const q3b = simpleEvening('q3b', '2026-09-10T16:00:00.000Z', ['C', 'B', 'A']);
    // До q3b: A 3, B 1, C 0; после: C 3, A 3, B 2 → C и A делят 1-е (по 3 очка и 1 победе).
    const season = eveningClubNews(input({ summaries: [q3a, q3b, e1] }), 'q3b')?.season;
    expect(season?.seasonKey).toBe('2026-Q3');
    expect(season?.leaders.map((l) => l.playerId)).toEqual(['A', 'C']);
  });

  it('сезон: с замороженными «лучшими N»', () => {
    // N = 1: до e3 A 4, B 4 (делят 1-е), C 1; после C 5.5 → новый лидер C, остальные не поднялись.
    expect(eveningClubNews(input({ bestNBySeason: { '2026-Q4': 1 } }), 'e3')?.season).toEqual({
      seasonKey: '2026-Q4',
      leaders: [{ playerId: 'C', total: 5.5 }],
      leadersBefore: ['A', 'B'],
      climbers: [],
    });
  });

  it('гость: без мест в сезоне и рекордов игрока', () => {
    const news = eveningClubNews(input({ excluded: new Set(['C']) }), 'e3');
    expect(news?.records.some((r) => r.playerIds.includes('C'))).toBe(false);
    // Рекорды игрока переходят постоянному: у A 2 нокаута — больше, чем у кого-либо раньше.
    expect(news?.records.find((r) => r.kind === 'most_kos')?.playerIds).toEqual(['A']);
    expect(news?.season?.climbers.some((c) => c.playerId === 'C') ?? false).toBe(false);
    expect(news?.season?.leaders.some((l) => l.playerId === 'C') ?? false).toBe(false);
  });

  it('подъём: только наибольший; поровну — все, по новому месту', () => {
    // f1: A, B, C, D, E → A 5, B 3, C 2, D 1, E 0.
    const f1 = simpleEvening('f1', q4(1), ['A', 'B', 'C', 'D', 'E']);
    // f2: D, E, A, B, C → после: A 7, D 6, B 4, E 3, C 2 → D на 2 места (с 4-го на 2-е), E на 1.
    const f2 = simpleEvening('f2', q4(8), ['D', 'E', 'A', 'B', 'C']);
    expect(eveningClubNews(input({ summaries: [f1, f2] }), 'f2')?.season).toEqual({
      seasonKey: '2026-Q4',
      leaders: [],
      leadersBefore: ['A'],
      climbers: [{ playerId: 'D', from: 4, to: 2 }],
    });
    // f2: A, C, E, B, D → после: A 10, C 5, B 4, E 2, D 1 → C и E — оба на 1 место.
    const f3 = simpleEvening('f2', q4(8), ['A', 'C', 'E', 'B', 'D']);
    expect(eveningClubNews(input({ summaries: [f1, f3] }), 'f2')?.season?.climbers).toEqual([
      { playerId: 'C', from: 3, to: 2 },
      { playerId: 'E', from: 5, to: 4 },
    ]);
  });

  it('вечера нет в итогах — null; рассказывать нечего — блока нет', () => {
    expect(eveningClubNews(input(), 'nope')).toBeNull();
    expect(hasClubNews(null)).toBe(false);
    expect(hasClubNews(eveningClubNews(input(), 'e3'))).toBe(true);
    // Первый вечер клуба без прогнозов: ни рекордов, ни званий (форма у A — смена с «никого»).
    const first = eveningClubNews({ ...input({ summaries: [e1], predictions: [] }) }, 'e1');
    expect(first?.records).toEqual([]);
    expect(first?.season).toBeNull();
    expect(first?.titleChanges.map((t) => t.title)).toEqual(['form']);
  });
});
