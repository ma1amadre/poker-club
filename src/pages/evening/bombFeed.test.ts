// Бомб-пот в ленте и в вопросах перед отменой (миграция 030): взнос лента называет не раньше, чем его
// покажет табло (at + 9 с, решение 10); переброс — пометкой; отменённый бросок виден; «Кто забрал» —
// без суммы; отмена бомб-пота берёт с собой отметку «Кто забрал». Без табло (решение 10) лента не
// отсылает к табло и называет взнос, когда его показала полоса экрана; отмена сыгранного бомб-пота
// говорит про баттон, а не про переброс; отмена раздачи, закрывшей бомб-пот, снимает и его отметку.
import { BOMB_REVEAL_MS } from '@domain/bombPot.ts';
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replayLog } from '@domain/replay.ts';
import { journal, type Journal } from '@domain/test-utils.ts';
import type { EveningEvent } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import { feedWithBombReveal, PHONE_ROLL_LEAD_MS, rollPlan } from './bombPotView';
import {
  bombPotVoidText,
  bombResultsVoidedWith,
  bombRerollText,
  describeEvent,
  feedContext,
  feedEvents,
  lastUndoAction,
  rejectedTitle,
  voidConsequenceText,
  voidImpact,
} from './lib';

const F = DEFAULT_FORMAT;
const NAMES: Record<string, string> = { a: 'Петя', b: 'Лёня', c: 'Саша' };
const nameOf = (id: string) => NAMES[id] ?? id;
const rub = (n: number) => `${n} ₽`;
const sp = (text: string | null) => (text === null ? null : text.replace(/[  ]/g, ' '));

function game(): Journal {
  const j = journal();
  j.join('a', 'b', 'c');
  j.start();
  j.wait(1);
  return j;
}

function line(j: Journal, id: number, nowMs: number) {
  const log = replayLog(F, j.events, nowMs);
  const ctx = feedContext(j.events, log, nowMs);
  const ev = j.events.find((e) => e.id === id) as EveningEvent;
  const l = describeEvent(ev, nameOf, rub, F, ctx);
  return { title: sp(l.title), detail: sp(l.detail), kind: l.kind };
}

describe('лента: бомб-пот', () => {
  it('до at + 9 с — «кубик брошен — смотри на табло», после — взнос, банк, участники', () => {
    const j = game();
    const id = j.bombPot(3);
    expect(line(j, id, j.now() + 1000)).toEqual({
      title: 'Бомб-пот',
      detail: 'кубик брошен — смотри на табло',
      kind: 'bomb',
    });
    expect(line(j, id, j.now() + BOMB_REVEAL_MS)).toEqual({
      title: 'Бомб-пот: 3 BB',
      detail: 'по 30 · банк 90 · в игре 3',
      kind: 'bomb',
    });
  });

  it('без контекста ленты (тост, черновик) — взнос не называется', () => {
    const j = game();
    const id = j.bombPot(5);
    const ev = j.events.find((e) => e.id === id) as EveningEvent;
    expect(describeEvent(ev, nameOf, rub, F).title).toBe('Бомб-пот');
    const draft = { id: 0, type: 'bomb_pot' as const, payload: {}, at: '', voided: false };
    expect(describeEvent(draft, nameOf, rub, F).detail).toBeNull();
  });

  it('отменённый бросок виден в ленте; переброс — пометкой с отменённым', () => {
    const j = game();
    const first = j.bombPot(4);
    j.voidEvent(first);
    const second = j.bombPot(2, [4]);
    const later = j.now() + BOMB_REVEAL_MS;
    expect(line(j, first, later)).toMatchObject({ title: 'Бомб-пот: 4 BB', detail: null });
    expect(line(j, second, later)).toMatchObject({
      title: 'Бомб-пот: 2 BB',
      detail: 'по 20 · банк 60 · в игре 3 · переброс — отменён бросок 4 BB',
    });
    expect(line(j, second, j.now())).toMatchObject({
      title: 'Бомб-пот',
      detail: 'кубик брошен — смотри на табло · переброс — отменён бросок 4 BB',
    });
    expect(sp(bombRerollText([4, 2]))).toBe('переброс — отменены броски 4 BB и 2 BB');
    expect(bombRerollText([])).toBeNull();
  });

  it('«Кто забрал» — без суммы итога; делёж — «делят»', () => {
    const j = game();
    const id = j.bombPot(3);
    const r1 = j.bombPotResult(id, ['b']);
    expect(line(j, r1, j.now() + BOMB_REVEAL_MS)).toEqual({
      title: 'Бомб-пот забирает Лёня',
      detail: '3 BB — по 30',
      kind: 'bomb',
    });
    const k = game();
    const id2 = k.bombPot(1);
    const r2 = k.bombPotResult(id2, ['a', 'c']);
    expect(line(k, r2, k.now()).title).toBe('Бомб-пот делят Петя и Саша');
  });

  it('бомб-пот — в ленте у всех (не рассадка)', () => {
    const j = game();
    const id = j.bombPot(2);
    expect(feedEvents(j.events).some((e) => e.id === id)).toBe(true);
  });
});

