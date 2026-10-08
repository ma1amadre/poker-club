// Истории клуба на экранах: строки сюжета и «На кону» — без рода, о себе на «ты»; подписи олл-инов.
import type { SeasonStakes } from '@domain/stakes.ts';
import type { StoryItem } from '@domain/story.ts';
import { describe, expect, it } from 'vitest';
import {
  allInCaption,
  favoritePill,
  seasonStakeLines,
  stakeLine,
  storyLine,
  swingPill,
} from './stories';

const NAMES: Record<string, string> = { a: 'Женя', b: 'Саша', c: 'Дима' };
const nameOf = (id: string) => NAMES[id] ?? 'Игрок';
const plain = (text: string) => text.replace(/ /g, ' ');
const SD = '11111111-1111-4111-8111-111111111111';

const swing: StoryItem = {
  kind: 'swing',
  swing: {
    showdownId: SD,
    winnerId: 'a',
    pct: 13,
    boardSize: 0,
    street: 'preflop',
    favoriteIds: ['b'],
    favoritePct: 87,
  },
};

describe('строки сюжета', () => {
  it('о других — в третьем лице, о себе — на «ты»', () => {
    expect(plain(storyLine(swing, nameOf))).toBe(
      'Женя забирает олл-ин с 13 % до флопа; фаворит — Саша, 87 %.',
    );
    expect(plain(storyLine(swing, nameOf, 'a'))).toBe(
      'Ты забираешь олл-ин с 13 % до флопа; фаворит — Саша, 87 %.',
    );
    expect(plain(storyLine(swing, nameOf, 'b'))).toBe(
      'Женя забирает олл-ин с 13 % до флопа; фаворит — ты, 87 %.',
    );
    const revenge: StoryItem = {
      kind: 'revenge',
      playerId: 'a',
      nemesisId: 'b',
      achievement: true,
    };
    expect(storyLine(revenge, nameOf)).toBe('Месть Немезиде: Женя выбивает игрока Саша.');
    expect(storyLine(revenge, nameOf, 'a')).toBe('Месть Немезиде: ты выбиваешь игрока Саша.');
    expect(storyLine(revenge, nameOf, 'b')).toBe('Месть Немезиде: Женя выбивает тебя.');
    expect(storyLine({ kind: 'phoenix', playerId: 'a', achievement: true }, nameOf, 'a')).toBe(
      'Феникс вечера — ты: первый вылет и победа.',
    );
    expect(
      storyLine({ kind: 'comeback', playerId: 'a', rebuys: 2, achievement: true }, nameOf, 'a'),
    ).toBe('Ты выигрываешь вечер после 2 ребаев.');
    expect(
      storyLine({ kind: 'comeback', playerId: 'c', rebuys: 1, achievement: false }, nameOf),
    ).toBe('Дима выигрывает вечер после ребая.');
  });

  it('рекорд и лидер сезона', () => {
    expect(
      plain(
        storyLine(
          {
            kind: 'record',
            record: { kind: 'most_kos', value: 4, previous: 3, status: 'new', playerIds: ['a'] },
          },
          nameOf,
        ),
      ),
    ).toBe('Новый рекорд клуба: больше всего нокаутов за вечер — Женя, 4 нокаута.');
    expect(
      plain(
        storyLine(
          {
            kind: 'record',
            record: {
              kind: 'biggest_pool',
              value: 3000,
              previous: 2500,
              status: 'new',
              playerIds: [],
            },
          },
          nameOf,
        ),
      ),
    ).toBe('Новый рекорд клуба: самый большой фонд — 3 000 ₽.');
    expect(
      plain(
        storyLine(
          {
            kind: 'season_leader',
            leaders: [{ playerId: 'a', total: 12.5 }],
            leadersBefore: ['b'],
          },
          nameOf,
          'a',
        ),
      ),
    ).toBe('Новый лидер сезона — ты, 12,5 очка.');
    expect(
      plain(
        storyLine(
          {
            kind: 'season_leader',
            leaders: [{ playerId: 'a', total: 9 }],
            leadersBefore: ['a', 'b'],
          },
          nameOf,
        ),
      ),
    ).toBe('Женя — единоличный лидер сезона, 9 очков.');
    expect(
      storyLine(
        {
          kind: 'season_leader',
          leaders: [
            { playerId: 'a', total: 9 },
            { playerId: 'b', total: 9 },
          ],
          leadersBefore: ['b'],
        },
        nameOf,
        'a',
      ),
    ).toBe('На первом месте сезона — ты и Саша.');
  });

  it('ноль на табло — «меньше 1 %»', () => {
    const zero: StoryItem = {
      kind: 'swing',
      swing: { ...(swing.kind === 'swing' ? swing.swing : ({} as never)), pct: 0, street: 'flop' },
    };
    expect(plain(storyLine(zero, nameOf))).toContain('с меньше 1 % на флопе');
  });
});

