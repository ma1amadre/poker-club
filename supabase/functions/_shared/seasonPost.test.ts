// Сезон в постах бота: строка «Финал сезона» в анонсе и посте дня игры, пост «Итоги сезона», итоги
// вечера без повтора чемпиона, когда пост сезона уже ушёл; выбор финала и окна поста.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAT,
  seasonRecap,
  type Achievement,
  type AchievementInput,
  type ScoredPrediction,
} from './domain/index.ts';
import { playEvening, simpleEvening } from './domain/test-utils.ts';
import {
  announcePost,
  finaleLine,
  gamedayPost,
  resultsPost,
  seasonResultsPost,
  type ResultsPostInput,
} from './messages.ts';
import {
  calendarEvening,
  clubSchedule,
  finaleSeasonOf,
  seasonPostDue,
  type CalendarRow,
} from './seasonPost.ts';

const NAMES = { A: 'Саша', B: 'Дима', C: 'Лёша', D: 'Женя', G: 'Гость <b>' };

/** Числа и даты в постах склеены неразрывным пробелом — для сравнения заменяем обычным. */
const plain = (text: string): string => text.replace(/ /g, ' ');

describe('«Финал сезона» в анонсе и посте дня игры', () => {
  it('одной строкой сразу под заголовком; не финал — строки нет', () => {
    expect(finaleLine('2026-Q4')).toBe('Финал сезона — последний вечер IV квартала 2026.');
    const announce = {
      eveningId: 'e1',
      scheduledAt: '2026-12-25T12:00:00.000Z',
      location: 'У Жени',
      note: null,
      format: DEFAULT_FORMAT,
      botUsername: null,
    };
    const lines = announcePost({ ...announce, finaleSeasonKey: '2026-Q4' }).text.split('\n');
    expect(lines[1]).toBe(finaleLine('2026-Q4'));
    expect(lines.filter((l) => l.includes('Финал сезона'))).toHaveLength(1);
    expect(announcePost(announce).text).not.toContain('Финал');
    expect(announcePost({ ...announce, finaleSeasonKey: null }).text).not.toContain('Финал');

    const gameday = {
      eveningId: 'e1',
      scheduledAt: '2026-12-25T12:00:00.000Z',
      location: 'У Жени',
      bankerName: 'Саша',
      roster: { yes: [], maybe: [], no: [], pending: [] },
      botUsername: null,
      nowMs: Date.parse('2026-12-25T07:00:00.000Z'),
      predictionsMade: 0,
    };
    const day = gamedayPost({ ...gameday, finaleSeasonKey: '2026-Q4' }).text.split('\n');
    expect(day[0]).toBe('♠️ <b>Сегодня покер в 15:00</b>');
    expect(day[1]).toBe(finaleLine('2026-Q4'));
    expect(day[2]).toBe('Место: У Жени');
    expect(gamedayPost(gameday).text).not.toContain('Финал');
  });
});

describe('финал и окно поста', () => {
  const row = (id: string, date: string, status = 'announced'): CalendarRow => ({
    id,
    scheduled_at: `${date}T12:00:00.000Z`,
    slot_date: date,
    status,
  });
  const friday = clubSchedule({ game_weekday: 5, game_time: '15:00:00' });

  it('расписание из settings; неверное — null', () => {
    expect(friday).toEqual({ weekday: 5, time: '15:00:00' });
    expect(clubSchedule({ game_weekday: 0, game_time: '15:00' })).toBeNull();
    expect(clubSchedule({ game_weekday: 5, game_time: 'вечером' })).toBeNull();
  });

  it('последняя пятница квартала — финал; отменённый вечер держит слот', () => {
    const last = row('a', '2026-12-25');
    const prev = row('b', '2026-12-18', 'settled');
    expect(finaleSeasonOf(last, [prev, last], friday)).toBe('2026-Q4');
    expect(finaleSeasonOf(prev, [prev, last], friday)).toBeNull();
    expect(finaleSeasonOf(prev, [prev, row('a', '2026-12-25', 'cancelled')], friday)).toBe(
      '2026-Q4',
    );
    expect(calendarEvening(row('x', '2026-12-25', 'cancelled')).cancelled).toBe(true);
  });

  it('пост сезона — с 12:00 МСК первого дня квартала две недели', () => {
    expect(seasonPostDue(Date.parse('2027-01-01T08:59:00Z'))).toBeNull();
    expect(seasonPostDue(Date.parse('2027-01-01T09:00:00Z'))).toBe('2026-Q4');
    expect(seasonPostDue(Date.parse('2027-01-14T20:00:00Z'))).toBe('2026-Q4');
    expect(seasonPostDue(Date.parse('2027-01-15T09:00:00Z'))).toBeNull();
    expect(seasonPostDue(Date.parse('2026-12-25T12:00:00Z'))).toBeNull();
  });
});

