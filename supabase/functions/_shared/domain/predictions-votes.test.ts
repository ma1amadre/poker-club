import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import { scorePrediction } from './predictions.ts';
import { replay } from './replay.ts';
import { journal } from './test-utils.ts';
import { voteResults } from './votes.ts';

describe('прогнозы', () => {
  const j = journal().join('A', 'B', 'C');
  j.start();
  j.bust('C', ['A']); // первый вылет — C, хотя потом ребай
  j.rebuy('C');
  j.bust('B', ['A']);
  j.bust('C', ['A']);
  const open = replay(DEFAULT_FORMAT, j.events, j.now());
  j.finish();
  const done = replay(DEFAULT_FORMAT, j.events, j.now());

  it('победитель 3, первый вылет 2', () => {
    expect(scorePrediction({ winnerId: 'A', firstOutId: 'C' }, done)).toEqual({
      winner: 3,
      firstOut: 2,
      total: 5,
    });
    expect(scorePrediction({ winnerId: 'A', firstOutId: 'B' }, done)).toEqual({
      winner: 3,
      firstOut: 0,
      total: 3,
    });
    expect(scorePrediction({ winnerId: 'B', firstOutId: 'C' }, done)).toEqual({
      winner: 0,
      firstOut: 2,
      total: 2,
    });
    expect(scorePrediction({ winnerId: null, firstOutId: null }, done)).toEqual({
      winner: 0,
      firstOut: 0,
      total: 0,
    });
  });

  it('до finish победитель неизвестен, первый вылет уже засчитан', () => {
    expect(scorePrediction({ winnerId: 'A', firstOutId: 'C' }, open)).toEqual({
      winner: 0,
      firstOut: 2,
      total: 2,
    });
  });

  it('без вылетов первый вылет не угадан ни у кого', () => {
    const k = journal().join('A', 'B');
    expect(
      scorePrediction(
        { winnerId: null, firstOutId: 'A' },
        replay(DEFAULT_FORMAT, k.events, k.now()),
      ).firstOut,
    ).toBe(0);
  });
});

describe('голосование', () => {
  it('победитель по каждой категории, ничья — несколько победителей', () => {
    const r = voteResults([
      { voterId: 'A', category: 'hand', nomineeId: 'B' },
      { voterId: 'C', category: 'hand', nomineeId: 'B' },
      { voterId: 'B', category: 'hand', nomineeId: 'C' },
      { voterId: 'A', category: 'bluff', nomineeId: 'D' },
      { voterId: 'B', category: 'bluff', nomineeId: 'C' },
    ]);
    expect(r.hand).toEqual({ winners: ['B'], counts: { B: 2, C: 1 } });
    expect(r.bluff).toEqual({ winners: ['C', 'D'], counts: { D: 1, C: 1 } });
    expect(r.badbeat).toEqual({ winners: [], counts: {} });
  });

  it('голос за себя и неизвестная категория не считаются', () => {
    const r = voteResults([
      { voterId: 'A', category: 'hand', nomineeId: 'A' },
      { voterId: 'A', category: 'nope' as 'hand', nomineeId: 'B' },
    ]);
    expect(r.hand).toEqual({ winners: [], counts: {} });
    expect(Object.keys(r).sort()).toEqual(['badbeat', 'bluff', 'hand']);
  });
});
