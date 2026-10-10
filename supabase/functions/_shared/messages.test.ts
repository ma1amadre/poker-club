// Тексты постов: заголовок итога вечера и его исправленной версии; анонс и итог — без голов;
// «Жизнь клуба» в итогах, напоминание о голосовании.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAT,
  eveningClubNews,
  voteResults,
  type Achievement,
  type EveningClubNews,
  type TournamentFormat,
  type Vote,
  type VoteCategory,
} from './domain/index.ts';
import { simpleEvening } from './domain/test-utils.ts';
import {
  announcePost,
  clubNewsLines,
  eveningCancelledPost,
  eveningRestoredPost,
  formatEveningDate,
  formatPoints,
  gameSuffix,
  resultsPost,
  turnoutText,
  votingPost,
  votingReminderPost,
  type ResultsPostInput,
  type VotingPostInput,
} from './messages.ts';

/** Строка ачивки: по умолчанию — вечерняя, уровень I, впервые, без цели. */
const ach = (a: Pick<Achievement, 'playerId' | 'code'> & Partial<Achievement>): Achievement => ({
  eveningId: 'e1',
  seasonKey: null,
  targetId: null,
  count: 1,
  level: 1,
  first: true,
  ...a,
});

const base: ResultsPostInput = {
  eveningId: 'e1',
  scheduledAt: '2026-10-08T16:00:00.000Z',
  location: null,
  names: { a: 'Женя', b: 'Саша' },
  places: ['a', 'b'],
  money: {},
  kos: {},
  totalEntries: 2,
  rebuysTotal: 0,
  prizePoolRub: 800,
  newAchievements: [],
  votingClosesAt: null,
  botUsername: null,
  nowMs: Date.parse('2026-10-08T21:00:00.000Z'),
};

// Даты в постах склеены неразрывным пробелом — для сравнения заменяем обычным.
const firstLine = (text: string) => (text.split('\n')[0] ?? '').replace(/ /g, ' ');

describe('resultsPost', () => {
  it('обычный итог', () => {
    const text = resultsPost(base).text;
    expect(firstLine(text)).toBe('♠️ <b>Итоги вечера 8 октября</b>');
    expect(text).not.toMatch(/устарел/);
  });

  it('повторная публикация после отмены finish или правки — «Исправленные итоги»', () => {
    const text = resultsPost({ ...base, corrected: true }).text;
    expect(firstLine(text)).toBe('♠️ <b>Исправленные итоги вечера 8 октября</b>');
    expect(text).toMatch(/Прошлый пост с итогами устарел/);
  });

  it('вторая игра дня — «· игра 2» после даты; игра 1 и без номера — как раньше', () => {
    expect(firstLine(resultsPost({ ...base, gameNo: 2 }).text)).toBe(
      '♠️ <b>Итоги вечера 8 октября · игра 2</b>',
    );
    expect(firstLine(resultsPost({ ...base, gameNo: 2, corrected: true }).text)).toBe(
      '♠️ <b>Исправленные итоги вечера 8 октября · игра 2</b>',
    );
    expect(firstLine(resultsPost({ ...base, gameNo: 1 }).text)).toBe(
      '♠️ <b>Итоги вечера 8 октября</b>',
    );
  });
});