describe('пост «Итоги сезона»', () => {
  const Q4 = (d: string) => `2026-${d}T12:00:00.000Z`;
  const summaries = [
    playEvening(
      'e1',
      Q4('10-02'),
      ['A', 'B', 'C', 'D'],
      [
        ['bust', 'D', ['B']],
        ['bust', 'C', ['B']],
        ['bust', 'A', ['B']],
      ],
    ),
    playEvening(
      'e2',
      Q4('10-09'),
      ['A', 'B', 'C', 'G'],
      [
        ['bust', 'B', ['G']],
        ['rebuy', 'B'],
        ['bust', 'B', ['C']],
        ['bust', 'A', ['C']],
        ['bust', 'G', ['C']],
      ],
    ),
    simpleEvening('e3', Q4('10-16'), ['C', 'A', 'B', 'D']),
  ];
  const predictions: ScoredPrediction[] = [
    { eveningId: 'e1', playerId: 'D', winner: 3, firstOut: 2, total: 5 },
    { eveningId: 'e3', playerId: 'A', winner: 3, firstOut: 0, total: 3 },
  ];
  const input: AchievementInput = {
    summaries,
    excluded: new Set(['G']),
    predictions,
    stars: [],
    bestN: 2,
    currentSeasonKey: '2027-Q1',
  };
  const recap = seasonRecap(input, '2026-Q4');

  it('чемпион, подиум, лауреаты, рекорды, ачивки сезона и кнопка', () => {
    const post = seasonResultsPost({ recap, names: NAMES, botUsername: 'club_bot' });
    expect(post).not.toBeNull();
    const text = plain(post?.text ?? '');
    const lines = text.split('\n');
    expect(lines[0]).toBe('♠️ <b>Итоги сезона: IV квартал 2026</b>');
    expect(lines[1]).toBe('Чемпион сезона — <b>Лёша</b>, 9,5 очка.');
    expect(text).toContain('\n1-е место — Лёша, 9,5 очка\n');
    expect(text).toContain('\n2-е место — Дима, 6,5 очка\n');
    expect(text).toContain('\n3-е место — Саша, 4 очка\n');
    expect(text).toContain('Оракул сезона — Женя, 5 очков за прогнозы.');
    expect(text).toContain('Лидер по деньгам — Лёша, +1 650 ₽.');
    expect(text).toContain('Лучшие охотники — Лёша и Дима, по 3 нокаута.');
    expect(text).toContain(
      'Ачивки сезона: «Ребай-король» — Дима; «Железный стул» — Саша, Дима и Лёша.',
    );
    expect(text).toMatch(/Новы[йе] рекорды? клуба: /);
    expect(text).toContain('Вечеров в сезоне: 3, в зачёт — лучшие 2.');
    expect(text).toContain('Таблица I квартала 2027 начинается с нуля.');
    // Гость — ни в подиуме, ни в лауреатах; из эмодзи — только масти.
    expect(text).not.toContain('Гость');
    expect(text.replace(/[♠♣]️?/g, '')).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(post?.buttons).toEqual([
      { text: '♣️ Итоги сезона', url: 'https://t.me/club_bot?startapp=s_2026-Q4' },
    ]);
  });

  it('делёж и пустой сезон', () => {
    const tie = seasonRecap(
      {
        ...input,
        bestN: 10,
        summaries: [
          simpleEvening('t1', Q4('10-02'), ['A', 'B', 'C', 'D']),
          simpleEvening('t2', Q4('10-09'), ['B', 'A', 'C', 'D']),
        ],
        predictions: [],
      },
      '2026-Q4',
    );
    const text = plain(
      seasonResultsPost({ recap: tie, names: NAMES, botUsername: null })?.text ?? '',
    );
    expect(text).toContain('Чемпионы сезона — <b>Саша</b> и <b>Дима</b>, по 6 очков.');
    expect(text).toContain('\n1-е место — Саша и Дима, по 6 очков\n3-е место — Лёша, 2 очка\n');
    expect(text).toContain('Лидеры по деньгам — Саша и Дима, по +1 000 ₽.');
    expect(text).not.toContain('Оракул');
    expect(text).not.toContain('охотник');
    expect(text).toContain('Вечеров в сезоне: 2. ');
    const empty = seasonRecap(input, '2026-Q2');
    expect(seasonResultsPost({ recap: empty, names: NAMES, botUsername: null })).toBeNull();
  });

  it('сезонные ачивки — строкой, кроме чемпиона', () => {
    const text = seasonResultsPost({ recap, names: NAMES, botUsername: null })?.text ?? '';
    const holders = recap.achievements.filter((a) => a.code === 'iron_chair');
    if (holders.length > 0) expect(text).toContain('«Железный стул» — ');
    expect(text).not.toContain('«Чемпион сезона»');
  });
});

describe('итоги вечера после поста «Итоги сезона»', () => {
  const ach = (a: Partial<Achievement> & Pick<Achievement, 'playerId' | 'code'>): Achievement => ({
    eveningId: null,
    seasonKey: '2026-Q4',
    targetId: null,
    count: 1,
    level: 1,
    first: true,
    ...a,
  });
  const base: ResultsPostInput = {
    eveningId: 'e9',
    scheduledAt: '2027-01-08T12:00:00.000Z',
    location: null,
    names: NAMES,
    places: ['A', 'B'],
    money: {},
    kos: {},
    totalEntries: 2,
    rebuysTotal: 0,
    prizePoolRub: 1000,
    newAchievements: [
      ach({ playerId: 'A', code: 'champion' }),
      ach({ playerId: 'B', code: 'iron_chair' }),
      ach({ playerId: 'A', code: 'clean_win', eveningId: 'e9', seasonKey: null }),
    ],
    votingClosesAt: null,
    botUsername: null,
    nowMs: Date.parse('2027-01-08T18:00:00.000Z'),
  };

  it('пост сезона не уходил — «Итоги сезона» в посте первого вечера квартала, как раньше', () => {
    const text = resultsPost(base).text;
    expect(text).toContain('Итоги сезона: IV квартал 2026');
    expect(text).toContain('«Чемпион сезона»: Саша');
  });

  it('пост сезона уже в группе — чемпиона и сезонных ачивок в посте вечера нет', () => {
    const text = resultsPost({ ...base, postedSeasons: new Set(['2026-Q4']) }).text;
    expect(text).not.toContain('Итоги сезона');
    expect(text).not.toContain('Чемпион');
    expect(text).toContain('«Чистая победа»');
    // Другой сезон не гасится.
    expect(resultsPost({ ...base, postedSeasons: new Set(['2026-Q3']) }).text).toContain(
      'Итоги сезона: IV квартал 2026',
    );
  });
});
