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
  newShowdownDraft,
  nextEmptySlot,
  placeCard,
  placeCards,
  samePayload,
  sendLabel,
  setPlayers,
  showdownCandidates,
  slotOrder,
  successText,
  unplaceCards,
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

/** Что уйдёт в журнал из черновика (черновик обязан быть готов к отправке). */
function payloadOf(d: ShowdownDraft) {
  const c = checkDraft(d, nameOf);
  if (!c.ok) throw new Error(c.reason);
  return c.payload;
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
  it('новая раздача в хедз-апе вечера — оба игрока отмечены, первое место — карта первого', () => {
    const d = newShowdownDraft(SD, ['A', 'B']);
    expect(d.players).toEqual(['A', 'B']);
    expect(d.hands).toEqual({ A: [null, null], B: [null, null] });
    expect(nextEmptySlot(d, null)).toEqual({ kind: 'hand', playerId: 'A', index: 0 });
    // Четыре касания — и руки готовы к показу на табло.
    expect(payloadOf(tapAll(d, ['As', 'Kd', 'Qh', 'Qc'])).hands).toHaveLength(2);
  });

  it('новая раздача, в игре трое (или один) — состав пустой, его отмечает банкир', () => {
    expect(newShowdownDraft(SD, ['A', 'B', 'C']).players).toEqual([]);
    expect(newShowdownDraft(SD, ['A']).players).toEqual([]);
  });

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

describe('несколько карт подряд (голосовой ввод): placeCards / unplaceCards', () => {
  const twoHands = () => setPlayers(emptyDraft(SD), ['A', 'B']);
  const A0: Slot = { kind: 'hand', playerId: 'A', index: 0 };

  it('две руки и флоп одной фразой — как семь касаний', () => {
    const codes = ['As', 'Kh', 'Qd', 'Qc', '2s', '7h', '9d'];
    const r = placeCards(twoHands(), A0, codes);
    expect(r.draft).toEqual(tapAll(twoHands(), codes));
    expect(r.placed.map((p) => p.code)).toEqual(codes);
    expect(r.placed.every((p) => p.prev === null)).toBe(true);
    expect(r.taken).toEqual([]);
    expect(r.overflow).toEqual([]);
    expect(r.active).toEqual({ kind: 'board', index: 3 });
    expect(payloadOf(r.draft).board).toEqual(['2s', '7h', '9d']);
  });

  it('без подсвеченного места — с первого пустого', () => {
    const d = tapAll(twoHands(), ['As', 'Kh']);
    const r = placeCards(d, null, ['Qd']);
    expect(r.placed[0]?.slot).toEqual({ kind: 'hand', playerId: 'B', index: 0 });
  });

  it('карта лежит в другом месте — не перекладывается, и дальше не кладём: очередь мест неясна', () => {
    const d = tapAll(twoHands(), ['As', 'Kh']);
    const B0: Slot = { kind: 'hand', playerId: 'B', index: 0 };
    // Туз пик у Жени не прямо перед подсвеченным местом Саши (там король) — не повтор фразы.
    const r = placeCards(d, B0, ['As', 'Qd']);
    expect(r.taken).toEqual([{ code: 'As', slot: A0 }]);
    expect(r.held).toEqual(['Qd']);
    expect(r.placed).toEqual([]);
    expect(r.draft).toBe(d);
    expect(r.active).toEqual(B0);
    // Посреди фразы: до неё легло, после — нет.
    const mid = placeCards(d, B0, ['Qd', 'As', 'Kc']);
    expect(mid.placed.map((p) => p.code)).toEqual(['Qd']);
    expect(mid.taken).toEqual([{ code: 'As', slot: A0 }]);
    expect(mid.held).toEqual(['Kc']);
    expect(mid.active).toEqual({ kind: 'hand', playerId: 'B', index: 1 });
  });

  // Ревью 09.10.2026: туз пик на подсвеченном месте уходил в «Уже лежит», место не сдвигалось, и
  // следующая карта фразы его затирала.
  it('названная карта уже на подсвеченном месте — остаётся, следующая — дальше', () => {
    const d = tapAll(twoHands(), ['As', '2d']);
    const r = placeCards(d, A0, ['As', 'Kh']);
    expect(r.draft.hands.A).toEqual(['As', '2d']);
    expect(r.kept).toEqual([{ code: 'As', slot: A0 }]);
    expect(r.taken).toEqual([]);
    // Как обещает очередь «Женя (замена) → Саша → …»: следующая — в следующее пустое.
    expect(r.placed).toEqual([
      { slot: { kind: 'hand', playerId: 'B', index: 0 }, code: 'Kh', prev: null },
    ]);
    expect(r.active).toEqual({ kind: 'hand', playerId: 'B', index: 1 });
    expect(unplaceCards(r.draft, r.placed)).toEqual(d);
  });

  it('карта уже лежит на очередном месте фразы — остаётся, очередь идёт дальше', () => {
    const A1: Slot = { kind: 'hand', playerId: 'A', index: 1 };
    const d = placeCard(twoHands(), A1, 'Kh');
    const r = placeCards(d, A0, ['As', 'Kh', 'Qd']);
    expect(r.kept).toEqual([{ code: 'Kh', slot: A1 }]);
    expect(r.draft.hands).toEqual({ A: ['As', 'Kh'], B: ['Qd', null] });
  });

  it('повтор фразы, оборванной паузой: первые карты лежат подряд прямо перед подсвеченным местом', () => {
    const one = tapAll(twoHands(), ['8c']);
    const A1: Slot = { kind: 'hand', playerId: 'A', index: 1 };
    const r = placeCards(one, A1, ['8c', '3d']);
    expect(r.kept).toEqual([{ code: '8c', slot: A0 }]);
    expect(r.taken).toEqual([]);
    expect(r.draft.hands.A).toEqual(['8c', '3d']);
    const three = tapAll(twoHands(), ['As', 'Kh', 'Qd']);
    const B1: Slot = { kind: 'hand', playerId: 'B', index: 1 };
    const again = placeCards(three, B1, ['As', 'Kh', 'Qd', 'Qc']);
    expect(again.kept.map((k) => k.code)).toEqual(['As', 'Kh', 'Qd']);
    expect(again.placed).toEqual([{ slot: B1, code: 'Qc', prev: null }]);
    // Не подряд перед подсвеченным (место перед флопом пустое) — не повтор, дальше не кладём.
    const flop: Slot = { kind: 'board', index: 0 };
    const gap = placeCards(tapAll(twoHands(), ['As', 'Kh']), flop, ['Kh', '2s']);
    expect(gap.taken).toEqual([{ code: 'Kh', slot: A1 }]);
    expect(gap.held).toEqual(['2s']);
    expect(gap.placed).toEqual([]);
  });

  it('подсвечена занятая карта — первая названная заменяет её, как касание; дальше — пустые', () => {
    const d = tapAll(twoHands(), ['As', 'Kh']);
    const r = placeCards(d, A0, ['Ad', 'Qd']);
    expect(cardIn(r.draft, A0)).toBe('Ad');
    expect(r.placed).toEqual([
      { slot: A0, code: 'Ad', prev: 'As' },
      { slot: { kind: 'hand', playerId: 'B', index: 0 }, code: 'Qd', prev: null },
    ]);
    // «Отменить» возвращает и замену.
    expect(unplaceCards(r.draft, r.placed)).toEqual(d);
  });

  it('мест не хватило — лишние в overflow, подсвеченного места нет', () => {
    const d = tapAll(twoHands(), ['As', 'Kh', 'Qd', 'Qc', '2s', '7h', '9d', 'Tc']);
    const r = placeCards(d, nextEmptySlot(d, null), ['3h', '4h']);
    expect(r.placed.map((p) => p.code)).toEqual(['3h']);
    expect(r.overflow).toEqual(['4h']);
    expect(r.active).toBeNull();
  });

  it('ничего не легло — подсвеченное место прежнее', () => {
    const d = tapAll(twoHands(), ['As']);
    const active = nextEmptySlot(d, null);
    expect(placeCards(d, active, ['As']).active).toEqual(active);
    expect(placeCards(d, active, []).draft).toBe(d);
  });

  it('«Отменить» снимает именно эти карты: поправленную касанием и чужие не трогает', () => {
    const before = tapAll(twoHands(), ['As', 'Kh']);
    const r = placeCards(before, nextEmptySlot(before, null), ['Qd', 'Qc', '2s']);
    // Банкир поправил одну из голосовых карт касанием и добавил свою.
    let d = placeCard(r.draft, { kind: 'hand', playerId: 'B', index: 1 }, 'Jc');
    d = placeCard(d, { kind: 'board', index: 1 }, '8h');
    const undone = unplaceCards(d, r.placed);
    expect(cardIn(undone, { kind: 'hand', playerId: 'B', index: 0 })).toBeNull();
    expect(cardIn(undone, { kind: 'hand', playerId: 'B', index: 1 })).toBe('Jc');
    expect(cardIn(undone, { kind: 'board', index: 0 })).toBeNull();
    expect(cardIn(undone, { kind: 'board', index: 1 })).toBe('8h');
    expect(cardIn(undone, A0)).toBe('As');
  });

  it('«Отменить» после смены состава: места убранного игрока нет — пропускается', () => {
    const r = placeCards(twoHands(), A0, ['As', 'Kh', 'Qd']);
    const d = setPlayers(r.draft, ['A', 'C']);
    const undone = unplaceCards(d, r.placed);
    expect(undone.hands).toEqual({ A: [null, null], C: [null, null] });
  });

  it('замена, а прежнюю карту уже положили в другое место, — место остаётся пустым', () => {
    const d = tapAll(twoHands(), ['As', 'Kh']);
    const r = placeCards(d, A0, ['Ad']);
    const moved = placeCard(r.draft, { kind: 'hand', playerId: 'B', index: 0 }, 'As');
    const undone = unplaceCards(moved, r.placed);
    expect(cardIn(undone, A0)).toBeNull();
    expect(cardIn(undone, { kind: 'hand', playerId: 'B', index: 0 })).toBe('As');
  });
});

describe('кто в списке «Кто вскрывается»', () => {
  const order = ['A', 'B', 'C', 'D'];
  const flopAB = published(
    ['2c', '7d', '9h'],
    [
      ['A', 'As', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ],
  );

  it('новая раздача — только те, кто в игре', () => {
    const alive = (id: string) => id !== 'C';
    expect(showdownCandidates(order, alive, emptyDraft(SD), null)).toEqual(['A', 'B', 'D']);
  });

  it('вылетевший участник раздачи на табло остаётся в списке и после снятой галочки', () => {
    // Олл-ин A против B, B вылетел; банкир правит состав и по ошибке снимает B.
    const alive = (id: string) => id !== 'B';
    const draft = setPlayers(draftFromShowdown(flopAB), ['A']);
    expect(draft.players).toEqual(['A']);
    const list = showdownCandidates(order, alive, draft, flopAB);
    expect(list).toEqual(['A', 'B', 'C', 'D']);
    // Вернуть B — его карты с табло на месте, домен такую раздачу примет: B был в ней до вылета.
    const back = setPlayers(draft, ['A', 'B'], flopAB);
    expect(back.hands.B).toEqual(['Qh', 'Qc']);
    expect(samePayload(payloadOf(back), flopAB)).toBe(true);
    const j = journal().join('A', 'B', 'C', 'D');
    j.start();
    j.showdown(SD, [
      ['A', 'As', 'Kd'],
      ['B', 'Qh', 'Qc'],
    ]);
    j.bust('B', ['A']);
    const s = replay(DEFAULT_FORMAT, j.events, j.now());
    expect(canApply(DEFAULT_FORMAT, s, 'showdown', payloadOf(back), j.now())).toBeNull();
  });

  it('возвращённый участник — на своё место; занятые его карты не возвращаются', () => {
    const three = published(
      ['2c', '7d', '9h'],
      [
        ['A', 'As', 'Kd'],
        ['B', 'Qh', 'Qc'],
        ['C', '7s', '7h'],
      ],
    );
    let d = setPlayers(draftFromShowdown(three), ['A', 'C']);
    // Пока B снят, его даму червей отдали C.
    d = placeCard(d, { kind: 'hand', playerId: 'C', index: 1 }, 'Qh');
    d = setPlayers(d, ['A', 'C', 'B', 'D'], three);
    expect(d.players).toEqual(['A', 'B', 'C', 'D']);
    expect(d.hands.B).toEqual([null, null]);
    expect(d.hands.D).toEqual([null, null]);
    // Без раздачи на табло — как раньше: новые в конец, карты пустые.
    expect(setPlayers(emptyDraft(SD), ['B', 'A'], null).players).toEqual(['B', 'A']);
  });

  it('вылетевший не из этой раздачи в список не попадает', () => {
    const alive = (id: string) => id !== 'C';
    expect(showdownCandidates(order, alive, draftFromShowdown(flopAB), flopAB)).toEqual([
      'A',
      'B',
      'D',
    ]);
  });
});

describe('кнопка шторки и тост', () => {
  const hands: [string, string, string][] = [
    ['A', 'As', 'Kd'],
    ['B', 'Qh', 'Qc'],
  ];

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
