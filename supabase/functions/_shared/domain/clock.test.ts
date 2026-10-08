// Пауза на N минут и поправка остатка уровня ±1 мин (миграция 022).
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import { canApply, pauseLeftMs, readPause, readTimeAdjust, replay } from './replay.ts';
import { journal, MIN } from './test-utils.ts';
import type { TournamentFormat } from './types.ts';

const F = DEFAULT_FORMAT; // уровни по 40 минут, ребаи до конца 5-го
const errorsOf = (s: { errors: { eventId: number; message: string }[] }) =>
  s.errors.map((e) => e.message);

describe('пауза на N минут', () => {
  it('отсчёт до конца перерыва; по истечении таймер сам не идёт', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(10);
    const pauseId = j.pauseFor(10);
    const at = new Date(j.now()).toISOString();
    let s = replay(F, j.events, j.now() + 3 * MIN);
    expect(s.timer.status).toBe('paused');
    expect(s.timer.pause).toEqual({ eventId: pauseId, at, minutes: 10 });
    expect(pauseLeftMs(s, j.now() + 3 * MIN)).toBe(7 * MIN);
    // Срок вышел — «пора продолжать», но часы стоят: продолжает только банкир.
    s = replay(F, j.events, j.now() + 12 * MIN);
    expect(s.timer.status).toBe('paused');
    expect(s.timer.levelElapsedMs).toBe(10 * MIN);
    expect(pauseLeftMs(s, j.now() + 12 * MIN)).toBe(-2 * MIN);
    j.wait(15).resume();
    s = replay(F, j.events, j.now() + MIN);
    expect(s.timer.pause).toBe(null);
    expect(s.timer.levelElapsedMs).toBe(11 * MIN);
    expect(pauseLeftMs(s, j.now())).toBe(null);
  });

  it('пауза без срока — как до 022: пауза есть, отсчёта нет', () => {
    const j = journal().join('A', 'B');
    j.start();
    const id = j.wait(5).pause();
    const s = replay(F, j.events, j.now() + MIN);
    expect(s.timer.pause).toMatchObject({ eventId: id, minutes: null });
    expect(pauseLeftMs(s, j.now() + MIN)).toBe(null);
    expect(readPause({})).toEqual({ minutes: null });
  });

  it('длительность — целое 1..120; неверная — запись не принята, часы идут', () => {
    for (const minutes of [0, 121, 2.5, -5]) {
      const j = journal().join('A', 'B');
      j.start();
      j.wait(5).add('timer_pause', { minutes });
      const s = replay(F, j.events, j.now() + MIN);
      expect(errorsOf(s)).toEqual(['Пауза: длительность — целое число минут от 1 до 120']);
      expect(s.timer.status).toBe('running');
    }
    expect(readPause({ minutes: '10' })).toBe(null);
    expect(readPause({ minutes: 1 })).toEqual({ minutes: 1 });
    expect(readPause({ minutes: 120 })).toEqual({ minutes: 120 });
  });

  it('пауза на паузе не принимается; финиш снимает перерыв', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(5).pauseFor(10);
    j.wait(1).pauseFor(5);
    let s = replay(F, j.events, j.now());
    expect(errorsOf(s)).toEqual(['Таймер не идёт']);
    expect(s.timer.pause?.minutes).toBe(10);
    expect(canApply(F, s, 'timer_pause', { minutes: 5 }, j.now())).toBe('Таймер не идёт');
    j.bust('B', ['A']);
    j.finish();
    s = replay(F, j.events, j.now());
    expect(s.finished).toBe(true);
    expect(s.timer.pause).toBe(null);
    expect(pauseLeftMs(s, j.now())).toBe(null);
  });

  it('canApply: пауза с длительностью — только при идущем таймере', () => {
    const j = journal().join('A', 'B');
    let s = replay(F, j.events, j.now());
    expect(canApply(F, s, 'timer_pause', { minutes: 10 }, j.now())).toBe('Таймер не идёт');
    j.start();
    s = replay(F, j.events, j.now());
    expect(canApply(F, s, 'timer_pause', { minutes: 10 }, j.now())).toBe(null);
    expect(canApply(F, s, 'timer_pause', { minutes: 0 }, j.now())).toMatch(/^Пауза:/);
  });
});