describe('отмена бомб-пота', () => {
  it('вопрос перед отменой: табло покажет «отменён», повтор — переброс с пометкой', () => {
    expect(voidConsequenceText('bomb_pot', false)).toBe(
      'Табло покажет, что бомб-пот отменён, отменённый бросок останется в ленте. Объявишь снова в этой раздаче — кубик бросится заново, табло и лента пометят переброс.',
    );
    expect(voidConsequenceText('bomb_pot_result', false)).toBe(
      'Бомб-пот останется без отметки, кто забрал банк.',
    );
    expect(rejectedTitle('bomb_pot', 'В игре один')).toBe('Бомб-пот не принят: В игре один');
  });

  it('отмена бомб-пота берёт с собой «Кто забрал» — иначе отметка висела бы «не принято»', () => {
    const j = game();
    const id = j.bombPot(3);
    const result = j.bombPotResult(id, ['a']);
    const hand = j.hand();
    const withIt = bombResultsVoidedWith(j.events, [id]);
    expect(withIt.map((e) => e.id)).toEqual([result]);
    // Сама по себе отмена бомб-пота сделала бы отметку непринятой.
    const impact = voidImpact(F, j.events, [id], j.now());
    expect(impact.rejected.map((r) => r.event.id)).toContain(result);
    expect(bombResultsVoidedWith(j.events, [id, result]).map((e) => e.id)).toEqual([]);
    expect(bombResultsVoidedWith(j.events, [hand])).toEqual([]);
  });
});

describe('лента без табло (решение 10)', () => {
  function offline(j: Journal, id: number, nowMs: number, board: boolean | null, calm = false) {
    const log = replayLog(F, j.events, nowMs);
    const ctx = feedWithBombReveal(feedContext(j.events, log, nowMs), board, calm);
    const ev = j.events.find((e) => e.id === id) as EveningEvent;
    const l = describeEvent(ev, nameOf, rub, F, ctx);
    return { title: sp(l.title), detail: sp(l.detail) };
  }

  it('табло не на связи — «кубик брошен» без табло, взнос — когда кончился розыгрыш на телефоне', () => {
    const j = game();
    const id = j.bombPot(3);
    const at = j.now();
    const rolled = at + PHONE_ROLL_LEAD_MS + rollPlan(3).end;
    expect(rolled).toBeLessThan(at + BOMB_REVEAL_MS);
    expect(offline(j, id, at + 1000, false)).toEqual({ title: 'Бомб-пот', detail: 'кубик брошен' });
    expect(offline(j, id, rolled - 1, false).title).toBe('Бомб-пот');
    // Тот же миг, что у полосы: взнос назван раньше at + 9 с.
    expect(offline(j, id, rolled, false)).toEqual({
      title: 'Бомб-пот: 3 BB',
      detail: 'по 30 · банк 90 · в игре 3',
    });
    // Спокойный режим: розыгрыша нет — взнос сразу, как на полосе.
    expect(offline(j, id, at + 1, false, true).title).toBe('Бомб-пот: 3 BB');
  });

  it('табло на связи и неизвестно — как прежде: «смотри на табло» до at + 9 с', () => {
    const j = game();
    const id = j.bombPot(4);
    const at = j.now();
    for (const board of [true, null]) {
      expect(offline(j, id, at + BOMB_REVEAL_MS - 1, board)).toEqual({
        title: 'Бомб-пот',
        detail: 'кубик брошен — смотри на табло',
      });
      expect(offline(j, id, at + BOMB_REVEAL_MS, board).title).toBe('Бомб-пот: 4 BB');
    }
    const ctx = feedContext(j.events, replayLog(F, j.events, at), at);
    expect(feedWithBombReveal(ctx, null, false)).toBe(ctx);
  });
});