describe('номер игры в дне (миграция 026)', () => {
  it('gameSuffix и formatEveningDate', () => {
    expect([undefined, null, 0, 1].map(gameSuffix)).toEqual(['', '', '', '']);
    expect(gameSuffix(2).replace(/ /g, ' ')).toBe(' · игра 2');
    expect(formatEveningDate('2026-10-09T19:30:00.000Z', 3).replace(/ /g, ' ')).toBe(
      '9 октября · игра 3',
    );
  });

  it('голосование, напоминание, отмена и возврат вечера — с номером игры', () => {
    const sp = (t: string) => t.replace(/ /g, ' ');
    const voting = votingPost({
      eveningId: 'e2',
      scheduledAt: '2026-10-09T19:30:00.000Z',
      gameNo: 2,
      names: { a: 'Женя', b: 'Саша', c: 'Дима' },
      results: voteResults([
        { voterId: 'b', category: 'hand', nomineeId: 'a' },
        { voterId: 'c', category: 'hand', nomineeId: 'a' },
      ]),
      botUsername: null,
    });
    expect(sp(firstLine(voting?.text ?? ''))).toBe(
      '🗳 <b>Итоги голосования · вечер 9 октября · игра 2</b>',
    );
    const reminder = votingReminderPost({
      eveningId: 'e2',
      scheduledAt: '2026-10-09T19:30:00.000Z',
      gameNo: 2,
      votingClosesAt: '2026-10-10T19:30:00.000Z',
      voted: 1,
      eligible: 4,
      botUsername: null,
    });
    expect(sp(reminder.text)).toContain('бэд-бит вечера 9 октября · игра 2.');
    const snap = { scheduledAt: '2026-10-09T19:30:00.000Z', location: null, cancelled: false };
    const change = { eveningId: 'e2', before: snap, after: snap, reason: null, botUsername: null };
    expect(sp(firstLine(eveningCancelledPost({ ...change, gameNo: 2 }).text))).toBe(
      '♠️ <b>Вечер 9 октября · игра 2 отменён</b>',
    );
    expect(sp(firstLine(eveningRestoredPost({ ...change, gameNo: 2 }).text))).toBe(
      '♠️ <b>Вечер 9 октября · игра 2 всё-таки состоится</b>',
    );
    expect(sp(firstLine(eveningCancelledPost(change).text))).toBe(
      '♠️ <b>Вечер 9 октября отменён</b>',
    );
  });
});

describe('без баунти «за голову» (убрано 07.10.2026)', () => {
  const plain = (text: string) => text.replace(/ /g, ' ');

  it('анонс: вход, ребай и фишки, ни слова о голове', () => {
    // Снимок формата вечера из базы до миграции 018 ещё мог нести bountyRub — пост его не читает.
    for (const format of [
      DEFAULT_FORMAT,
      { ...DEFAULT_FORMAT, bountyRub: 100 } as TournamentFormat,
    ]) {
      const text = plain(
        announcePost({
          eveningId: 'e1',
          scheduledAt: '2026-10-08T16:00:00.000Z',
          location: null,
          note: null,
          format,
          botUsername: null,
        }).text,
      );
      // Сумма формата — по умолчанию, а не нижняя граница: «от 500 ₽» обещало бы, что меньше нельзя,
      // а журнал принимает вход и ребай любой суммой от 1 ₽ (027).
      expect(text).toContain('Вход и ребай — 500 ₽, можно другой суммой (500 фишек за 500 ₽).');
      expect(text).not.toMatch(/(^|\s)от \d/);
      expect(text).not.toMatch(/голов|баунти/i);
    }
    // Без ребаев (лимит 0) — только вход; курс фишек — из формата (027: вход любой суммой).
    const noRebuy = plain(
      announcePost({
        eveningId: 'e1',
        scheduledAt: '2026-10-08T16:00:00.000Z',
        location: null,
        note: null,
        format: { ...DEFAULT_FORMAT, rebuyLimit: 0, buyInRub: 1000, startingChips: 2000 },
        botUsername: null,
      }).text,
    );
    expect(noRebuy).toContain('Вход — 1 000 ₽, можно другой суммой (2 000 фишек за 1 000 ₽).');
  });

  it('итог: у мест только призовые, лучший охотник — по числу нокаутов, без денег', () => {
    const text = plain(
      resultsPost({
        ...base,
        names: { a: 'Женя', b: 'Саша', c: 'Дима' },
        places: ['a', 'b', 'c'],
        money: {
          a: { owesRub: 500, prizeRub: 1050, netRub: 550 },
          b: { owesRub: 500, prizeRub: 450, netRub: -50 },
          c: { owesRub: 500, prizeRub: 0, netRub: -500 },
        },
        kos: { a: 1, b: 1, c: 0 },
        totalEntries: 3,
        prizePoolRub: 1500,
      }).text,
    );
    expect(text).toContain('🥇 <b>Женя</b> — приз 1 050 ₽');
    expect(text).toContain('🥈 Саша — приз 450 ₽');
    expect(text).toMatch(/🥉 Дима$/m);
    expect(text).toContain('💰 Фонд 1 500 ₽ · 3 входа');
    expect(text).toContain('🎯 Лучший охотник: Женя и Саша — по 1 нокауту');
    expect(text).not.toMatch(/голов|баунти/i);
  });
});