describe('поправка остатка уровня ±1 мин', () => {
  it('+1 мин: остаток больше на минуту, уровень сменится на минуту позже, игровое время то же', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(10).adjust(60);
    let s = replay(F, j.events, j.now());
    expect(s.timer.levelRemainingMs).toBe(31 * MIN);
    expect(s.timer.levelElapsedMs).toBe(9 * MIN);
    expect(s.timer.totalElapsedMs).toBe(10 * MIN);
    s = replay(F, j.events, j.now() + 30.5 * MIN);
    expect(s.timer.levelIndex).toBe(0);
    s = replay(F, j.events, j.now() + 31 * MIN);
    expect(s.timer.levelIndex).toBe(1);
    expect(s.timer.levelElapsedMs).toBe(0);
  });

  it('−1 мин: уровень короче; на паузе тоже можно («ушли за пиццей и забыли паузу»)', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(20).pause();
    j.wait(5).adjust(-60);
    j.adjust(-60);
    let s = replay(F, j.events, j.now());
    expect(errorsOf(s)).toEqual([]);
    expect(s.timer.status).toBe('paused');
    expect(s.timer.levelRemainingMs).toBe(18 * MIN);
    j.resume();
    s = replay(F, j.events, j.now() + 18 * MIN);
    expect(s.timer.levelIndex).toBe(1);
  });

  it('не уходит в минус: убавить нельзя, если уровень бы закончился', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(39).adjust(-60); // осталась ровно минута — ноль это переход, не поправка
    let s = replay(F, j.events, j.now());
    expect(errorsOf(s)).toEqual([
      'Убавить нельзя: уровень бы закончился — для этого есть «Уровень вперёд»',
    ]);
    expect(s.timer.levelRemainingMs).toBe(MIN);
    const k = journal().join('A', 'B');
    k.start();
    k.wait(38.5).adjust(-60); // полторы минуты — можно, останется полминуты
    s = replay(F, k.events, k.now());
    expect(errorsOf(s)).toEqual([]);
    expect(s.timer.levelRemainingMs).toBe(0.5 * MIN);
  });

  it('не больше длины уровня: прибавить нельзя, если остаток стал бы длиннее уровня', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(0.5).adjust(60);
    let s = replay(F, j.events, j.now());
    expect(errorsOf(s)).toEqual(['Прибавить нельзя: остаток стал бы больше длины уровня']);
    j.wait(0.5).adjust(60); // прошла ровно минута — остаток станет ровно 40 минут
    s = replay(F, j.events, j.now());
    expect(errorsOf(s)).toHaveLength(1);
    expect(s.timer.levelRemainingMs).toBe(40 * MIN);
  });

  it('только уровень по времени и не последний; таймер запущен; вечер не завершён', () => {
    const levels: TournamentFormat['levels'] = [
      { sb: 5, bb: 10, trigger: { type: 'eliminations', count: 2 } },
      { sb: 10, bb: 20, trigger: { type: 'time', minutes: 20 } },
      { sb: 20, bb: 40, trigger: { type: 'time', minutes: 20 } },
    ];
    const fmt: TournamentFormat = { ...F, levels };
    const j = journal().join('A', 'B', 'C', 'D');
    j.adjust(60);
    j.start();
    j.wait(1).adjust(60);
    j.next();
    j.wait(5).adjust(60);
    j.next();
    j.wait(5).adjust(60);
    let s = replay(fmt, j.events, j.now());
    expect(errorsOf(s)).toEqual([
      'Таймер не запущен',
      'Уровень не по времени — поправлять нечего',
      'Последний уровень сам не кончается — поправлять нечего',
    ]);
    expect(s.timer.levelRemainingMs).toBe(15 * MIN);
    j.bust('B', ['A']);
    j.bust('C', ['A']);
    j.bust('D', ['A']);
    j.finish();
    j.adjust(60);
    s = replay(fmt, j.events, j.now());
    expect(errorsOf(s).at(-1)).toBe('Вечер уже завершён');
  });

  it('форма: целое, не ноль, по модулю до часа', () => {
    expect(readTimeAdjust({ seconds: 60 })).toBe(60);
    expect(readTimeAdjust({ seconds: -60 })).toBe(-60);
    expect(readTimeAdjust({ seconds: 3600 })).toBe(3600);
    for (const bad of [{ seconds: 0 }, { seconds: 1.5 }, { seconds: 3601 }, { seconds: '60' }, {}])
      expect(readTimeAdjust(bad)).toBe(null);
    const j = journal().join('A', 'B');
    j.start();
    j.wait(10).add('time_adjust', { seconds: 0 });
    expect(errorsOf(replay(F, j.events, j.now()))).toEqual([
      'Поправка времени — целое число секунд, не ноль и не больше 3600 по модулю',
    ]);
  });

  it('продлевает окно ребаев на последнем уровне ребаев', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(5 * 40 - 2); // 5-й уровень, осталось 2 минуты
    let s = replay(F, j.events, j.now());
    expect(s.timer.levelIndex).toBe(4);
    j.adjust(60);
    s = replay(F, j.events, j.now() + 2.5 * MIN);
    expect(s.rebuysOpen).toBe(true);
    s = replay(F, j.events, j.now() + 3 * MIN);
    expect(s.rebuysOpen).toBe(false);
    expect(s.timer.levelIndex).toBe(5);
  });

  it('canApply совпадает с replay', () => {
    const j = journal().join('A', 'B');
    j.start();
    j.wait(39.5);
    const s = replay(F, j.events, j.now());
    expect(canApply(F, s, 'time_adjust', { seconds: -60 }, j.now())).toMatch(/^Убавить нельзя/);
    expect(canApply(F, s, 'time_adjust', { seconds: 60 }, j.now())).toBe(null);
  });
});
