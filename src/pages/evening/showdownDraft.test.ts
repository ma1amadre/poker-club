import { canApply, replay } from '@domain/replay.ts';
import { DEFAULT_FORMAT } from '@domain/format.ts';
import type { ShowdownState } from '@domain/types.ts';
import { journal } from '@domain/test-utils.ts';
import { describe, expect, it } from 'vitest';
import {
  cardIn,
  checkDraft,
  clearSlot,
  draftFromShowdown,
  emptyDraft,
  nextEmptySlot,
  placeCard,
  samePayload,
  sendLabel,
  setPlayers,
  slotOrder,
  successText,
  usedCards,
  type ShowdownDraft,
  type Slot,
} from './showdownDraft';

const SD = '5d000000-0000-4000-8000-000000000001';
const names: Record<string, string> = { A: 'Вова', B: 'Маша', C: 'Петя' };
const nameOf = (id: string) => names[id] ?? 'Игрок';

/** Ввод картами по порядку мест, как в шторке: касание — карта, место — следующее пустое. */
function tapAll(d: ShowdownDraft, codes: string[]): ShowdownDraft {
  let draft = d;
  let slot = nextEmptySlot(draft, null);
  for (const code of codes) {
    if (!slot) throw new Error('мест больше нет');
    draft = placeCard(draft, slot, code);
    slot = nextEmptySlot(draft, slot);
  }
  return draft;
}

function published(board: string[], hands: [string, string, string][]): ShowdownState {
  return {
    showdownId: SD,
    hands: hands.map(([playerId, a, b]) => ({ playerId, cards: [a, b] })),
    board,
    openedEventId: 1,
    eventId: 1,
    openedAt: '2026-10-08T17:00:00.000Z',
    updatedAt: '2026-10-08T17:00:00.000Z',
  };
}

describe('черновик олл-ина', () => {
  it('порядок мест: руки по очереди, затем флоп, тёрн, ривер', () => {
    const d = setPlayers(emptyDraft(SD), ['A', 'B']);
    const order = slotOrder(d).map((s) =>
      s.kind === 'hand' ? `${s.playerId}${s.index}` : `b${s.index}`,
    );
    expect(order).toEqual(['A0', 'A1', 'B0', 'B1', 'b0', 'b1', 'b2', 'b3', 'b4']);
  });

  it('четыре касания — руки двоих, дальше место флопа', () => {
    const d = tapAll(setPlayers(emptyDraft(SD), ['A', 'B']), ['As', 'Kd', 'Qh', 'Qc']);
    expect(checkDraft(d, nameOf)).toEqual({
      ok: true,
      payload: {
        showdownId: SD,
        hands: [
          { playerId: 'A', cards: ['As', 'Kd'] },
          { playerId: 'B', cards: ['Qh', 'Qc'] },
        ],
        board: [],
      },
    });
    expect(nextEmptySlot(d, null)).toEqual({ kind: 'board', index: 0 });
  });

  it('что не так с черновиком — словами, на «ты»', () => {
    let d = setPlayers(emptyDraft(SD), ['A']);
    expect(checkDraft(d, nameOf)).toEqual({ ok: false, reason: 'Выбери хотя бы двух игроков.' });
    d = tapAll(setPlayers(d, ['A', 'B', 'C']), ['As', 'Kd', 'Qh']);
    expect(checkDraft(d, nameOf)).toEqual({ ok: false, reason: 'Отметь карты: Маша и Петя.' });
    d = tapAll(d, ['Qc', '7s', '7h', '2c']);
    expect(checkDraft(d, nameOf)).toEqual({ ok: false, reason: 'Отметь все три карты флопа.' });
    d = placeCard(d, { kind: 'board', index: 3 }, '9d');
    expect(checkDraft(d, nameOf)).toEqual({
      ok: false,
      reason: 'Карты стола — по порядку: флоп, тёрн, ривер.',
    });
  });

  it('карта, уже лежащая в другом месте, переезжает; повторное касание снимает её', () => {
    let d = tapAll(setPlayers(emptyDraft(SD), ['A', 'B']), ['As', 'Kd', 'Qh', 'Qc']);
    const b1: Slot = { kind: 'hand', playerId: 'B', index: 1 };
    d = placeCard(d, b1, 'As');
    expect(cardIn(d, { kind: 'hand', playerId: 'A', index: 0 })).toBeNull();
    expect(cardIn(d, b1)).toBe('As');
    expect([...usedCards(d).keys()].sort()).toEqual(['As', 'Kd', 'Qh'].sort());
    d = clearSlot(d, b1);
    expect(cardIn(d, b1)).toBeNull();
  });

  it('убранный игрок освобождает свои карты; новый — в конец', () => {
    let d = tapAll(setPlayers(emptyDraft(SD), ['A', 'B']), ['As', 'Kd', 'Qh', 'Qc']);
    d = setPlayers(d, ['B', 'C']);
    expect(d.players).toEqual(['B', 'C']);
    expect(usedCards(d).has('As')).toBe(false);
    expect(d.hands.C).toEqual([null, null]);
  });

  it('раздача с табло → черновик → та же раздача', () => {
    const p = published(
      ['2c', '7d', '9h'],
      [
        ['A', 'As', 'Kd'],
        ['B', 'Qh', 'Qc'],
      ],
    );
    const d = draftFromShowdown(p);
    const check = checkDraft(d, nameOf);
    expect(check.ok && samePayload(check.payload, p)).toBe(true);
    expect(nextEmptySlot(d, null)).toEqual({ kind: 'board', index: 3 });
  });
});