// ---------------------------------------------------------------------------
// «Жизнь клуба» в посте итогов, строка о прогнозах, напоминание о голосовании
// ---------------------------------------------------------------------------

/** Эмодзи в тексте, кроме мастей ♠️ ♣️ (решение пользователя для новых постов и строк). */
const foreignEmoji = (text: string): string[] =>
  [...text.matchAll(/\p{Extended_Pictographic}/gu)]
    .map((m) => m[0])
    .filter((e) => e !== '♠' && e !== '♣');

const NAMES = { a: 'Женя', b: 'Саша', c: 'Дима', d: 'Лёша', e: '<Эрдни>' };

const news = (over: Partial<EveningClubNews> = {}): EveningClubNews => ({
  eveningId: 'e1',
  predictions: { made: 0, winnerGuessedBy: [], firstOutGuessedBy: [] },
  records: [],
  titleChanges: [],
  season: null,
  ...over,
});

const block = (n: EveningClubNews) => clubNewsLines(n, NAMES).map((l) => l.replace(/ /g, ' '));

describe('«Жизнь клуба» в посте итогов', () => {
  it('рассказывать нечего — блока нет; иначе — заголовок и по строке на тему', () => {
    expect(clubNewsLines(news(), NAMES)).toEqual([]);
    const lines = block(
      news({
        predictions: { made: 3, winnerGuessedBy: ['b', 'a'], firstOutGuessedBy: ['c'] },
        records: [
          {
            kind: 'biggest_pool',
            value: 6000,
            previous: 5000,
            status: 'new',
            playerIds: [],
          },
        ],
        titleChanges: [{ title: 'form', from: 'b', to: 'a', victimId: null, eveningId: 'e1' }],
        season: {
          seasonKey: '2026-Q4',
          leaders: [{ playerId: 'a', total: 12.5 }],
          leadersBefore: ['b'],
          climbers: [{ playerId: 'c', from: 5, to: 2 }],
        },
      }),
    );
    expect(lines).toEqual([
      '',
      '♣️ <b>Жизнь клуба</b>',
      'Победителя угадали: Женя и Саша. Первый вылет угадали: Дима.',
      'Новый рекорд клуба: самый большой фонд — 6 000 ₽ (прежний — 5 000 ₽).',
      'Звания: «Форма» — Женя (прежде — Саша).',
      'Сезон: новый лидер — Женя, 12,5 очка; рывок — Дима, с 5-го места на 2-е.',
    ]);
    expect(foreignEmoji(lines.join('\n'))).toEqual([]);
  });

  it('прогнозы: угадан только победитель или только первый вылет; не сбылся ни один', () => {
    const line = (p: EveningClubNews['predictions']) => block(news({ predictions: p }))[2];
    expect(line({ made: 2, winnerGuessedBy: ['d'], firstOutGuessedBy: [] })).toBe(
      'Победителя угадали: Лёша.',
    );
    expect(line({ made: 2, winnerGuessedBy: [], firstOutGuessedBy: ['a', 'c'] })).toBe(
      'Первый вылет угадали: Дима и Женя.',
    );
    expect(line({ made: 1, winnerGuessedBy: [], firstOutGuessedBy: [] })).toBe(
      'Прогноз не сбылся: победителя и первый вылет никто не угадал.',
    );
    expect(line({ made: 4, winnerGuessedBy: [], firstOutGuessedBy: [] })).toBe(
      'Прогнозы не сбылись: победителя и первый вылет никто не угадал.',
    );
  });

  it('рекорды: несколько — без прежних значений; вперемешку — пометка «повторён»', () => {
    const line = (records: EveningClubNews['records']) => block(news({ records }))[2];
    expect(
      line([
        { kind: 'biggest_win', value: 2300, previous: 1800, status: 'new', playerIds: ['a'] },
        { kind: 'longest_game', value: 200 * 60_000, previous: null, status: 'new', playerIds: [] },
      ]),
    ).toBe(
      'Новые рекорды клуба: крупнейший выигрыш за вечер — Женя, +2 300 ₽; ' +
        'самая длинная игра — 3 ч 20 мин.',
    );
    expect(
      line([
        { kind: 'most_kos', value: 4, previous: 3, status: 'new', playerIds: ['c'] },
        { kind: 'win_streak', value: 3, previous: 3, status: 'equalled', playerIds: ['a', 'b'] },
      ]),
    ).toBe(
      'Рекорды клуба: больше всего нокаутов за вечер — Дима, 4 нокаута; ' +
        'самая длинная серия побед — Женя и Саша, 3 победы подряд (повторён).',
    );
    expect(
      line([{ kind: 'most_kos', value: 1, previous: 1, status: 'equalled', playerIds: ['d'] }]),
    ).toBe('Рекорд клуба повторён: больше всего нокаутов за вечер — Лёша, 1 нокаут.');
  });

  it('звания: «Форма» впервые; Немезиды одного держателя — вместе', () => {
    const line = block(
      news({
        titleChanges: [
          { title: 'form', from: null, to: 'a', victimId: null, eveningId: 'e1' },
          { title: 'nemesis', from: null, to: 'c', victimId: 'b', eveningId: 'e1' },
          { title: 'nemesis', from: 'a', to: 'c', victimId: 'd', eveningId: 'e1' },
          { title: 'nemesis', from: null, to: 'b', victimId: 'a', eveningId: 'e1' },
        ],
      }),
    )[2];
    expect(line).toBe(
      'Звания: «Форма» — Женя; Дима — Немезида игроков Саша и Лёша; Саша — Немезида игрока Женя.',
    );
  });

  it('сезон: единоличный лидер, делёж первого места, подъём нескольких', () => {
    const line = (season: EveningClubNews['season']) => block(news({ season }))[2];
    expect(
      line({
        seasonKey: '2026-Q4',
        leaders: [{ playerId: 'a', total: 9 }],
        leadersBefore: ['a', 'b'],
        climbers: [],
      }),
    ).toBe('Сезон: Женя — единоличный лидер, 9 очков.');
    expect(
      line({
        seasonKey: '2026-Q4',
        leaders: [
          { playerId: 'a', total: 6 },
          { playerId: 'b', total: 6 },
        ],
        leadersBefore: ['a'],
        climbers: [],
      }),
    ).toBe('Сезон: первое место делят Женя и Саша — по 6 очков.');
    expect(
      line({
        seasonKey: '2026-Q4',
        leaders: [],
        leadersBefore: ['a'],
        climbers: [
          { playerId: 'c', from: 3, to: 2 },
          { playerId: 'd', from: 5, to: 4 },
        ],
      }),
    ).toBe('Сезон: рывок на 1 место вверх — Дима и Лёша.');
  });

  it('имена экранируются; пост итогов ставит блок после ачивок', () => {
    const lines = clubNewsLines(
      news({ predictions: { made: 1, winnerGuessedBy: ['e'], firstOutGuessedBy: [] } }),
      NAMES,
    );
    expect(lines[2]).toBe('Победителя угадали: &lt;Эрдни&gt;.');
    const text = resultsPost({
      ...base,
      clubNews: news({ predictions: { made: 1, winnerGuessedBy: ['a'], firstOutGuessedBy: [] } }),
    }).text;
    expect(text).toContain('\n\n♣️ <b>Жизнь клуба</b>\nПобедителя угадали: Женя.');
    expect(resultsPost(base).text).not.toContain('Жизнь клуба');

    // Порядок: ачивки вечера → «Жизнь клуба» → итоги прошедшего сезона (отдельная глава) → голосование.
    const full = resultsPost({
      ...base,
      newAchievements: [
        ach({ playerId: 'a', code: 'hunter', eveningId: 'e1' }),
        ach({ playerId: 'b', code: 'champion', eveningId: null, seasonKey: '2026-Q3' }),
      ],
      votingClosesAt: '2026-10-09T21:00:00.000Z',
      clubNews: news({ predictions: { made: 1, winnerGuessedBy: ['a'], firstOutGuessedBy: [] } }),
    }).text;
    const at = (needle: string) => full.indexOf(needle);
    expect(at('Новые ачивки')).toBeGreaterThan(-1);
    expect(at('Новые ачивки')).toBeLessThan(at('Жизнь клуба'));
    expect(at('Жизнь клуба')).toBeLessThan(at('Итоги сезона'));
    expect(at('Итоги сезона')).toBeLessThan(at('Голосование за руку'));
  });

  it('из домена: вечер с прогнозом, рекордами и сменой формы', () => {
    const q4 = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;
    const e1 = simpleEvening('e1', q4(1), ['a', 'b', 'c', 'd']);
    const e2 = simpleEvening('e2', q4(8), ['b', 'a', 'c', 'd'], 'winner');
    const n = eveningClubNews(
      {
        summaries: [e1, e2],
        excluded: new Set(),
        predictions: [{ eveningId: 'e2', playerId: 'c', winnerId: 'b', firstOutId: 'd' }],
        bestN: 10,
      },
      'e2',
    );
    expect(n).not.toBeNull();
    const lines = block(n as EveningClubNews);
    expect(lines[2]).toBe('Победителя угадали: Дима. Первый вылет угадали: Дима.');
    // Фонд (2 000 ₽) и длина игры повторены — в пост не идут; выигрыш +900 ₽ повторён игроком — идёт.
    expect(n?.records.map((r) => [r.kind, r.status])).toEqual([
      ['biggest_win', 'equalled'],
      ['most_kos', 'new'],
      ['biggest_pool', 'equalled'],
      ['longest_game', 'equalled'],
    ]);
    expect(lines[3]).toBe(
      'Рекорды клуба: крупнейший выигрыш за вечер — Саша, +900 ₽ (повторён); ' +
        'больше всего нокаутов за вечер — Саша, 3 нокаута.',
    );
    expect(lines).toContain('Звания: «Форма» — Саша (прежде — Женя).');
    // Только повторённые рекорды вечера — строки рекордов нет.
    const quiet = block(
      news({
        records: [
          { kind: 'biggest_pool', value: 2000, previous: 2000, status: 'equalled', playerIds: [] },
        ],
      }),
    );
    expect(quiet).toEqual([]);
  });
});