describe('«На кону» на экране', () => {
  it('шаги: о себе — «Ты — в одной победе…», цель — «ты»', () => {
    expect(
      stakeLine(
        { kind: 'win_step', playerId: 'a', hatTrick: true, streak: 3, record: null },
        nameOf,
        'a',
      ),
    ).toBe('Ты — в одной победе от ачивки «Хет-трик».');
    expect(
      plain(
        stakeLine(
          { kind: 'enemy_step', playerId: 'b', victimId: 'a', kos: 4, target: 5, level: 1 },
          nameOf,
          'a',
        ),
      ),
    ).toBe('Саша — в одном нокауте от ачивки «Заклятый враг I» (цель — ты).');
    expect(
      plain(
        stakeLine(
          { kind: 'enemy_step', playerId: 'a', victimId: 'c', kos: 9, target: 10, level: 2 },
          nameOf,
          'a',
        ),
      ),
    ).toBe('Ты — в одном нокауте от ачивки «Заклятый враг II» (цель — Дима).');
    expect(stakeLine({ kind: 'king_step', championIds: ['a'] }, nameOf, 'a')).toBe(
      'Нокаут действующего чемпиона принесёт ачивку «Охота на короля» (чемпион — ты).',
    );
    expect(stakeLine({ kind: 'king_step', championIds: ['a', 'b'] }, nameOf)).toBe(
      'Нокаут действующего чемпиона принесёт ачивку «Охота на короля» (чемпионы — Женя и Саша).',
    );
    expect(stakeLine({ kind: 'revenge_step', playerId: 'a', nemesisId: 'b' }, nameOf, 'b')).toBe(
      'Женя — в одном нокауте от ачивки «Месть» (Немезида — ты).',
    );
    expect(
      plain(
        stakeLine({ kind: 'star_step', playerId: 'c', stars: 4, target: 5, level: 2 }, nameOf, 'c'),
      ),
    ).toBe('Ты — в одной звезде от ачивки «Звезда вечера II».');
    expect(plain(stakeLine({ kind: 'first_blood' }, nameOf))).toBe(
      'Первый нокаут в истории клуба принесёт ачивку «Первая кровь».',
    );
    expect(
      plain(
        stakeLine(
          { kind: 'pool_record', going: 6, poolRub: 3000, recordRub: 3000, status: 'equal' },
          nameOf,
        ),
      ),
    ).toBe('Идут 6 — фонд ещё до ребаев повторит рекорд клуба (3 000 ₽).');
    expect(stakeLine({ kind: 'oracle_step', playerId: 'c', streak: 2, target: 3 }, nameOf)).toBe(
      'Дима — в одном угаданном победителе от ачивки «Оракул».',
    );
  });

  const rows = (list: [string, number][]) =>
    list.map(([playerId, total]) => ({
      playerId,
      total,
      counted: [total],
      played: 1,
      wins: 0,
      kos: 0,
      netRub: 0,
    }));
  const season: SeasonStakes = {
    seasonKey: '2026-Q4',
    first: false,
    leaders: [{ playerId: 'a', total: 24 }],
    chasers: [{ playerId: 'b', total: 21, gap: 3 }],
    rows: rows([
      ['a', 24],
      ['b', 21],
      ['c', 15],
    ]),
  };

  it('сезон: лидер и кто следом; своё место — если его не назвали', () => {
    expect(seasonStakeLines(season, nameOf).map(plain)).toEqual([
      'Лидер сезона — Женя, 24 очка; следом — Саша, отставание 3 очка.',
    ]);
    expect(seasonStakeLines(season, nameOf, 'c').map(plain)).toEqual([
      'Лидер сезона — Женя, 24 очка; следом — Саша, отставание 3 очка.',
      'Ты — на 3-м месте, до лидера 9 очков.',
    ]);
    expect(seasonStakeLines(season, nameOf, 'b').map(plain)).toEqual([
      'Лидер сезона — Женя, 24 очка; следом — ты, отставание 3 очка.',
    ]);
    expect(
      seasonStakeLines(
        { ...season, leaders: [...season.leaders, { playerId: 'b', total: 24 }], chasers: [] },
        nameOf,
        'b',
      ).map(plain),
    ).toEqual(['На первом месте сезона — Женя и ты, по 24 очка.']);
    expect(
      seasonStakeLines(
        { seasonKey: '2027-Q1', first: true, leaders: [], chasers: [], rows: [] },
        nameOf,
      ),
    ).toEqual(['Первый вечер сезона: 1-й квартал 2027 начинается с нуля.']);
  });
});

describe('подписи олл-инов', () => {
  it('пометки и подпись к голосу из карт раздачи', () => {
    expect(plain(swingPill({ pct: 13 }))).toBe('победа с 13 %');
    expect(plain(swingPill({ pct: 0 }))).toBe('победа с меньше 1 %');
    expect(plain(favoritePill({ favoritePct: 87 }))).toBe('фаворит, 87 %');
    expect(
      allInCaption({
        hands: [
          { playerId: 'a', cards: ['As', 'Ad'] },
          { playerId: 'b', cards: ['7c', '2h'] },
        ],
        board: ['7d', '2s', 'Kc', 'Th', '3d'],
      }),
    ).toBe('A♠ A♦ против 7♣ 2♥ — стол 7♦ 2♠ K♣ 10♥ 3♦');
    expect(
      allInCaption({
        hands: [
          { playerId: 'a', cards: ['As', 'Ad'] },
          { playerId: 'b', cards: ['7c', '2h'] },
        ],
        board: [],
      }),
    ).toBe('A♠ A♦ против 7♣ 2♥');
  });
});
