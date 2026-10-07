import { clubMoments } from '@domain/feed.ts';
import { simpleEvening } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import type { ClubHistory, Evening, VoteRow } from '../../shared/api';
import { clubFeedInput, momentsNowMs, nextVotingCloseMs } from '../../shared/api/historyFeed';
import { groupMoments, openVotings } from './moments';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-20T12:00:00.000Z');

function evening(id: string, closesAt: string | null, status: Evening['status'] = 'finished') {
  return {
    id,
    status,
    finished_at: '2026-10-08T20:00:00.000Z',
    voting_closes_at: closesAt,
  } as Evening;
}

function vote(
  eveningId: string,
  voter: string,
  category: VoteRow['category'],
  nominee: string,
  extra: Partial<VoteRow> = {},
): VoteRow {
  return {
    evening_id: eveningId,
    voter_id: voter,
    category,
    nominee_id: nominee,
    caption: null,
    photo_path: null,
    created_at: '2026-10-08T21:00:00.000Z',
    ...extra,
  };
}

const s1 = simpleEvening('e1', '2026-10-01T16:00:00.000Z', ['A', 'B', 'C'], 'winner');
const s2 = simpleEvening('e2', '2026-10-08T16:00:00.000Z', ['B', 'A', 'C'], 'winner');

const history = {
  summaries: [s2, s1],
  evenings: [
    evening('e2', new Date(NOW - HOUR).toISOString()),
    evening('e1', new Date(NOW - 7 * 24 * HOUR).toISOString()),
  ],
  votesByEvening: new Map([
    [
      'e1',
      [
        vote('e1', 'A', 'hand', 'B', { caption: 'Стрит на ривере' }),
        vote('e1', 'C', 'hand', 'B'),
        vote('e1', 'B', 'bluff', 'A', { photo_path: 'e1/B/abc.jpg' }),
      ],
    ],
    ['e2', [vote('e2', 'A', 'badbeat', 'C'), vote('e2', 'B', 'badbeat', 'A')]],
  ]),
  achievementInput: {
    summaries: [s2, s1],
    excluded: new Set<string>(),
    predictions: [],
    stars: [],
    bestN: 10,
    currentSeasonKey: '2026-Q4',
  },
  fetchedAtMs: NOW,
} as unknown as Pick<
  ClubHistory,
  'achievementInput' | 'evenings' | 'votesByEvening' | 'fetchedAtMs'
>;

const momentsInput = clubFeedInput;

describe('вход моментов из истории', () => {
  it('строки evenings и голоса — в форме домена', () => {
    const input = momentsInput(history);
    expect(input.evenings[0]).toEqual({
      eveningId: 'e2',
      finishedAt: '2026-10-08T20:00:00.000Z',
      votingClosesAt: history.evenings[0]?.voting_closes_at,
    });
    expect(input.votes).toHaveLength(5);
    expect(input.votes[0]).toEqual({
      eveningId: 'e1',
      voterId: 'A',
      category: 'hand',
      nomineeId: 'B',
      caption: 'Стрит на ривере',
      photoPath: null,
      createdAt: '2026-10-08T21:00:00.000Z',
    });
  });

  it('моменты по вечерам: новые сверху, ничья — каждому победителю', () => {
    const moments = clubMoments(momentsInput(history), { nowMs: NOW });
    const groups = groupMoments(moments, (id) => (id === 'e1' ? s1.date : s2.date));
    expect(groups.map((g) => g.eveningId)).toEqual(['e2', 'e1']);
    expect(groups[0]?.date).toBe(s2.date);
    expect(groups[0]?.moments.map((m) => [m.category, m.nomineeId, m.tie])).toEqual([
      ['badbeat', 'A', true],
      ['badbeat', 'C', true],
    ]);
    const e1 = groups[1]?.moments ?? [];
    expect(e1.map((m) => [m.category, m.nomineeId, m.votes])).toEqual([
      ['hand', 'B', 2],
      ['bluff', 'A', 1],
    ]);
    expect(e1[0]?.caption).toBe('Стрит на ривере');
    expect(e1[1]?.photoPath).toBe('e1/B/abc.jpg');
  });

  it('до закрытия голосования моментов вечера нет', () => {
    const moments = clubMoments(momentsInput(history), { nowMs: NOW - 2 * HOUR });
    expect(new Set(moments.map((m) => m.eveningId))).toEqual(new Set(['e1']));
  });
});

describe('моменты и загрузка истории', () => {
  it('голосование, закрытое после загрузки, — без моментов: в кеше только свои голоса', () => {
    // История загружена за минуту до закрытия e2; тик часов ушёл за закрытие.
    const loaded = { ...history, fetchedAtMs: NOW - 2 * HOUR };
    const now = momentsNowMs(loaded, NOW);
    expect(now).toBe(NOW - 2 * HOUR);
    const moments = clubMoments(clubFeedInput(loaded), { nowMs: now });
    expect(new Set(moments.map((m) => m.eveningId))).toEqual(new Set(['e1']));
    // Перезапрос — к ближайшему закрытию после загрузки.
    expect(nextVotingCloseMs(loaded)).toBe(NOW - HOUR);
    expect(nextVotingCloseMs(history)).toBeNull();
  });
});

describe('идущие голосования', () => {
  it('только завершённые вечера до закрытия, ближнее закрытие первым', () => {
    const list = [
      evening('late', new Date(NOW + 10 * HOUR).toISOString()),
      evening('soon', new Date(NOW + HOUR).toISOString(), 'settled'),
      evening('closed', new Date(NOW - HOUR).toISOString()),
      evening('none', null),
      evening('live', new Date(NOW + HOUR).toISOString(), 'live'),
    ];
    expect(openVotings(list, NOW).map((e) => e.id)).toEqual(['soon', 'late']);
  });
});