describe('«Новые ачивки» в посте итогов: уровни и о ком', () => {
  const post = (newAchievements: Achievement[]) =>
    resultsPost({
      eveningId: 'e1',
      scheduledAt: '2026-10-08T16:00:00.000Z',
      location: null,
      names: NAMES,
      places: ['a', 'b'],
      money: {},
      kos: {},
      totalEntries: 2,
      rebuysTotal: 0,
      prizePoolRub: 1000,
      newAchievements,
      votingClosesAt: null,
      botUsername: null,
      nowMs: Date.parse('2026-10-08T20:00:00.000Z'),
    }).text.replace(/\u00A0/g, ' ');

  it('строкой на игрока, в порядке каталога; новый уровень и цель — в скобках', () => {
    const text = post([
      ach({ playerId: 'a', code: 'revenge', targetId: 'b' }),
      ach({ playerId: 'a', code: 'hunter', level: 2, first: true }),
      ach({ playerId: 'a', code: 'clean_win' }),
      ach({ playerId: 'b', code: 'sworn_enemy', targetId: 'c', level: 1, first: true }),
      ach({ playerId: 'c', code: 'hunter', level: 1, first: false }),
      ach({ playerId: 'c', code: 'star', level: 2, first: false, count: 2 }),
      ach({ playerId: 'e', code: 'king_hunt', targetId: 'a' }),
    ]);
    expect(text).toContain(
      '🏅 <b>Новые ачивки</b>\n' +
        '• Женя — «Охотник II» (новый уровень), «Чистая победа», «Месть» (Немезида — Саша)\n' +
        '• Саша — «Заклятый враг I» (соперник — Дима)\n' +
        '• Дима — «Охотник I», «Звезда вечера II» ×2\n' +
        '• &lt;Эрдни&gt; — «Охота на короля» (чемпион — Женя)',
    );
  });
});

