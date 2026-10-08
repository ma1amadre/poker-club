import { describe, expect, it } from 'vitest';
import {
  REVEAL_STEP_MS,
  revealedSize,
  revealStart,
  revealStep,
  type RevealState,
  type RevealTarget,
} from './streetReveal';

const T0 = 1_000_000;
const sd = (size: number, showdownId = 'x'): RevealTarget => ({ showdownId, size });

/** Прогон по секундам, как тикает табло: сколько карт стола видно на каждой секунде. */
function timeline(start: RevealState, frames: [number, RevealTarget | null][]): number[] {
  let state = start;
  const shown: number[] = [];
  for (const [t, target] of frames) {
    state = revealStep(state, target, T0 + t * 1000);
    shown.push(target ? revealedSize(state, target) : 0);
  }
  return shown;
}

describe('раскрытие улиц на табло', () => {
  it('первый кадр — стол как есть, без розыгрыша истории', () => {
    const start = revealStart(sd(5), T0);
    expect(revealedSize(start, sd(5))).toBe(5);
    expect(revealStep(start, sd(5), T0 + 1000)).toBe(start);
  });

  it('банкир внёс флоп, тёрн и ривер разом: флоп, через 3 с тёрн, ещё через 3 с ривер', () => {
    const start = revealStart(null, T0);
    const frames: [number, RevealTarget | null][] = [
      [0, null],
      [1, sd(5)],
      [2, sd(5)],
      [3, sd(5)],
      [4, sd(5)],
      [5, sd(5)],
      [6, sd(5)],
      [7, sd(5)],
      [8, sd(5)],
    ];
    expect(timeline(start, frames)).toEqual([0, 3, 3, 3, 4, 4, 4, 5, 5]);
  });

  it('новая раздача до флопа — руки; поздний флоп после долгого префлопа — сразу', () => {
    const start = revealStart(null, T0);
    expect(
      timeline(start, [
        [1, sd(0)],
        [30, sd(3)],
        [31, sd(3)],
      ]),
    ).toEqual([0, 3, 3]);
  });

  it('тёрн и ривер разом после флопа: тёрн сразу (флоп висел долго), ривер — через шаг', () => {
    const start = revealStart(sd(3), T0);
    expect(
      timeline(start, [
        [20, sd(5)],
        [21, sd(5)],
        [22, sd(5)],
        [23, sd(5)],
      ]),
    ).toEqual([4, 4, 4, 5]);
  });

  it('быстрые отправки по одной улице тоже идут с паузой', () => {
    const start = revealStart(null, T0);
    expect(
      timeline(start, [
        [1, sd(3)],
        [2, sd(4)],
        [3, sd(4)],
        [4, sd(5)],
        [5, sd(5)],
        [6, sd(5)],
        [7, sd(5)],
      ]),
    ).toEqual([3, 3, 3, 4, 4, 4, 5]);
  });

  it('отменили ривер — сразу назад, без ожидания', () => {
    const start = revealStart(sd(5), T0);
    expect(timeline(start, [[1, sd(4)]])).toEqual([4]);
  });

  it('новая раздача сразу с ривером — снова с флопа', () => {
    const start = revealStart(sd(5, 'old'), T0);
    expect(
      timeline(start, [
        [1, sd(5, 'new')],
        [4, sd(5, 'new')],
        [7, sd(5, 'new')],
      ]),
    ).toEqual([3, 4, 5]);
  });

  it('пауза между шагами — REVEAL_STEP_MS', () => {
    const s1 = revealStep(revealStart(null, T0), sd(5), T0);
    expect(s1.shown).toBe(3);
    expect(revealStep(s1, sd(5), T0 + REVEAL_STEP_MS - 1)).toBe(s1);
    expect(revealStep(s1, sd(5), T0 + REVEAL_STEP_MS).shown).toBe(4);
  });

  it('олл-ин исчез с табло — память раздачи остаётся', () => {
    const s = revealStart(sd(5), T0);
    expect(revealStep(s, null, T0 + 5000)).toBe(s);
  });
});