describe('кнопка шторки и тост', () => {
  const hands: [string, string, string][] = [
    ['A', 'As', 'Kd'],
    ['B', 'Qh', 'Qc'],
  ];
  const payloadOf = (d: ShowdownDraft) => {
    const c = checkDraft(d, nameOf);
    if (!c.ok) throw new Error(c.reason);
    return c.payload;
  };

  it('по улицам: флоп, тёрн, ривер', () => {
    const pre = published([], hands);
    let d = draftFromShowdown(pre);
    expect(sendLabel(payloadOf(d), pre)).toBe('Открыть флоп'); // ничего не изменилось — кнопка ждёт флопа
    d = tapAll(d, ['2c', '7d', '9h']);
    expect(sendLabel(payloadOf(d), pre)).toBe('Открыть флоп');
    expect(successText(payloadOf(d), pre)).toBe('Флоп открыт');
    const flop = published(['2c', '7d', '9h'], hands);
    d = tapAll(draftFromShowdown(flop), ['Jd']);
    expect(sendLabel(payloadOf(d), flop)).toBe('Открыть тёрн');
    expect(successText(payloadOf(d), flop)).toBe('Тёрн открыт');
    const turn = published(['2c', '7d', '9h', 'Jd'], hands);
    d = tapAll(draftFromShowdown(turn), ['Ah']);
    expect(sendLabel(payloadOf(d), turn)).toBe('Открыть ривер');
    expect(successText(payloadOf(d), turn)).toBe('Ривер открыт');
  });

  it('правка карты — «Сохранить правку», первая отправка — «Показать на табло»', () => {
    const flop = published(['2c', '7d', '9h'], hands);
    const d = placeCard(draftFromShowdown(flop), { kind: 'hand', playerId: 'B', index: 1 }, 'Qd');
    expect(sendLabel(payloadOf(d), flop)).toBe('Сохранить правку');
    expect(successText(payloadOf(d), flop)).toBe('Правка записана');
    const fresh = tapAll(setPlayers(emptyDraft(SD), ['A', 'B']), ['As', 'Kd', 'Qh', 'Qc']);
    expect(sendLabel(payloadOf(fresh), null)).toBe('Показать на табло');
    expect(successText(payloadOf(fresh), null)).toBe('Руки показаны на табло');
  });

  it('то, что уходит из шторки, домен принимает', () => {
    const j = journal().join('A', 'B', 'C');
    j.start();
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    let d = tapAll(setPlayers(emptyDraft(SD), ['A', 'B', 'C']), [
      'As',
      'Kd',
      'Qh',
      'Qc',
      '7s',
      '7h',
    ]);
    expect(canApply(DEFAULT_FORMAT, s, 'showdown', payloadOf(d), j.now())).toBeNull();
    d = tapAll(d, ['2c', '7d', '9h', 'Jd', 'Ah']);
    expect(canApply(DEFAULT_FORMAT, s, 'showdown', payloadOf(d), j.now())).toBeNull();
  });
});