describe('votingPost: «Звезда вечера»', () => {
  const v = (voterId: string, category: VoteCategory, nomineeId: string): Vote => ({
    voterId,
    category,
    nomineeId,
  });
  const post = (votes: Vote[], extra: Partial<VotingPostInput> = {}) =>
    votingPost({
      eveningId: 'e1',
      scheduledAt: '2026-10-08T16:00:00.000Z',
      names: NAMES,
      results: voteResults(votes),
      botUsername: null,
      ...extra,
    })?.text.replace(/\u00A0/g, ' ') ?? '';

  it('звезда — единственному лидеру с 2 голосами; ничья и один голос — без звезды', () => {
    const text = post([
      v('b', 'hand', 'a'),
      v('c', 'hand', 'a'),
      v('a', 'bluff', 'b'),
      v('c', 'bluff', 'd'),
      v('a', 'badbeat', 'c'),
    ]);
    expect(text).toContain('🃏 Рука вечера: <b>Женя</b> (2 голоса)');
    expect(text).toContain(
      '⭐ Ачивка «Звезда вечера»: Женя.\n' +
        'Звезда — единоличному победителю номинации с 2 голосами и больше; ничья — без звезды.',
    );
  });

  it('две номинации — ×2; новый уровень — из истории; гость-лидер — без звезды', () => {
    const votes = [
      v('b', 'hand', 'a'),
      v('c', 'hand', 'a'),
      v('b', 'bluff', 'a'),
      v('c', 'bluff', 'a'),
      v('a', 'badbeat', 'e'),
      v('b', 'badbeat', 'e'),
    ];
    expect(
      post(votes, { guests: new Set(['e']), starLevels: { a: { level: 2, first: true } } }),
    ).toContain('⭐ Ачивка «Звезда вечера»: Женя ×2 («Звезда вечера II» — новый уровень).');
    // Без истории (не загрузилась) — без уровня; гость без пометки гостя получил бы звезду.
    expect(post(votes, { guests: new Set(['e']) })).toContain(
      '⭐ Ачивка «Звезда вечера»: Женя ×2.',
    );
  });

  it('звёзд нет — так и пишем; голосов нет — поста нет', () => {
    expect(post([v('a', 'hand', 'b')])).toContain('⭐ В этот раз без ачивки «Звезда вечера».');
    expect(
      votingPost({
        eveningId: 'e1',
        scheduledAt: '2026-10-08T16:00:00.000Z',
        names: NAMES,
        results: voteResults([]),
        botUsername: null,
      }),
    ).toBeNull();
  });
});

