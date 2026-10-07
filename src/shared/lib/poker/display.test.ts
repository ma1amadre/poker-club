import { describe, expect, it } from 'vitest';
import { groupOuts, outsTarget, STREET_LABEL } from './display';

describe('подписи олл-ина', () => {
  it('улицы и куда считаются ауты', () => {
    expect(STREET_LABEL).toEqual({
      preflop: 'до флопа',
      flop: 'флоп',
      turn: 'тёрн',
      river: 'ривер',
    });
    expect(['preflop', 'flop', 'turn', 'river'].map((s) => outsTarget(s as never))).toEqual([
      null,
      'к тёрну',
      'к риверу',
      null,
    ]);
  });

  it('ауты по рангам от туза, масти ♠ ♥ ♦ ♣, десятка — «10»', () => {
    expect(groupOuts(['7c', 'Kd', 'As', 'Td', 'Ah', 'Ks', 'Th'])).toEqual([
      { rank: 'A', suits: ['s', 'h'] },
      { rank: 'K', suits: ['s', 'd'] },
      { rank: '10', suits: ['h', 'd'] },
      { rank: '7', suits: ['c'] },
    ]);
    expect(groupOuts([])).toEqual([]);
  });
});
