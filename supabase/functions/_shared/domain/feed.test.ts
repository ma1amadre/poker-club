import { describe, expect, it } from 'vitest';
import type { ScoredPrediction } from './predictions.ts';
import {
  clubEvents,
  clubFeed,
  clubMoments,
  mergeFeed,
  momentItems,
  seasonEndIso,
  titleChanges,
  type ClubFeedInput,
  type FeedItem,
  type MomentVote,
} from './feed.ts';
import { simpleEvening } from './test-utils.ts';

// f1 — Q3 (завершён): A выбивает C и B. f2, f3 — Q4: B выбивает C и A (дважды подряд).
const f1 = simpleEvening('f1', '2026-07-01T16:00:00.000Z', ['A', 'B', 'C'], 'winner');
const f2 = simpleEvening('f2', '2026-10-08T16:00:00.000Z', ['B', 'A', 'C'], 'winner');
const f3 = simpleEvening('f3', '2026-10-15T16:00:00.000Z', ['B', 'A', 'C'], 'winner');
const NOW = Date.parse('2026-10-20T00:00:00.000Z');

const predictions: ScoredPrediction[] = [
  { eveningId: 'f2', playerId: 'X', winner: 3, firstOut: 0, total: 3 },
  { eveningId: 'f2', playerId: 'Y', winner: 0, firstOut: 2, total: 2 },
  { eveningId: 'f2', playerId: 'A', winner: 3, firstOut: 2, total: 5 },
];

const votes: MomentVote[] = [
  // Рука f2: два голоса за B; лучший — с фото и подписью.
  {
    eveningId: 'f2',
    voterId: 'A',
    category: 'hand',
    nomineeId: 'B',
    caption: 'Ривер',
    photoPath: null,
    createdAt: '2026-10-08T21:10:00Z',
  },
  {
    eveningId: 'f2',
    voterId: 'C',
    category: 'hand',
    nomineeId: 'B',
    caption: 'Каре',
    photoPath: 'f2/c.jpg',
    createdAt: '2026-10-08T21:20:00Z',
  },
  // Блеф f2: ничья A и C, без подписей.
  {
    eveningId: 'f2',
    voterId: 'A',
    category: 'bluff',
    nomineeId: 'C',
    caption: null,
    photoPath: null,
  },
  {
    eveningId: 'f2',
    voterId: 'B',
    category: 'bluff',
    nomineeId: 'A',
    caption: null,
    photoPath: null,
  },
  // f3 — голосование ещё идёт: не показывать.
  {
    eveningId: 'f3',
    voterId: 'A',
    category: 'hand',
    nomineeId: 'B',
    caption: 'Секрет',
    photoPath: null,
  },
];

function input(extra: Partial<ClubFeedInput> = {}): ClubFeedInput {
  return {
    summaries: [f3, f1, f2],
    excluded: new Set(['X', 'Y']),
    predictions,
    stars: [{ eveningId: 'f2', category: 'hand', winners: ['B'] }],
    bestN: 10,
    currentSeasonKey: '2026-Q4',
    evenings: [
      { eveningId: 'f1', finishedAt: null, votingClosesAt: null },
      {
        eveningId: 'f2',
        finishedAt: '2026-10-08T21:00:00.000Z',
        votingClosesAt: '2026-10-09T21:00:00.000Z',
      },
      { eveningId: 'f3', finishedAt: null, votingClosesAt: '2026-10-21T21:00:00.000Z' },
    ],
    votes,
    ...extra,
  };
}

