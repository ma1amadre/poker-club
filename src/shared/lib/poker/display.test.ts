import { describe, expect, it } from 'vitest';
import {
  catchUpText,
  holdsText,
  noOutsText,
  outsBySuit,
  outsLabel,
  outsTarget,
  STREET_LABEL,
} from './display';

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

  it('ауты по мастям ♠ ♥ ♦ ♣, у масти — ранги от туза, десятка — «10»', () => {
    expect(outsBySuit(['7c', 'Kd', 'As', 'Td', 'Ah', 'Ks', 'Th'])).toEqual([
      { suit: 's', ranks: ['A', 'K'] },
      { suit: 'h', ranks: ['A', '10'] },
      { suit: 'd', ranks: ['K', '10'] },
      { suit: 'c', ranks: ['7'] },
    ]);
    // Флеш-дро — одна плашка масти.
    expect(outsBySuit(['3h', 'Ah', '9h', 'Kh', 'Th', '4h', 'Qh', '6h', '5h'])).toEqual([
      { suit: 'h', ranks: ['A', 'K', 'Q', '10', '9', '6', '5', '4', '3'] },
    ]);
    // Флеш-дро и стрит-дро (8♥9♥ на 10♥ J♣ 2♥): черви целиком, дамы и семёрки — у своих мастей.
    expect(
      outsBySuit([
        'Ah',
        'Kh',
        'Qh',
        'Jh',
        '7h',
        '6h',
        '5h',
        '4h',
        '3h',
        'Qs',
        'Qd',
        'Qc',
        '7s',
        '7d',
        '7c',
      ]),
    ).toEqual([
      { suit: 's', ranks: ['Q', '7'] },
      { suit: 'h', ranks: ['A', 'K', 'Q', 'J', '7', '6', '5', '4', '3'] },
      { suit: 'd', ranks: ['Q', '7'] },
      { suit: 'c', ranks: ['Q', '7'] },
    ]);
    expect(outsBySuit([])).toEqual([]);
  });

  it('ауты по мастям: каждая карта — ровно в одной масти, мастей не больше четырёх', () => {
    const deck = 'AKQJT98765432'.split('').flatMap((r) => ['s', 'h', 'd', 'c'].map((s) => r + s));
    for (let k = 1; k <= 40; k += 1) {
      const codes = deck.filter((_, i) => (i * 7 + k * 3) % 41 < k);
      const groups = outsBySuit(codes);
      const cards = groups.flatMap((g) => g.ranks.map((r) => (r === '10' ? 'T' : r) + g.suit));
      expect([...cards].sort()).toEqual([...codes].sort());
      expect(groups.length).toBeLessThanOrEqual(4);
    }
  });

  it('подпись к числу аутов и «аутов нет»', () => {
    expect(outsLabel(1, 'к тёрну')).toBe('аут к тёрну');
    expect(outsLabel(3, 'к риверу')).toBe('аута к риверу');
    expect(outsLabel(12, 'к тёрну')).toBe('аутов к тёрну');
    expect(outsLabel(21, 'к тёрну')).toBe('аут к тёрну');
    // На тёрне аутов нет — руке не догнать; на флопе — нет к тёрну, до ривера ещё двумя картами.
    expect(noOutsText('turn')).toBe('Аутов нет');
    expect(noOutsText('flop')).toBe('Аутов к тёрну нет');
  });

  it('устоит ли тот, кто впереди, на тёрне (к риверу): склонение и крайние случаи', () => {
    // Число не отрывается от слова: между ними неразрывный пробел.
    expect(holdsText(35, 44, 'turn')).toBe('Устоит на 35 картах из 44');
    expect(holdsText(31, 44, 'turn')).toBe('Устоит на 31 карте из 44');
    expect(holdsText(11, 44, 'turn')).toBe('Устоит на 11 картах из 44');
    expect(holdsText(44, 44, 'turn')).toBe('Устоит на любой карте');
    // Ноль — на каждой карте кто-то догоняет хотя бы до дележа, не обязательно обгоняет.
    expect(holdsText(0, 44, 'turn')).toBe('Не устоит ни на одной карте');
  });

  it('на флопе «устоит» и «догонит» — с улицей: считают только тёрн, шансы рядом — до ривера', () => {
    expect(holdsText(30, 45, 'flop')).toBe('Устоит на тёрне: 30 карт из 45');
    expect(holdsText(21, 45, 'flop')).toBe('Устоит на тёрне: 21 карта из 45');
    expect(holdsText(22, 37, 'flop')).toBe('Устоит на тёрне: 22 карты из 37');
    expect(holdsText(45, 45, 'flop')).toBe('Устоит на тёрне: любая карта');
    expect(catchUpText(33, 'flop')).toBe('Догонит на тёрне: 33 %');
    // На тёрне ривер последний — процент и есть итог, улица не нужна.
    expect(catchUpText(20, 'turn')).toBe('Догонит: 20 %');
    // Строка рвётся только после «Догонит»: «на тёрне: 33 %» — одним куском.
    expect(catchUpText(33, 'flop').split(' ')).toHaveLength(2);
  });
});