describe('отмена сыгранного бомб-пота и раздачи после него', () => {
  /** Четверо на местах 1, 3, 5, 8, баттон на 3; бомб-пот, «Кто забрал» и ещё три раздачи. */
  function played() {
    const j = journal();
    j.join('a', 'b', 'c', 'd');
    j.seat('a', 1);
    j.seat('b', 3);
    j.seat('c', 5);
    j.seat('d', 8);
    j.button(3);
    j.start();
    j.wait(1);
    const bp = j.bombPot(2);
    j.wait(1);
    const result = j.bombPotResult(bp, ['c']);
    const close = j.hand();
    j.wait(1).hand();
    j.wait(1).hand();
    j.wait(1).hand();
    return { j, bp, result, close };
  }

  it('сыгранный: баттон пересчитается для всех раздач после него — вопрос называет места', () => {
    const { j, bp, result } = played();
    const s = replayLog(F, j.events, j.now()).state;
    const ids = [bp, ...bombResultsVoidedWith(j.events, [bp], s.bombPots).map((e) => e.id)];
    expect(ids).toEqual([bp, result]);
    const impact = voidImpact(F, j.events, ids, j.now());
    expect(impact.buttonBefore).not.toBe(impact.buttonAfter);
    const text = bombPotVoidText(
      s.bombPots.find((b) => b.eventId === bp),
      impact.buttonBefore,
      impact.buttonAfter,
    );
    expect(text).toBe(
      `Отменённый бросок останется в ленте, табло отмену не покажет: бомб-пот уже сыгран. Раздача, которая его закрыла, станет обычной: баттон пересчитается для всех раздач после неё — сейчас место ${impact.buttonBefore}, после отмены — место ${impact.buttonAfter}. Фишку баттона на столе придётся переставить.`,
    );
    expect(text).not.toContain('переброс');
  });

  it('открытый — «ОТМЕНЁН» на табло и переброс; закрытый финишем — баттон не меняется', () => {
    const j = game();
    const bp = j.bombPot(2);
    const s = replayLog(F, j.events, j.now()).state;
    expect(bombPotVoidText(s.bombPots[0], null, null)).toBe(voidConsequenceText('bomb_pot', false));
    expect(bombPotVoidText(undefined, null, null)).toBe(voidConsequenceText('bomb_pot', false));
    j.wait(1).bust('b', ['a']);
    j.bust('c', ['a']);
    j.finish();
    const f = replayLog(F, j.events, j.now()).state;
    expect(f.bombPots.find((b) => b.eventId === bp)?.closed?.by).toBe('finish');
    expect(bombPotVoidText(f.bombPots[0], null, null)).toBe(
      'Отменённый бросок останется в ленте, табло отмену не покажет: бомб-пот уже сыгран. Баттон и блайнды не изменятся.',
    );
  });

  it('отмена раздачи, закрывшей бомб-пот, берёт с собой «Кто забрал» — ряд спросит заново', () => {
    const { j, result, close } = played();
    const s = replayLog(F, j.events, j.now()).state;
    expect(bombResultsVoidedWith(j.events, [close], s.bombPots).map((e) => e.id)).toEqual([result]);
    // Другие раздачи отметку не трогают.
    const other = j.events.filter((e) => e.type === 'hand' && e.id !== close).map((e) => e.id);
    expect(bombResultsVoidedWith(j.events, other, s.bombPots)).toEqual([]);
  });

  it('«Отменить последнее» после «Кто забрал» — отметка и раздача одним действием', () => {
    const j = game();
    const bp = j.bombPot(3);
    j.wait(1);
    const result = j.bombPotResult(bp, ['b']);
    const hand = j.hand();
    expect(lastUndoAction(j.events)).toEqual({
      main: j.events.find((e) => e.id === result),
      extra: [j.events.find((e) => e.id === hand)],
    });
    // Раздача отдельным действием (другое время) — только она.
    j.wait(1);
    const next = j.hand();
    expect(lastUndoAction(j.events)).toEqual({
      main: j.events.find((e) => e.id === next),
      extra: [],
    });
  });
});
