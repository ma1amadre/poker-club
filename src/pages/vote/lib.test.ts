import type { EveningEvent, EventPayload, EventType } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  CAPTION_MAX,
  categoryResults,
  formatCountdown,
  photoPlan,
  voteDraftError,
  type VoteLike,
} from './lib';
import { participantIds, votingPhase } from '../../shared/lib/voting';

const NOW = Date.parse('2026-10-06T12:00:00Z');

describe('votingPhase', () => {
  const closes = (ms: number) => new Date(NOW + ms).toISOString();

  it('открыто до voting_closes_at, после — закрыто', () => {
    expect(votingPhase({ status: 'finished', voting_closes_at: closes(1000) }, NOW)).toBe('open');
    expect(votingPhase({ status: 'settled', voting_closes_at: closes(1000) }, NOW)).toBe('open');
    expect(votingPhase({ status: 'finished', voting_closes_at: closes(0) }, NOW)).toBe('closed');
    expect(votingPhase({ status: 'settled', voting_closes_at: closes(-1) }, NOW)).toBe('closed');
  });

  it('незавершённый вечер или нет срока — голосование ещё не началось', () => {
    expect(votingPhase({ status: 'live', voting_closes_at: closes(1000) }, NOW)).toBe('pending');
    expect(votingPhase({ status: 'announced', voting_closes_at: null }, NOW)).toBe('pending');
    expect(votingPhase({ status: 'finished', voting_closes_at: null }, NOW)).toBe('pending');
    expect(votingPhase({ status: 'finished', voting_closes_at: 'вчера' }, NOW)).toBe('pending');
  });
});

describe('participantIds', () => {
  function log(list: [EventType, EventPayload, boolean?][]): EveningEvent[] {
    return list.map(([type, payload, voided], i) => ({
      id: i + 1,
      type,
      payload,
      at: new Date(NOW + i * 1000).toISOString(),
      voided: voided ?? false,
    }));
  }

  it('все с не отменённым join, в порядке входа, без повторов', () => {
    const events = log([
      ['join', { playerId: 'b' }],
      ['join', { playerId: 'a' }],
      ['join', { playerId: 'c' }, true],
      ['timer_start', {}],
      ['bust', { playerId: 'a', by: ['b'] }],
      ['rebuy', { playerId: 'a' }],
      ['join', { playerId: 'b' }],
    ]);
    expect(participantIds(events)).toEqual(['b', 'a']);
  });

  it('порядок по id, а не по порядку в массиве', () => {
    const events = log([
      ['join', { playerId: 'x' }],
      ['join', { playerId: 'y' }],
    ]).reverse();
    expect(participantIds(events)).toEqual(['x', 'y']);
  });
});

describe('categoryResults', () => {
  const v = (voter: string, category: VoteLike['category'], nominee: string): VoteLike => ({
    voter_id: voter,
    category,
    nominee_id: nominee,
  });

  it('победитель, остальные по убыванию, голоса привязаны к номинанту', () => {
    const votes = [
      v('a', 'hand', 'b'),
      v('c', 'hand', 'b'),
      v('d', 'hand', 'c'),
      v('b', 'hand', 'd'),
      v('e', 'hand', 'd'),
      v('f', 'hand', 'd'),
      v('a', 'bluff', 'c'),
    ];
    const res = categoryResults(votes);
    expect(res.hand.total).toBe(6);
    expect(res.hand.winners.map((w) => [w.nomineeId, w.count])).toEqual([['d', 3]]);
    expect(res.hand.winners[0]?.votes.map((x) => x.voter_id)).toEqual(['b', 'e', 'f']);
    expect(res.hand.others.map((o) => [o.nomineeId, o.count])).toEqual([
      ['b', 2],
      ['c', 1],
    ]);
    expect(res.bluff.winners.map((w) => w.nomineeId)).toEqual(['c']);
    expect(res.badbeat).toEqual({ category: 'badbeat', total: 0, winners: [], others: [] });
  });

  it('ничья — несколько победителей', () => {
    const res = categoryResults([v('a', 'bluff', 'b'), v('b', 'bluff', 'a')]);
    expect(res.bluff.winners.map((w) => w.nomineeId)).toEqual(['a', 'b']);
    expect(res.bluff.others).toEqual([]);
  });

  it('голос за себя не считается (как в домене)', () => {
    const res = categoryResults([v('a', 'hand', 'a'), v('b', 'hand', 'c')]);
    expect(res.hand.total).toBe(1);
    expect(res.hand.winners.map((w) => w.nomineeId)).toEqual(['c']);
  });
});

describe('photoPlan', () => {
  it('новый файл: загрузить, старый удалить после голоса', () => {
    expect(photoPlan('e/p/hand-1.jpg', { file: new Blob(['x']), removeExisting: false })).toEqual({
      upload: true,
      keepPath: null,
      removeAfter: 'e/p/hand-1.jpg',
    });
    expect(photoPlan(null, { file: new Blob(['x']), removeExisting: true })).toEqual({
      upload: true,
      keepPath: null,
      removeAfter: null,
    });
  });

  it('убрать фото: голос без фото, файл удалить', () => {
    expect(photoPlan('e/p/hand-1.jpg', { file: null, removeExisting: true })).toEqual({
      upload: false,
      keepPath: null,
      removeAfter: 'e/p/hand-1.jpg',
    });
  });

  it('без изменений: прежний путь передаётся снова', () => {
    expect(photoPlan('e/p/hand-1.jpg', { file: null, removeExisting: false })).toEqual({
      upload: false,
      keepPath: 'e/p/hand-1.jpg',
      removeAfter: null,
    });
    expect(photoPlan(null, { file: null, removeExisting: true })).toEqual({
      upload: false,
      keepPath: null,
      removeAfter: null,
    });
  });
});

describe('voteDraftError', () => {
  const players = ['me', 'a', 'b'];

  it('номинант обязателен, не я и из участников', () => {
    expect(voteDraftError({ nomineeId: null, caption: '' }, 'me', players)).toMatch(/номинанта/);
    expect(voteDraftError({ nomineeId: 'me', caption: '' }, 'me', players)).toMatch(/за себя/);
    expect(voteDraftError({ nomineeId: 'z', caption: '' }, 'me', players)).toMatch(/не играл/);
    expect(voteDraftError({ nomineeId: 'a', caption: '' }, 'me', players)).toBeNull();
  });

  it('подпись до 200 символов после обрезки пробелов', () => {
    const ok = `  ${'я'.repeat(CAPTION_MAX)}  `;
    expect(voteDraftError({ nomineeId: 'a', caption: ok }, 'me', players)).toBeNull();
    const long = 'я'.repeat(CAPTION_MAX + 1);
    expect(voteDraftError({ nomineeId: 'a', caption: long }, 'me', players)).toMatch(/200/);
  });
});

describe('formatCountdown', () => {
  it('больше часа — часы и минуты, меньше — минуты и секунды', () => {
    expect(formatCountdown(23 * 3600_000 + 15 * 60_000 + 30_000)).toBe('23 ч 15 мин');
    expect(formatCountdown(3600_000)).toBe('1 ч');
    expect(formatCountdown(14 * 60_000 + 31_500)).toBe('14:32');
    expect(formatCountdown(-5000)).toBe('00:00');
  });
});