describe('лента «В клубе»', () => {
  const feed = clubFeed(input(), { nowMs: NOW });
  const ids = feed.map((i) => i.id);

  it('новые сверху; внутри вечера — итог, рекорды, ачивки, звания', () => {
    expect(ids).toEqual([
      // f3: время finish из журнала (finished_at не задан): 16:00 + 2 минуты.
      'result:f3',
      'record:biggest_pool:f3',
      'record:biggest_win:f3',
      'record:longest_game:f3',
      'record:most_kos:f3',
      'record:win_streak:f3',
      'title:nemesis:A:f3',
      'title:nemesis:C:f3',
      // Моменты f2 — в момент закрытия голосования.
      'moment:f2:hand:B',
      'moment:f2:bluff:A',
      'moment:f2:bluff:C',
      // f2 — по evenings.finished_at.
      'result:f2',
      'record:biggest_pool:f2',
      'record:biggest_win:f2',
      'record:longest_game:f2',
      'record:most_kos:f2',
      'title:form::f2',
      // Сезонные ачивки Q3 — в конце сезона.
      'achievement:champion:A:2026-Q3',
      'achievement:iron_chair:A:2026-Q3',
      'achievement:iron_chair:B:2026-Q3',
      'achievement:iron_chair:C:2026-Q3',
      // f1 — первый вечер клуба: без рекордов.
      'result:f1',
      'achievement:first_blood:A:f1',
      'title:form::f1',
    ]);
    const times = feed.map((i) => Date.parse(i.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('id детерминированы и уникальны', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(clubFeed(input({ summaries: [f1, f2, f3] }), { nowMs: NOW }).map((i) => i.id)).toEqual(
      ids,
    );
  });

  it('итог вечера: победитель, фонд, лучший охотник, угадавшие', () => {
    const r = feed.find((i) => i.id === 'result:f2');
    expect(r).toEqual({
      type: 'evening_result',
      id: 'result:f2',
      at: '2026-10-08T21:00:00.000Z',
      eveningId: 'f2',
      winnerId: 'B',
      entrants: 3,
      prizePoolRub: 1500,
      topHunters: ['B'],
      topHunterKos: 2,
      winnerGuessedBy: ['A', 'X'],
      firstOutId: 'C',
      firstOutGuessedBy: ['A', 'Y'],
    });
  });

  it('время вечера без finished_at — finish из журнала', () => {
    expect(feed.find((i) => i.id === 'result:f3')?.at).toBe('2026-10-15T16:02:00.000Z');
    expect(feed.find((i) => i.id === 'achievement:champion:A:2026-Q3')?.at).toBe(
      '2026-09-30T21:00:00.000Z',
    );
  });

  it('«Звезда» отдельно не идёт — её показывает момент', () => {
    expect(feed.some((i) => i.type === 'achievement' && i.code === 'star')).toBe(false);
  });

  it('рекорд в ленте: вид, значение, кто', () => {
    const r = feed.find((i) => i.id === 'record:win_streak:f3');
    expect(r).toMatchObject({
      type: 'record',
      value: 2,
      previous: null,
      status: 'new',
      playerIds: ['B'],
    });
    expect(feed.find((i) => i.id === 'record:most_kos:f2')).toMatchObject({
      status: 'equalled',
      value: 2,
      playerIds: ['B'],
    });
  });

  it('смена званий: форма пошагово, немезида от второго нокаута', () => {
    const t = feed.filter(
      (i): i is Extract<FeedItem, { type: 'title_change' }> => i.type === 'title_change',
    );
    expect(t.map((x) => [x.title, x.victimId, x.from, x.to, x.eveningId])).toEqual([
      ['nemesis', 'A', null, 'B', 'f3'],
      ['nemesis', 'C', null, 'B', 'f3'],
      // После f2 у A и B по 5 очков, но B лучше в последнем вечере.
      ['form', null, 'A', 'B', 'f2'],
      ['form', null, null, 'A', 'f1'],
    ]);
  });

  it('limit отрезает хвост', () => {
    expect(clubFeed(input(), { nowMs: NOW, limit: 3 }).map((i) => i.id)).toEqual(ids.slice(0, 3));
  });

  it('по частям — то же самое: события без моментов и моменты на своё «сейчас»', () => {
    const events = clubEvents(input());
    expect(events.some((i) => i.type === 'moment')).toBe(false);
    for (const nowMs of [
      NOW,
      Date.parse('2026-10-09T20:59:59.000Z'),
      Date.parse('2026-10-22T00:00:00.000Z'),
    ]) {
      const moments = momentItems(clubMoments(input(), { nowMs }));
      expect(mergeFeed(events, moments)).toEqual(clubFeed(input(), { nowMs }));
      expect(mergeFeed(events, moments, 4)).toEqual(clubFeed(input(), { nowMs, limit: 4 }));
    }
  });
});

describe('моменты', () => {
  it('только после закрытия голосования; лучший голос — с фото и подписью', () => {
    const m = clubMoments(input(), { nowMs: NOW });
    expect(m).toEqual([
      {
        at: '2026-10-09T21:00:00.000Z',
        eveningId: 'f2',
        category: 'hand',
        nomineeId: 'B',
        votes: 2,
        tie: false,
        caption: 'Каре',
        photoPath: 'f2/c.jpg',
        noteBy: 'C',
      },
      {
        at: '2026-10-09T21:00:00.000Z',
        eveningId: 'f2',
        category: 'bluff',
        nomineeId: 'A',
        votes: 1,
        tie: true,
        caption: null,
        photoPath: null,
        noteBy: null,
      },
      {
        at: '2026-10-09T21:00:00.000Z',
        eveningId: 'f2',
        category: 'bluff',
        nomineeId: 'C',
        votes: 1,
        tie: true,
        caption: null,
        photoPath: null,
        noteBy: null,
      },
    ]);
    // До закрытия голосования f2 моментов нет.
    expect(clubMoments(input(), { nowMs: Date.parse('2026-10-09T20:59:59.000Z') })).toEqual([]);
    // Голосование f3 закрылось — его момент выше.
    const later = clubMoments(input(), { nowMs: Date.parse('2026-10-22T00:00:00.000Z') });
    expect(later[0]).toMatchObject({ eveningId: 'f3', nomineeId: 'B', caption: 'Секрет' });
  });

  it('без фото — подпись; при равенстве — более ранний голос', () => {
    const v: MomentVote[] = [
      {
        eveningId: 'f2',
        voterId: 'C',
        category: 'hand',
        nomineeId: 'B',
        caption: 'Поздно',
        photoPath: null,
        createdAt: '2026-10-08T22:00:00Z',
      },
      {
        eveningId: 'f2',
        voterId: 'A',
        category: 'hand',
        nomineeId: 'B',
        caption: 'Рано',
        photoPath: null,
        createdAt: '2026-10-08T21:00:00Z',
      },
    ];
    expect(clubMoments(input({ votes: v }), { nowMs: NOW })[0]).toMatchObject({
      caption: 'Рано',
      noteBy: 'A',
    });
  });

  it('незавершённый вечер и вечер без срока голосования моментов не дают', () => {
    const v: MomentVote[] = [
      {
        eveningId: 'f1',
        voterId: 'A',
        category: 'hand',
        nomineeId: 'B',
        caption: null,
        photoPath: null,
      },
      {
        eveningId: 'live',
        voterId: 'A',
        category: 'hand',
        nomineeId: 'B',
        caption: null,
        photoPath: null,
      },
    ];
    const evenings = [
      { eveningId: 'f1', finishedAt: null, votingClosesAt: null },
      { eveningId: 'live', finishedAt: null, votingClosesAt: '2026-10-01T00:00:00.000Z' },
    ];
    expect(clubMoments(input({ votes: v, evenings }), { nowMs: NOW })).toEqual([]);
  });
});

describe('titleChanges', () => {
  it('пошагово: форма переходит от одного к другому', () => {
    // g1: A 2 очка; g2: B 2 очка → суммы равны, B лучше в последнем вечере; g3: A снова.
    const g1 = simpleEvening('g1', '2026-10-01T16:00:00.000Z', ['A', 'B']);
    const g2 = simpleEvening('g2', '2026-10-02T16:00:00.000Z', ['B', 'A']);
    const g3 = simpleEvening('g3', '2026-10-03T16:00:00.000Z', ['A', 'B']);
    expect(
      titleChanges({ summaries: [g1, g2, g3], excluded: new Set() }).map((t) => [
        t.from,
        t.to,
        t.eveningId,
      ]),
    ).toEqual([
      [null, 'A', 'g1'],
      ['A', 'B', 'g2'],
      ['B', 'A', 'g3'],
    ]);
  });

  it('звание «в никуда» не событие, возврат к тому же — тоже', () => {
    const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}T16:00:00.000Z`;
    const list = [simpleEvening('h1', day(1), ['A', 'G'])];
    // Пять вечеров одних гостей: A выпадает из окна формы, звание ни у кого.
    for (let i = 2; i <= 6; i++) list.push(simpleEvening(`h${i}`, day(i), ['G', 'H']));
    list.push(simpleEvening('h7', day(7), ['A', 'G'])); // форма снова у A — не смена
    list.push(simpleEvening('h8', day(8), ['B', 'G'])); // A и B по 2, B лучше в последнем
    expect(
      titleChanges({ summaries: list, excluded: new Set(['G', 'H']) }).map((t) => [
        t.from,
        t.to,
        t.eveningId,
      ]),
    ).toEqual([
      [null, 'A', 'h1'],
      ['A', 'B', 'h8'],
    ]);
  });

  it('гости званий не получают', () => {
    const g1 = simpleEvening('g1', '2026-10-01T16:00:00.000Z', ['G', 'A', 'B']); // A 1 очко, B 0
    expect(titleChanges({ summaries: [g1], excluded: new Set(['G']) })).toEqual([
      { title: 'form', from: null, to: 'A', victimId: null, eveningId: 'g1' },
    ]);
  });
});

describe('seasonEndIso', () => {
  it('начало следующего квартала по Москве', () => {
    expect(seasonEndIso('2026-Q3')).toBe('2026-09-30T21:00:00.000Z');
    expect(seasonEndIso('2026-Q4')).toBe('2026-12-31T21:00:00.000Z');
    expect(() => seasonEndIso('2026-Q5')).toThrow();
  });
});
