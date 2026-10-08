// «Сюжет вечера»: что попадает в строки, в каком порядке, что видит табло (без истории клуба) и что
// остаётся для поста итогов (без рекордов, лидера сезона и «Камбэка» — их пост говорит другими блоками).
import { describe, expect, it } from 'vitest';
import { eveningAllIns } from './allins.ts';
import { DEFAULT_FORMAT } from './format.ts';
import { DEFAULT_SCORING } from './scoring.ts';
import { eveningStory, STORY_MAX_ITEMS, type StoryInput } from './story.ts';
import { summarize } from './summary.ts';
import { journal, playEvening } from './test-utils.ts';

const SD1 = '11111111-1111-4111-8111-111111111111';
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`;

// e1: B дважды выбивает A (Немезида A — B) и выигрывает; C вылетает без выбившего (у B 2 нокаута).
const e1 = playEvening(
  'e1',
  day(1),
  ['A', 'B', 'C', 'D'],
  [
    ['bust', 'A', ['B']],
    ['rebuy', 'A'],
    ['bust', 'A', ['B']],
    ['bust', 'D', ['C']],
    ['bust', 'C', []],
  ],
);

/**
 * e2: A вылетает первым (выбивает C), докупается, с 7-2 против тузов B выигрывает олл-ин до флопа
 * (13 %), выбивает B (месть Немезиде), D и C — и вечер.
 */
function tonight() {
  const j = journal(day(8));
  j.join('A', 'B', 'C', 'D');
  j.start();
  j.wait(1).bust('A', ['C']);
  j.wait(1).rebuy('A');
  j.wait(1).showdown(SD1, [
    ['A', '7c', '2h'],
    ['B', 'As', 'Ad'],
  ]);
  j.wait(1).showdown(
    SD1,
    [
      ['A', '7c', '2h'],
      ['B', 'As', 'Ad'],
    ],
    ['7d', '2s', 'Kc', '9h', '3d'],
  );
  j.wait(1).bust('B', ['A']);
  j.wait(1).bust('D', ['A']);
  j.wait(1).bust('C', ['A']);
  j.finish();
  return {
    summary: summarize('e2', day(8), DEFAULT_FORMAT, j.events, DEFAULT_SCORING),
    allIns: eveningAllIns(DEFAULT_FORMAT, j.events),
  };
}

const club = (summaries = [e1, tonight().summary]) => ({
  summaries,
  excluded: new Set<string>(),
  bestN: 10,
});

describe('сюжет вечера', () => {
  const { summary, allIns } = tonight();
  const input: StoryInput = { summary, allIns, excluded: new Set(), club: club() };

  it('главное по порядку: олл-ин с 13 %, месть Немезиде, рекорд игрока, новый лидер сезона', () => {
    const story = eveningStory(input);
    expect(story.length).toBe(STORY_MAX_ITEMS);
    expect(story[0]).toEqual({
      kind: 'swing',
      swing: {
        showdownId: SD1,
        winnerId: 'A',
        pct: 13,
        boardSize: 0,
        street: 'preflop',
        favoriteIds: ['B'],
        favoritePct: 87,
      },
    });
    expect(story[1]).toEqual({ kind: 'revenge', playerId: 'A', nemesisId: 'B' });
    expect(story[2]).toMatchObject({
      kind: 'record',
      record: { kind: 'most_kos', status: 'new', value: 3, playerIds: ['A'] },
    });
    expect(story[3]).toEqual({
      kind: 'season_leader',
      leaders: [{ playerId: 'A', total: 5.5 }],
      leadersBefore: ['B'],
    });
  });

  it('табло (без истории клуба): только то, что видно из журнала вечера', () => {
    expect(eveningStory({ ...input, club: undefined }).map((s) => s.kind)).toEqual([
      'swing',
      'phoenix',
    ]);
  });

  it('пост итогов: без рекордов и лидера сезона — место занимают следующие строки', () => {
    expect(eveningStory({ ...input, forPost: true }).map((s) => s.kind)).toEqual([
      'swing',
      'revenge',
      'phoenix',
    ]);
  });

  it('готовые «победы с N %» клиента берутся как есть — шансы не пересчитываются', () => {
    const swing = {
      showdownId: SD1,
      winnerId: 'A',
      pct: 9,
      boardSize: 3,
      street: 'flop' as const,
      favoriteIds: ['B'],
      favoritePct: 91,
    };
    const story = eveningStory({
      ...input,
      club: undefined,
      swings: new Map([[SD1, swing]]),
      equity: () => {
        throw new Error('шансы не нужны');
      },
    });
    expect(story[0]).toEqual({ kind: 'swing', swing });
  });

  it('первый вечер клуба: ни мести, ни рекордов, ни сдвига в сезоне', () => {
    const first = playEvening(
      'f1',
      day(1),
      ['A', 'B'],
      [
        ['bust', 'A', ['B']],
        ['rebuy', 'A'],
        ['bust', 'B', ['A']],
        ['rebuy', 'B'],
        ['bust', 'A', ['B']],
      ],
    );
    expect(
      eveningStory({ summary: first, allIns: [], excluded: new Set(), club: club([first]) }),
    ).toEqual([{ kind: 'comeback', playerId: 'B', rebuys: 1, achievement: false }]);
  });
});

describe('победа после ребаев и «феникс»', () => {
  // B вылетает вторым и третьим по счёту — не первым: это не «феникс».
  const twoRebuys = playEvening(
    'r2',
    day(8),
    ['A', 'B', 'C'],
    [
      ['bust', 'C', ['A']],
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'B', ['A']],
      ['rebuy', 'B'],
      ['bust', 'A', ['B']],
      ['bust', 'C', ['B']],
    ],
  );
  const local = (excluded = new Set<string>()) =>
    eveningStory({ summary: twoRebuys, allIns: [], excluded });

  it('две и больше — с отметкой «Камбэк»; у гостя ачивки нет', () => {
    expect(local()).toEqual([{ kind: 'comeback', playerId: 'B', rebuys: 2, achievement: true }]);
    expect(local(new Set(['B']))).toEqual([
      { kind: 'comeback', playerId: 'B', rebuys: 2, achievement: false },
    ]);
  });

  it('пост: «Камбэк» уже в «Новых ачивках» — строки нет; у гостя строка остаётся', () => {
    expect(
      eveningStory({ summary: twoRebuys, allIns: [], excluded: new Set(), forPost: true }),
    ).toEqual([]);
    expect(
      eveningStory({ summary: twoRebuys, allIns: [], excluded: new Set(['B']), forPost: true }),
    ).toHaveLength(1);
  });

  it('первый вылет и победа — «феникс» вместо победы после ребаев', () => {
    const phoenix = playEvening(
      'p1',
      day(8),
      ['A', 'B', 'C'],
      [
        ['bust', 'A', ['B']],
        ['rebuy', 'A'],
        ['bust', 'B', ['A']],
        ['bust', 'C', ['A']],
      ],
    );
    expect(eveningStory({ summary: phoenix, allIns: [], excluded: new Set() })).toEqual([
      { kind: 'phoenix', playerId: 'A' },
    ]);
  });

  it('победа без ребаев и без олл-инов — сюжета нет', () => {
    const plain = playEvening('n1', day(8), ['A', 'B'], [['bust', 'B', ['A']]]);
    expect(eveningStory({ summary: plain, allIns: [], excluded: new Set() })).toEqual([]);
  });
});
