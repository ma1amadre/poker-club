import type { Street } from '@domain/showdown.ts';
import type { ShowdownHand } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import { analyzeShowdown, type ShowdownAnalysis } from '../../../shared/lib/poker/analysis';
import { computeEquity } from '../../../shared/lib/poker/equity';
import {
  boardEdited,
  initialShown,
  nextStreet,
  resultChanged,
  settledShown,
  type ScriptData,
} from './allinScript';

const HANDS: ShowdownHand[] = [
  { playerId: 'lesha', cards: ['8h', '8s'] },
  { playerId: 'kostya', cards: ['Ac', 'Qd'] },
];
const BOARD = ['Ks', '7d', '2c', '5h', 'Qc'];

function data(board: string[], busted: string[] = [], stayed: string[] = []): ScriptData {
  const codes = HANDS.map((h) => h.cards);
  const at = (n: number): ShowdownAnalysis | null =>
    board.length >= n && n >= 3
      ? analyzeShowdown(codes, board.slice(0, n), computeEquity(codes, board.slice(0, n)))
      : null;
  const analyses: Record<Street, ShowdownAnalysis | null> = {
    preflop: null,
    flop: at(3),
    turn: at(4),
    river: at(5),
  };
  return { hands: HANDS, board, analyses, busted: new Set(busted), stayed: new Set(stayed) };
}

describe('такты олл-ина: какую улицу играть', () => {
  it('до входа — вход (до флопа); потом — по одной улице, пока не догнали стол', () => {
    const d = data([]);
    const s = initialShown(d, 'k');
    expect(nextStreet(s, 0)).toBe('preflop');
    expect(nextStreet({ ...s, handsIn: true }, 0)).toBeNull();
    expect(nextStreet({ ...s, handsIn: true }, 3)).toBe('flop');
    // Стол уже на ривере, а табло показало флоп — следующая всё равно тёрн (улицы по очереди).
    expect(nextStreet({ ...s, handsIn: true, street: 'flop' }, 5)).toBe('turn');
    expect(nextStreet({ ...s, handsIn: true, street: 'river' }, 5)).toBeNull();
  });

  it('до входа руки не видны и проценты не показаны', () => {
    const s = initialShown(data([]), 'k');
    expect(s.handsIn).toBe(false);
    expect(s.hands.every((h) => h.pct === null && h.fxHidden)).toBe(true);
    expect(s.hands.map((h) => h.made)).toEqual(['Пара восьмёрок', 'Туз-дама']);
  });
});

describe('такты олл-ина: открыли посреди раздачи — всё как есть', () => {
  it('флоп: карты на столе, проценты и ауты сразу, руки подняты', () => {
    const s = settledShown(data(BOARD.slice(0, 3)), 'k', 1);
    expect(s).toMatchObject({
      instant: true,
      street: 'flop',
      board: 3,
      lifted: true,
      handsIn: true,
      gen: 1,
    });
    expect(s.hands.map((h) => h.pct)).toEqual([74, 26]);
    expect(s.hands[1]?.outs?.count).toBe(6);
  });

  it('ривер: развязка сразу — победитель с полной полосой, проигравший в тени, комбинация подчёркнута', () => {
    const s = settledShown(data(BOARD), 'k', 0);
    expect(s.street).toBe('river');
    expect(s.hands.map((h) => h.result?.kind)).toEqual(['lose', 'win']);
    expect(s.hands[1]?.bar).toBe(1);
    expect(s.hands[0]?.dim).toBeLessThan(1);
    expect(s.comboBoard.length + (s.hands[1]?.combo.length ?? 0)).toBe(5);
  });

  it('вылет участника на ривере — красный флап на месте статуса, колонка ещё тише', () => {
    const s = settledShown(data(BOARD, ['lesha']), 'k', 0);
    expect(s.hands[0]?.result?.kind).toBe('out');
    expect(s.hands[0]?.dim).toBeLessThan(0.45);
  });

  it('банкир ответил «остаётся за столом» — у проигравшего «остаётся в игре», у победителя «удвоение»', () => {
    const s = settledShown(data(BOARD, [], ['lesha']), 'k', 0);
    expect(s.hands.map((h) => h.result)).toEqual([
      { kind: 'stay', pot: null },
      { kind: 'win', pot: 'Весь банк', note: 'удвоение' },
    ]);
    expect(s.hands[0]?.dim).toBe(0.45);
  });

  it('ответ банкира после развязки — итог руки меняется (вылет, «остаётся», «удвоение»), прочее — нет', () => {
    const lose = { kind: 'lose', pot: null } as const;
    const win = { kind: 'win', pot: 'Весь банк' } as const;
    expect(resultChanged(lose, { kind: 'out', pot: null })).toBe(true);
    expect(resultChanged(lose, { kind: 'stay', pot: null })).toBe(true);
    expect(resultChanged(win, { ...win, note: 'удвоение' })).toBe(true);
    expect(resultChanged(win, { ...win })).toBe(false);
    // Развязки ещё не было — менять нечего.
    expect(resultChanged(null, { kind: 'out', pot: null })).toBe(false);
  });
});

describe('такты олл-ина: правка стола', () => {
  it('карту стола заменили при том же числе карт — правка: экран встаёт заново по новому столу', () => {
    const flop = ['Kh', '7c', '2d'];
    const s = settledShown(data(flop), 'k', 0);
    expect(s.cards).toEqual(flop);
    expect(boardEdited(s, flop)).toBe(false);
    // Пришёл тёрн — не правка: показанные карты на месте.
    expect(boardEdited(s, [...flop, '5s'])).toBe(false);
    // 2♦ поправили на 2♥ — правка, хотя карт по-прежнему три.
    expect(boardEdited(s, ['Kh', '7c', '2h'])).toBe(true);
    // Карту убрали — тоже правка.
    expect(boardEdited(s, flop.slice(0, 2))).toBe(true);
  });

  it('пока карты не легли в гнёзда, новый стол — не правка', () => {
    const s = initialShown(data([]), 'k');
    expect(boardEdited(s, ['Kh', '7c', '2d'])).toBe(false);
  });

  it('поправленный ривер меняет победителя — развязка по новому столу', () => {
    const river = settledShown(data(BOARD), 'k', 0);
    expect(river.hands.map((h) => h.result?.kind)).toEqual(['lose', 'win']);
    // Ривер Q♣ → 8♦: у Лёши сет восьмёрок.
    const fixed = [...BOARD.slice(0, 4), '8d'];
    expect(boardEdited(river, fixed)).toBe(true);
    const again = settledShown(data(fixed), 'k', 1);
    expect(again.hands.map((h) => h.result?.kind)).toEqual(['win', 'lose']);
    expect(again.hands[0]?.bar).toBe(1);
    expect(again.hands[1]?.bar).toBe(0);
  });
});
