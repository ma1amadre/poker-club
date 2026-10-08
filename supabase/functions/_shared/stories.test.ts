// Истории клуба в постах бота: «Сюжет вечера» в итогах (рядом с «Жизнью клуба», без дублей с ней)
// и «На кону» в посте дня игры (одна-две строки). Тексты — к группе, о людях без рода.
import { describe, expect, it } from 'vitest';
import {
  computeAchievements,
  DEFAULT_FORMAT,
  DEFAULT_SCORING,
  eveningAllIns,
  eveningStakes,
  eveningStory,
  summarize,
  type EveningStakes,
  type StoryItem,
} from './domain/index.ts';
import { journal, playEvening, simpleEvening } from './domain/test-utils.ts';
import { gamedayRoster } from './gameday.ts';
import {
  gamedayPost,
  resultsPost,
  stakesLines,
  storyLines,
  type ResultsPostInput,
} from './messages.ts';

const NAMES = { a: 'Женя', b: 'Саша', c: 'Дима', d: 'Лёша', e: '<Эрдни>' };
const SD = '11111111-1111-4111-8111-111111111111';
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`;
const plain = (text: string) => text.replace(/ /g, ' ');

describe('«Сюжет вечера» в посте итогов', () => {
  it('строки по видам: олл-ин, месть, феникс, победа после ребаев, рекорд, лидер сезона', () => {
    const items: StoryItem[] = [
      {
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
      },
      { kind: 'revenge', playerId: 'a', nemesisId: 'b' },
      { kind: 'phoenix', playerId: 'a' },
      { kind: 'comeback', playerId: 'c', rebuys: 1, achievement: false },
      { kind: 'comeback', playerId: 'c', rebuys: 3, achievement: false },
      {
        kind: 'record',
        record: { kind: 'most_kos', value: 4, previous: 3, status: 'new', playerIds: ['a'] },
      },
      { kind: 'season_leader', leaders: [{ playerId: 'a', total: 12.5 }], leadersBefore: ['b'] },
      {
        kind: 'season_leader',
        leaders: [
          { playerId: 'a', total: 9 },
          { playerId: 'b', total: 9 },
        ],
        leadersBefore: ['b'],
      },
    ];
    expect(storyLines(items, NAMES).map(plain)).toEqual([
      '',
      '♠️ <b>Сюжет вечера</b>',
      'Женя забирает олл-ин с 13 % до флопа; фаворит — Саша, 87 %.',
      'Месть Немезиде: Женя выбивает игрока Саша.',
      'Феникс вечера — Женя: первый вылет и победа.',
      'Дима выигрывает вечер после ребая.',
      'Дима выигрывает вечер после 3 ребаев.',
      'Новый рекорд клуба: больше всего нокаутов за вечер — Женя, 4 нокаута.',
      'Новый лидер сезона — Женя, 12,5 очка.',
      'Первое место сезона делят Женя и Саша.',
    ]);
    expect(storyLines([], NAMES)).toEqual([]);
  });

  it('ноль на табло — «меньше 1 %», фаворитов двое; имена экранируются', () => {
    const [, , line] = storyLines(
      [
        {
          kind: 'swing',
          swing: {
            showdownId: SD,
            winnerId: 'e',
            pct: 0,
            boardSize: 3,
            street: 'flop',
            favoriteIds: ['a', 'b'],
            favoritePct: 50,
          },
        },
      ],
      NAMES,
    );
    expect(plain(line ?? '')).toBe(
      '&lt;Эрдни&gt; забирает олл-ин с меньше 1 % на флопе; фавориты — Женя и Саша, по 50 %.',
    );
  });

  it('из журнала до поста: олл-ин в сюжете, месть — в «Новых ачивках», рекорд и лидер — в «Жизни клуба»', () => {
    const e1 = playEvening(
      'e1',
      day(1),
      ['a', 'b', 'c', 'd'],
      [
        ['bust', 'a', ['b']],
        ['rebuy', 'a'],
        ['bust', 'a', ['b']],
        ['bust', 'd', ['c']],
        ['bust', 'c', []],
      ],
    );
    const j = journal(day(8));
    j.join('a', 'b', 'c', 'd');
    j.start();
    j.wait(1).showdown(SD, [
      ['a', '7c', '2h'],
      ['b', 'As', 'Ad'],
    ]);
    j.wait(1).showdown(
      SD,
      [
        ['a', '7c', '2h'],
        ['b', 'As', 'Ad'],
      ],
      ['7d', '2s', 'Kc', '9h', '3d'],
    );
    j.wait(1).bust('b', ['a']);
    j.wait(1).bust('d', ['a']);
    j.wait(1).bust('c', ['a']);
    j.finish();
    const e2 = summarize('e2', day(8), DEFAULT_FORMAT, j.events, DEFAULT_SCORING);
    const story = eveningStory({
      summary: e2,
      allIns: eveningAllIns(DEFAULT_FORMAT, j.events),
      excluded: new Set(),
      club: { summaries: [e1, e2], excluded: new Set(), bestN: 10 },
      forPost: true,
    });
    const base: ResultsPostInput = {
      eveningId: 'e2',
      scheduledAt: day(8),
      location: null,
      names: NAMES,
      places: e2.places,
      money: {},
      kos: e2.kos,
      totalEntries: 4,
      rebuysTotal: 0,
      prizePoolRub: 2000,
      // Как newAchievementsFor: строки этого вечера из computeAchievements.
      newAchievements: computeAchievements({
        summaries: [e1, e2],
        excluded: new Set(),
        predictions: [],
        stars: [],
        bestN: 10,
        currentSeasonKey: '2026-Q4',
      }).filter((a) => a.eveningId === 'e2'),
      votingClosesAt: null,
      botUsername: null,
      nowMs: Date.parse(day(8)),
      story,
      clubNews: {
        eveningId: 'e2',
        predictions: { made: 1, winnerGuessedBy: ['c'], firstOutGuessedBy: [] },
        records: [],
        titleChanges: [],
        season: null,
      },
    };
    const text = plain(resultsPost(base).text);
    expect(text).toContain(
      '\n\n♠️ <b>Сюжет вечера</b>\n' +
        'Женя забирает олл-ин с 13 % до флопа; фаворит — Саша, 87 %.\n\n♣️ <b>Жизнь клуба</b>',
    );
    // Месть — ачивкой в «Новых ачивках», без дубля строкой сюжета.
    expect(text).toContain(
      '🏅 <b>Новые ачивки</b>\n' +
        '• Женя — «Охотник I», «Чистая победа», «Месть» (Немезида — Саша)\n',
    );
    expect(text).not.toContain('Месть Немезиде');
    // Рядом с «Жизнью клуба» и после ачивок; рекордов и лидера сезона в сюжете поста нет.
    expect(text.indexOf('Новые ачивки')).toBeLessThan(text.indexOf('Сюжет вечера'));
    expect(text).not.toContain('Новый рекорд клуба: больше');
    expect(plain(resultsPost({ ...base, story: [] }).text)).not.toContain('Сюжет вечера');
  });
});

describe('«На кону» в посте дня игры', () => {
  const stakes: EveningStakes = {
    items: [
      { kind: 'win_step', playerId: 'a', hatTrick: true, streak: 3, record: 'new' },
      { kind: 'enemy_step', playerId: 'b', victimId: 'c', kos: 4, target: 5, level: 1 },
      { kind: 'first_blood' },
    ],
    season: {
      seasonKey: '2026-Q4',
      first: false,
      leaders: [{ playerId: 'b', total: 24 }],
      chasers: [{ playerId: 'a', total: 21, gap: 3 }],
      rows: [],
    },
  };

  it('одна строка шагов (не больше двух) и строка сезона', () => {
    expect(stakesLines(stakes, NAMES).map(plain)).toEqual([
      'На кону: Женя — в одной победе от ачивки «Хет-трик» и рекорда клуба (3 победы подряд); ' +
        'Саша — в одном нокауте от ачивки «Заклятый враг I» (цель — Дима).',
      'Сезон: лидер — Саша, 24 очка; Женя отстаёт на 3 очка.',
    ]);
  });

  it('варианты: повтор рекорда, фонд, «Оракул», делёж первого места, первый вечер сезона', () => {
    const lines = (s: EveningStakes) => stakesLines(s, NAMES).map(plain);
    expect(
      lines({
        items: [
          { kind: 'win_step', playerId: 'a', hatTrick: false, streak: 4, record: 'equal' },
          { kind: 'pool_record', going: 6, poolRub: 3000, recordRub: 2500, status: 'new' },
        ],
        season: null,
      }),
    ).toEqual([
      'На кону: Женя — в одной победе от повтора рекорда клуба (4 победы подряд); ' +
        'идут 6 — фонд ещё до ребаев побьёт рекорд клуба (2 500 ₽).',
    ]);
    expect(
      lines({
        items: [{ kind: 'oracle_step', playerId: 'e', streak: 2, target: 3 }],
        season: {
          seasonKey: '2026-Q4',
          first: false,
          leaders: [
            { playerId: 'a', total: 9 },
            { playerId: 'b', total: 9 },
          ],
          chasers: [],
          rows: [],
        },
      }),
    ).toEqual([
      'На кону: &lt;Эрдни&gt; — в одном угаданном победителе от ачивки «Оракул».',
      'Сезон: первое место делят Женя и Саша — по 9 очков.',
    ]);
    expect(
      lines({
        items: [],
        season: { seasonKey: '2027-Q1', first: true, leaders: [], chasers: [], rows: [] },
      }),
    ).toEqual(['Сезон: первый вечер — I квартал 2027 начинается с нуля.']);
    // Вровень по очкам (второе место — по победам).
    expect(
      lines({
        items: [],
        season: {
          ...stakes.season!,
          chasers: [
            { playerId: 'a', total: 24, gap: 0 },
            { playerId: 'c', total: 24, gap: 0 },
          ],
        },
      }),
    ).toEqual(['Сезон: лидер — Саша, 24 очка; Женя и Дима — вровень по очкам.']);
  });

  it('в посте — после списков, до призыва отметиться; без «На кону» пост прежний', () => {
    const roster = gamedayRoster(
      [
        {
          id: 'a',
          display_name: 'Женя',
          username: null,
          tg_id: null,
          is_active: true,
          is_guest: false,
        },
        {
          id: 'b',
          display_name: 'Саша',
          username: null,
          tg_id: null,
          is_active: true,
          is_guest: false,
        },
      ],
      [
        { player_id: 'a', status: 'yes', updated_at: day(7) },
        { player_id: 'b', status: 'yes', updated_at: day(7) },
      ],
    );
    const input = {
      eveningId: 'e9',
      scheduledAt: day(9),
      location: null,
      bankerName: null,
      roster,
      botUsername: null,
      nowMs: Date.parse(day(9)) - 3_600_000,
      predictionsMade: 0,
    };
    const text = plain(gamedayPost({ ...input, stakes, names: NAMES }).text);
    expect(text).toContain(
      'Идут (2): Женя и Саша\n\nНа кону: Женя — в одной победе от ачивки «Хет-трик» и рекорда клуба ' +
        '(3 победы подряд); Саша — в одном нокауте от ачивки «Заклятый враг I» (цель — Дима).\n' +
        'Сезон: лидер — Саша, 24 очка; Женя отстаёт на 3 очка.\n\n',
    );
    expect(gamedayPost(input).text).not.toContain('На кону');
  });

  it('из домена: «Первая кровь» и первый вечер сезона', () => {
    const e1 = simpleEvening('e1', day(1), ['a', 'b']);
    const s = eveningStakes(
      { summaries: [e1], excluded: new Set(), predictions: [], bestN: 10 },
      {
        eveningDate: '2027-01-08T12:00:00.000Z',
        players: [
          { playerId: 'a', rsvp: 'yes' },
          { playerId: 'b', rsvp: null },
        ],
        buyInRub: 500,
      },
    );
    // Женя — чемпион 2026-Q4, то есть действующий в 2027-Q1: Саша может на него охотиться.
    expect(stakesLines(s, NAMES).map(plain)).toEqual([
      'На кону: первый нокаут в истории клуба принесёт ачивку «Первая кровь»; ' +
        'нокаут действующего чемпиона принесёт ачивку «Охота на короля» (чемпион — Женя).',
      'Сезон: первый вечер — I квартал 2027 начинается с нуля.',
    ]);
  });
});
