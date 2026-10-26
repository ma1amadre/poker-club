import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replayLog } from '@domain/replay.ts';
import { journal, type Journal } from '@domain/test-utils.ts';
import type { LevelTrigger, TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  applyHolds,
  FOCUS_BLIND,
  FOCUS_LIVE,
  FOCUS_OUT,
  NO_HOLDS,
  placeText,
  tvTable,
} from './tableModel';

const t: LevelTrigger = { type: 'time', minutes: 40 };
const FMT: TournamentFormat = {
  ...DEFAULT_FORMAT,
  rebuyUntilLevel: 2,
  levels: [
    { sb: 25, bb: 50, trigger: t },
    { sb: 50, bb: 100, trigger: t },
    { sb: 75, bb: 150, trigger: t },
  ],
};

/** Стол макета: 01 Саша, 02 Женя, 03 Дима, 04 Костя, 05 Миша, 07 Вова, 10 Лёша; баттон — 5. */
function table(): Journal {
  const j = journal().join('sasha', 'zhenya', 'dima', 'kostya', 'misha', 'vova', 'lesha');
  const seats: [string, number][] = [
    ['sasha', 1],
    ['zhenya', 2],
    ['dima', 3],
    ['kostya', 4],
    ['misha', 5],
    ['vova', 7],
    ['lesha', 10],
  ];
  for (const [id, seat] of seats) j.seat(id, seat);
  j.button(5);
  j.start();
  return j;
}

const state = (j: Journal, format = FMT) => replayLog(format, j.events, j.now()).state;

describe('стол на табло: места, метки, фокус', () => {
  it('места по номерам: кто сидит, в игре или вылетел, пустые — пустые', () => {
    const j = table();
    j.wait(5).bust('dima', ['sasha']);
    const v = tvTable(state(j));
    expect(v.seated).toBe(true);
    expect(v.seats.map((s) => s.status)).toEqual([
      'live', // 1 Саша
      'live', // 2 Женя
      'out', // 3 Дима
      'live', // 4 Костя
      'live', // 5 Миша
      'empty', // 6
      'live', // 7 Вова
      'empty', // 8
      'empty', // 9
      'live', // 10 Лёша
    ]);
    expect(v.seats[2]?.playerId).toBe('dima');
    // Ставки и стеки посчитает камера — сейчас пусто.
    expect(v.seats.every((s) => s.bet === null && s.stack === null)).toBe(true);
  });

  it('метки: D — на баттоне, SB и BB — два следующих в игре по часовой; суммы — блайнды уровня', () => {
    const v = tvTable(state(table()));
    expect(v.markers).toEqual({ D: 5, SB: 7, BB: 10 });
    expect([v.sbAmount, v.bbAmount]).toEqual([25, 50]);
  });

  it('фокус: полной яркостью — на D/SB/BB, остальные в игре тише, вылетевший — приглушён, пустое — 0', () => {
    const j = table();
    j.wait(5).bust('dima', ['sasha']);
    const v = tvTable(state(j));
    const focus = (seat: number) => v.seats[seat - 1]?.focus;
    expect([focus(5), focus(7), focus(10)]).toEqual([FOCUS_BLIND, FOCUS_BLIND, FOCUS_BLIND]);
    expect([focus(1), focus(2), focus(4)]).toEqual([FOCUS_LIVE, FOCUS_LIVE, FOCUS_LIVE]);
    expect(focus(3)).toBe(FOCUS_OUT);
    expect(focus(6)).toBe(0);
  });

  it('следующая раздача — метки уходят к следующим живым по часовой, вылетевший пропускается', () => {
    const j = table();
    j.wait(5).bust('kostya', ['sasha']);
    j.hand();
    // Баттон 5 → 7 (6 пусто), SB 10 (8, 9 пусто), BB 1.
    expect(tvTable(state(j)).markers).toEqual({ D: 7, SB: 10, BB: 1 });
  });

  it('баттон не задан — меток нет; рассадки нет — стол не рисуется (прежний список)', () => {
    const j = journal().join('a', 'b', 'c');
    j.start();
    const v = tvTable(state(j));
    expect(v.seated).toBe(false);
    expect(v.markers).toEqual({ D: null, SB: null, BB: null });
  });

  it('в игре без места — строкой «Без места»', () => {
    const j = table();
    j.join('guest');
    expect(tvTable(state(j)).unseated).toEqual(['guest']);
  });

  it('место вылетевшего: известно после закрытия ребаев, до того — «вне игры»', () => {
    const j = table();
    j.wait(5).bust('dima', ['sasha']);
    expect(tvTable(state(j)).seats[2]?.place).toBeNull();
    expect(placeText(null)).toBe('вне игры');
    j.wait(80); // уровень 3 — ребаи закрыты
    expect(tvTable(state(j)).seats[2]?.place).toBe(7);
    expect(placeText(7)).toBe('7-е место');
  });
});

describe('удержание: экран держит прежнее, пока момент не дошёл до такта', () => {
  it('ничего не держим — тот же объект', () => {
    const s = state(table());
    expect(applyHolds(s, FMT, NO_HOLDS)).toBe(s);
  });

  it('вылетевший до такта нокаута — в игре: «в игре», позиции и средний стек как до вылета', () => {
    const j = table();
    const before = state(j);
    j.wait(1).bust('misha', ['zhenya']);
    const after = state(j);
    const held = applyHolds(after, FMT, { alive: ['misha'], levelIndex: null });
    expect(held.aliveCount).toBe(before.aliveCount);
    expect(held.players.misha?.alive).toBe(true);
    expect(tvTable(held).markers).toEqual(tvTable(before).markers);
    // Настоящее состояние не тронуто.
    expect(after.players.misha?.alive).toBe(false);
  });

  it('уровень до такта заставки — прежний: блайнды, следующий уровень', () => {
    const j = table();
    j.wait(41);
    const s = state(j);
    expect(s.timer.levelIndex).toBe(1);
    const held = applyHolds(s, FMT, { alive: [], levelIndex: 0 });
    expect(held.currentLevel.bb).toBe(50);
    expect(held.nextLevel?.bb).toBe(100);
    expect(held.timer.levelIndex).toBe(0);
    expect(tvTable(held).bbAmount).toBe(50);
  });

  it('держать игрока, который уже снова в игре (ребай), — не нужно: состояние то же', () => {
    const j = table();
    j.wait(1).bust('misha', ['zhenya']);
    j.rebuy('misha');
    const s = state(j);
    expect(applyHolds(s, FMT, { alive: ['misha'], levelIndex: null })).toBe(s);
  });
});
