// Лента и часы для правки записи на месте, перерыва на N минут и ±1 мин (миграция 022).
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replay, replayLog } from '@domain/replay.ts';
import { journal, MIN } from '@domain/test-utils.ts';
import type { EveningEvent } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import {
  breakLine,
  breakView,
  describeEvent,
  feedContext,
  rejectedTitle,
  timeAdjustable,
} from './lib';

const F = DEFAULT_FORMAT;
const names: Record<string, string> = { a: 'Женя', b: 'Саша', c: 'Дима' };
const nameOf = (id: string) => names[id] ?? '?';
const rub = (n: number) => `${n} ₽`;

describe('лента: правка записи на месте', () => {
  const j = journal();
  const joinA = j.add('join', { playerId: 'a' });
  j.join('b', 'c');
  j.start();
  const bustC = j.wait(5).bust('c', ['a']);
  const amendBust = j.wait(1).amend(bustC, { by: ['a', 'b'] });
  const amendJoin = j.amend(joinA, { stacks: 2 });
  const ctx = feedContext(j.events, replayLog(F, j.events, j.now()));
  const line = (id: number) =>
    describeEvent(j.events.find((e) => e.id === id) as EveningEvent, nameOf, rub, F, ctx);

  it('исправленная запись — с правкой в силе и пометкой', () => {
    expect(line(bustC)).toEqual({
      kind: 'bust',
      title: 'Вылет: Дима',
      detail: 'выбивают Женя и Саша — нокаут каждому · исправлено',
    });
    expect(line(joinA)).toEqual({
      kind: 'entry',
      title: 'Вход: Женя',
      detail: 'вход на 1000 ₽ · исправлено',
    });
    // Без контекста — как записано (старый вызов не меняется).
    const raw = j.events.find((e) => e.id === bustC) as EveningEvent;
    expect(describeEvent(raw, nameOf, rub, F).detail).toBe('выбивает Женя');
  });

  it('сама правка — что стало и что было', () => {
    expect(line(amendBust)).toEqual({
      kind: 'bust',
      title: 'Правка вылета: Дима',
      detail: 'выбивают Женя и Саша — нокаут каждому · было: Женя',
    });
    expect(line(amendJoin)).toEqual({
      kind: 'entry',
      title: 'Правка входа: Женя',
      detail: '×2 — 1000 ₽ · было: ×1',
    });
  });

  it('повторная правка: «было» — значение в силе перед ней, а не исходное', () => {
    const k = journal();
    const join = k.add('join', { playerId: 'a' });
    k.join('b', 'c');
    k.start();
    const bust = k.wait(5).bust('c', ['a']);
    const j2 = k.wait(1).amend(join, { stacks: 2 });
    const j3 = k.amend(join, { stacks: 3 });
    const b1 = k.amend(bust, { by: ['b'] });
    const bad = k.amend(bust, { by: ['c'] }); // сам себя — не принята, в силе остаётся Саша
    const b2 = k.amend(bust, { by: ['a', 'b'] });
    const voided = k.amend(join, { stacks: 5 });
    k.voidEvent(voided);
    const j4 = k.amend(join, { stacks: 1 });
    const c = feedContext(k.events, replayLog(F, k.events, k.now()));
    const detail = (id: number) =>
      describeEvent(k.events.find((e) => e.id === id) as EveningEvent, nameOf, rub, F, c).detail;
    expect(detail(j2)).toBe('×2 — 1000 ₽ · было: ×1');
    expect(detail(j3)).toBe('×3 — 1500 ₽ · было: ×2');
    expect(detail(b1)).toBe('выбивает Саша · было: Женя');
    expect(detail(bad)).toBe('выбивает Дима · было: Саша');
    expect(detail(b2)).toBe('выбивают Женя и Саша — нокаут каждому · было: Саша');
    // Отменённая правка в силе не была: следующая считает «было» без неё.
    expect(detail(j4)).toBe('×1 — 500 ₽ · было: ×3');
  });

  it('отменённая правка: запись снова как была, без пометки', () => {
    const k = journal().join('a', 'b');
    k.start();
    const bust = k.wait(1).bust('b', ['a']);
    const amend = k.amend(bust, { by: [] });
    k.voidEvent(amend);
    const c = feedContext(k.events, replayLog(F, k.events, k.now()));
    const ev = k.events.find((e) => e.id === bust) as EveningEvent;
    expect(describeEvent(ev, nameOf, rub, F, c).detail).toBe('выбивает Женя');
    // Правка с выбившими «не указано» и исходной без выбивших.
    const m = journal().join('a', 'b');
    m.start();
    const b2 = m.wait(1).bust('b');
    const a2 = m.amend(b2, { by: ['a'] });
    const c2 = feedContext(m.events, replayLog(F, m.events, m.now()));
    expect(
      describeEvent(m.events.find((e) => e.id === a2) as EveningEvent, nameOf, rub, F, c2).detail,
    ).toBe('выбивает Женя · было: не указано');
  });

  it('поправка времени и пауза на N минут', () => {
    const ev = (type: EveningEvent['type'], payload: object) =>
      describeEvent(
        { id: 1, type, payload: payload as never, at: '2026-10-08T16:00:00Z', voided: false },
        nameOf,
        rub,
        F,
      ).title;
    expect(ev('time_adjust', { seconds: 60 })).toBe('Время уровня: +1 мин');
    expect(ev('time_adjust', { seconds: -90 })).toBe('Время уровня: −1 мин 30 с');
    expect(ev('time_adjust', { seconds: 30 })).toBe('Время уровня: +30 с');
    expect(ev('timer_pause', { minutes: 10 })).toBe('Перерыв 10 мин');
    expect(ev('timer_pause', {})).toBe('Пауза');
    expect(rejectedTitle('amend', 'Правка не подходит: x')).toBe(
      'Правка не принята: Правка не подходит: x',
    );
  });
});

describe('часы: перерыв на N минут и ±1 мин', () => {
  it('отсчёт «продолжаем через», по истечении — «пора продолжать»', () => {
    const j = journal().join('a', 'b');
    j.start();
    j.wait(5).pauseFor(10);
    const at = j.now();
    let s = replay(F, j.events, at + 2 * MIN + 48_500);
    const v = breakView(s, at + 2 * MIN + 48_500);
    expect(v).toEqual({ minutes: 10, leftMs: 7 * MIN + 11_500, due: false, countdown: '07:12' });
    expect(breakLine(v!)).toBe('продолжаем через 07:12');
    s = replay(F, j.events, at + 11 * MIN);
    const due = breakView(s, at + 11 * MIN);
    expect(due).toMatchObject({ leftMs: 0, due: true });
    expect(breakLine(due!)).toBe('пора продолжать');
    // Пауза без срока и идущий таймер — перерыва нет.
    j.resume();
    expect(breakView(replay(F, j.events, j.now()), j.now())).toBe(null);
    j.pause();
    expect(breakView(replay(F, j.events, j.now() + MIN), j.now() + MIN)).toBe(null);
  });

  it('кнопки ±1 мин — только у уровня по времени, не последнего, при запущенном таймере', () => {
    const j = journal().join('a', 'b');
    expect(timeAdjustable(replay(F, j.events, j.now()))).toBe(false);
    j.start();
    expect(timeAdjustable(replay(F, j.events, j.now()))).toBe(true);
    j.wait(1).pause();
    expect(timeAdjustable(replay(F, j.events, j.now()))).toBe(true);
    j.resume();
    const last = j.now() + (F.levels.length - 1) * 40 * MIN;
    expect(timeAdjustable(replay(F, j.events, last))).toBe(false);
  });
});