describe('formatPoints', () => {
  it('целые и дробные очки', () => {
    const plainNbsp = (s: string) => s.replace(/ /g, ' ');
    expect([1, 2, 5, 11, 21, 12.5, 0.5, 1000].map((n) => plainNbsp(formatPoints(n)))).toEqual([
      '1 очко',
      '2 очка',
      '5 очков',
      '11 очков',
      '21 очко',
      '12,5 очка',
      '0,5 очка',
      '1 000 очков',
    ]);
  });
});

describe('votingReminderPost', () => {
  it('время закрытия по Москве, сколько проголосовали, кнопка «Голосовать»', () => {
    const post = votingReminderPost({
      eveningId: 'e1',
      scheduledAt: '2026-10-09T12:00:00.000Z',
      votingClosesAt: '2026-10-10T15:20:00.000Z',
      voted: 3,
      eligible: 7,
      botUsername: 'poker_club_bot',
    });
    expect(post.text.replace(/ /g, ' ')).toBe(
      [
        '♠️ <b>Голосование закрывается в 18:20 — проголосовали 3 из 7</b>',
        'Кто играл и ещё не голосовал — выберите руку, блеф и бэд-бит вечера 9 октября.',
      ].join('\n'),
    );
    expect(post.buttons).toEqual([
      { text: '♣️ Голосовать', url: 'https://t.me/poker_club_bot?startapp=v_e1' },
    ]);
    expect(foreignEmoji(post.text + post.buttons.map((b) => b.text).join(''))).toEqual([]);
  });

  it('число на 1 — глагол в единственном; никто — так и пишем', () => {
    expect([0, 1, 2, 11, 21].map((n) => turnoutText(n, 30))).toEqual([
      'пока никто не проголосовал',
      'проголосовал 1 из 30',
      'проголосовали 2 из 30',
      'проголосовали 11 из 30',
      'проголосовал 21 из 30',
    ]);
  });

  it('без имени бота — без кнопки', () => {
    expect(
      votingReminderPost({
        eveningId: 'e1',
        scheduledAt: '2026-10-09T12:00:00.000Z',
        votingClosesAt: '2026-10-10T12:00:00.000Z',
        voted: 0,
        eligible: 2,
        botUsername: null,
      }).buttons,
    ).toEqual([]);
  });
});
