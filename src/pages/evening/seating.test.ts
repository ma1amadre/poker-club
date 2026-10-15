// Места и баттон на экранах (миграция 028): строка позиций, «Следующая раздача», шторка «Рассадка»,
// тосты и плитки «Режима стола». Кто где сидит и куда идёт баттон — домен (seats.test.ts); здесь —
// раскладка и тексты по его состоянию.
import { DEFAULT_FORMAT } from '@domain/format.ts';
import { replay, replayLog } from '@domain/replay.ts';
import { randomSeating, tablePositions } from '@domain/seats.ts';
import { journal, prng, type Journal } from '@domain/test-utils.ts';
import type { EveningEvent, TournamentFormat } from '@domain/types.ts';
import { describe, expect, it } from 'vitest';
import { retryIntent } from '../../shared/lib/retryKeys';
import {
  describeEvent,
  eventPlayerId,
  feedContext,
  feedEvents,
  feedRows,
  handsRowTitle,
  rejectedTitle,
  roleTag,
  seatingVoidedWith,
  voidConsequenceText,
  voidImpact,
} from './lib';
import { pultRiverSuggestion } from './riverBusts';
import {
  buttonToast,
  HAND_RIVER_HOLD,
  handButton,
  handToast,
  myPositionText,
  positionsText,
  randomSeatingToast,
  repeatButtonDraw,
  repeatSeating,
  seatCells,
  seatChoices,
  seatingStarted,
  seatTargets,
  seatToast,
  stateAfter,
  unseatedHint,
  unseatedPlayers,
} from './seating';
import { seatTiles } from './table';

const F = DEFAULT_FORMAT;
const NAMES: Record<string, string> = { a: 'Петя', b: 'Лёня', c: 'Саша', d: 'Ваня', e: 'Женя' };
const nameOf = (id: string) => NAMES[id] ?? id;
/** Неразрывные пробелы → обычные: ожидания читаются как текст. */
const sp = (text: string | null) => (text === null ? null : text.replace(/ /g, ' '));
const at = (j: Journal, format: TournamentFormat = F) => replay(format, j.events, j.now());

/** Петя на 3, Лёня на 5, Саша на 8, Ваня без места; таймер идёт. */
function table(): Journal {
  const j = journal();
  j.join('a', 'b', 'c', 'd');
  j.seat('a', 3);
  j.seat('b', 5);
  j.seat('c', 8);
  j.start();
  return j;
}

describe('рассадка начата и кто без места', () => {
  it('до первой записи места ряда «Без места» нет — без места все', () => {
    const j = journal();
    j.join('a', 'b');
    const s = at(j);
    expect(seatingStarted(s)).toBe(false);
    expect(unseatedPlayers(s)).toEqual([]);
    expect(unseatedHint(s, nameOf)).toBeNull();
  });

  it('с рассадкой — игроки в игре без места; вылетевший без места в ряд не попадает', () => {
    const j = table();
    j.add('join', { playerId: 'e' });
    j.wait(5).bust('e', ['a']);
    const s = at(j);
    expect(seatingStarted(s)).toBe(true);
    expect(unseatedPlayers(s)).toEqual(['d']);
    expect(sp(unseatedHint(s, nameOf))).toBe(
      'Без места: Ваня — в позициях раздачи не участвует, пока не сядет на место. Место выбирается в «Рассадке».',
    );
  });
});

describe('строка позиций', () => {
  it('3 и больше: баттон, SB и BB по часовой — у игроков и в тосте с блайндами', () => {
    const j = table();
    j.button(3);
    const p = tablePositions(at(j));
    expect(sp(positionsText(p, nameOf))).toBe('Баттон — Петя · SB — Лёня · BB — Саша');
    expect(sp(positionsText(p, nameOf, { sb: 25, bb: 50 }))).toBe(
      'Баттон — Петя · SB Лёня 25 · BB Саша 50',
    );
    expect(sp(positionsText(p, nameOf, { sb: 500, bb: 1000 }))).toBe(
      'Баттон — Петя · SB Лёня 500 · BB Саша 1 000',
    );
  });

  it('хедз-ап: баттон и SB — один игрок', () => {
    const j = journal();
    j.join('a', 'b');
    j.seat('a', 2);
    j.seat('b', 9);
    j.button(9);
    const p = tablePositions(at(j));
    expect(sp(positionsText(p, nameOf))).toBe('Баттон и SB — Лёня · BB — Петя');
    expect(sp(positionsText(p, nameOf, { sb: 25, bb: 50 }))).toBe(
      'Баттон и SB — Лёня 25 · BB Петя 50',
    );
    expect(myPositionText(p, 'b')).toBe('Ты на баттоне и SB');
    expect(myPositionText(p, 'a')).toBe('Ты на BB');
  });

  it('игрок на баттоне вылетел — до следующей раздачи «Баттон — место 3»', () => {
    const j = table();
    j.add('join', { playerId: 'e' });
    j.seat('e', 10);
    j.button(3);
    j.wait(5).bust('a', ['b']);
    const p = tablePositions(at(j));
    expect(sp(positionsText(p, nameOf))).toBe('Баттон — место 3 · SB — Лёня · BB — Саша');
    expect(myPositionText(p, 'a')).toBeNull();
  });

  it('позиций нет — строки нет: баттон не задан или на местах меньше двух', () => {
    const j = table();
    expect(positionsText(tablePositions(at(j)), nameOf)).toBeNull();
    const k = journal();
    k.join('a', 'b');
    k.seat('a', 1);
    k.button(1);
    expect(positionsText(tablePositions(at(k)), nameOf)).toBeNull();
  });

  it('своя позиция: баттон, SB, BB; не на позиции и без входа — null', () => {
    const j = table();
    j.button(3);
    const p = tablePositions(at(j));
    expect(myPositionText(p, 'a')).toBe('Ты на баттоне');
    expect(myPositionText(p, 'b')).toBe('Ты на SB');
    expect(myPositionText(p, 'c')).toBe('Ты на BB');
    expect(myPositionText(p, 'd')).toBeNull();
    expect(myPositionText(p, null)).toBeNull();
  });

  it('метка места: D, SB и BB с блайндом, хедз-ап — «D SB»', () => {
    const level = { sb: 25, bb: 1000 };
    expect(roleTag([], level)).toBeNull();
    expect(roleTag(['D'], level)).toBe('D');
    expect(sp(roleTag(['SB'], level))).toBe('SB 25');
    expect(sp(roleTag(['BB'], level))).toBe('BB 1 000');
    expect(sp(roleTag(['D', 'SB'], level))).toBe('D SB 25');
  });
});

describe('«Следующая раздача»', () => {
  it('видна при баттоне или уровне по раздачам; у уровня по раздачам — счётчик', () => {
    const j = table();
    expect(handButton(at(j))).toEqual({ show: false, label: 'Следующая раздача', hold: null });
    j.button(3);
    expect(handButton(at(j))).toEqual({ show: true, label: 'Следующая раздача', hold: null });

    const hands: TournamentFormat = {
      ...F,
      levels: [
        { sb: 25, bb: 50, trigger: { type: 'hands', count: 10 } },
        { sb: 50, bb: 100, trigger: { type: 'hands', count: 10 } },
      ],
    };
    const k = journal();
    k.join('a', 'b');
    k.start();
    k.hand();
    k.hand();
    k.hand();
    expect(sp(handButton(at(k, hands)).label)).toBe('Следующая раздача · 3 из 10');
    expect(handButton(at(k, hands)).show).toBe(true);
  });

  it('тост — позиции новой раздачи с блайндами; баттон пропускает вылетевших', () => {
    const j = table();
    j.seat('d', 6);
    j.button(3);
    j.wait(5).bust('b', ['a']);
    const before = at(j);
    const after = stateAfter(F, j.events, [{ type: 'hand', payload: {} }], j.now());
    expect(after.buttonSeat).toBe(6);
    const toast = handToast(before, after, nameOf);
    expect(sp(toast.title)).toBe('Баттон — Ваня · SB Саша 5 · BB Петя 10');
    expect(toast.detail).toBeNull();
  });

  it('раздача сменила уровень — блайнды нового уровня в тосте и второй строкой', () => {
    const hands: TournamentFormat = {
      ...F,
      levels: [
        { sb: 25, bb: 50, trigger: { type: 'hands', count: 2 } },
        { sb: 50, bb: 100, trigger: { type: 'hands', count: 2 } },
      ],
    };
    const j = table();
    j.button(3);
    j.hand();
    const before = at(j, hands);
    const after = stateAfter(hands, j.events, [{ type: 'hand', payload: {} }], j.now());
    expect(after.timer.levelIndex).toBe(1);
    const toast = handToast(before, after, nameOf);
    expect(sp(toast.title)).toBe('Баттон — Саша · SB Петя 50 · BB Лёня 100');
    expect(sp(toast.detail)).toBe('Уровень 2: блайнды 50/100');
  });

  it('без баттона — «Раздача записана»', () => {
    const j = table();
    const after = stateAfter(F, j.events, [{ type: 'hand', payload: {} }], j.now());
    expect(handToast(at(j), after, nameOf)).toEqual({ title: 'Раздача записана', detail: null });
  });

  it('ревью: пока висит вопрос после ривера — закрыта с подсказкой (раздача сняла бы вопрос)', () => {
    // Петя 3 (баттон), Лёня 5, Ваня 6, Саша 8. Олл-ин Лёни и Саши до ривера: у Саши тузы, у Лёни
    // короли — Лёня проигрывает, пульт спрашивает «Фишек хватило?».
    const riverHand = () => {
      const j = table();
      j.seat('d', 6);
      j.button(3);
      j.wait(10).showdown(
        '00000000-0000-4000-8000-0000000000aa',
        [
          ['b', 'Kd', 'Ks'],
          ['c', 'As', 'Ah'],
        ],
        ['2c', '7h', '9s', 'Jc', '3d'],
      );
      return j;
    };
    const pult = (k: Journal) => {
      const { state, applied } = replayLog(F, k.events, k.now());
      const isAlive = (id: string) => Boolean(state.players[id]?.alive);
      return pultRiverSuggestion(state.showdown, isAlive, applied, k.now());
    };
    const j = riverHand();
    expect(pult(j)?.victims).toEqual(['b']);
    expect(handButton(at(j), true)).toEqual({
      show: true,
      label: 'Следующая раздача',
      hold: HAND_RIVER_HOLD,
    });
    expect(HAND_RIVER_HOLD).toBe(
      'Сначала ответь, хватило ли фишек: вылет записывается до следующей раздачи — тогда баттон пропустит вылетевшего.',
    );
    // Без вопроса или без кнопки — подсказки нет.
    expect(handButton(at(j), false).hold).toBeNull();
    expect(handButton(at(table()), true)).toEqual({
      show: false,
      label: 'Следующая раздача',
      hold: null,
    });

    // Почему: раздача до ответа молча снимает вопрос, а вылет после неё оставляет баттон на месте
    // вылетевшего Лёни — дилера в раздаче нет.
    const early = riverHand();
    early.hand();
    expect(pult(early)).toBeNull();
    early.wait(1).bust('b', ['c']);
    expect(at(early).buttonSeat).toBe(5);
    expect(tablePositions(at(early)).dealer).toBeNull();
    // Ответ «Вылет» до раздачи — баттон пропускает Лёню и переходит к Ване.
    j.wait(1).bust('b', ['c']);
    j.hand();
    expect(at(j).buttonSeat).toBe(6);
    expect(tablePositions(at(j)).dealer).toEqual({ seat: 6, playerId: 'd' });
  });
});

describe('шторка «Рассадка»', () => {
  it('десять мест по номерам: кто сидит, в игре ли, позиции', () => {
    const j = table();
    j.button(3);
    j.wait(5).bust('c', ['a']);
    const cells = seatCells(at(j));
    expect(cells).toHaveLength(10);
    expect(cells.filter((c) => c.playerId !== null)).toEqual([
      { seat: 3, playerId: 'a', alive: true, roles: ['D', 'SB'] },
      { seat: 5, playerId: 'b', alive: true, roles: ['BB'] },
      { seat: 8, playerId: 'c', alive: false, roles: [] },
    ]);
  });

  it('кого посадить: сначала без места, затем пересадка по номерам; место игрока в игре — никого', () => {
    const j = table();
    j.add('join', { playerId: 'e' });
    const s = at(j);
    expect(seatChoices(s, 1)).toEqual([
      { playerId: 'd', from: null },
      { playerId: 'e', from: null },
      { playerId: 'a', from: 3 },
      { playerId: 'b', from: 5 },
      { playerId: 'c', from: 8 },
    ]);
    expect(seatChoices(s, 5)).toEqual([]);
  });

  it('место вылетевшего свободно для других; сам он в список не попадает', () => {
    const j = table();
    j.wait(5).bust('c', ['a']);
    expect(seatChoices(at(j), 8)).toEqual([
      { playerId: 'd', from: null },
      { playerId: 'a', from: 3 },
      { playerId: 'b', from: 5 },
    ]);
  });

  it('куда посадить: пустые и места вылетевших, не своё и не занятые игроками в игре', () => {
    const j = table();
    j.wait(5).bust('c', ['a']);
    const s = at(j);
    expect(seatTargets(F, s, 'a')).toEqual([1, 2, 4, 6, 7, 8, 9, 10]);
    expect(seatTargets(F, s, 'd')).toEqual([1, 2, 4, 6, 7, 8, 9, 10]);
  });

  it('тост места: посадка, пересадка, место вылетевшего', () => {
    const j = table();
    j.wait(5).bust('c', ['a']);
    const s = at(j);
    expect(seatToast(s, 'd', 1, nameOf)).toEqual({ title: 'Ваня — место 1', detail: null });
    expect(seatToast(s, 'a', 4, nameOf)).toEqual({
      title: 'Петя — место 4',
      detail: 'Было место 3.',
    });
    expect(seatToast(s, 'b', 8, nameOf)).toEqual({
      title: 'Лёня — место 8',
      detail: 'Было место 5. Саша вне игры — место 8 отдано.',
    });
  });

  it('тост баттона: место и игрок, блайнды раздачи с этим баттоном', () => {
    const j = table();
    const toast = buttonToast(at(j), 5, nameOf);
    expect(toast.title).toBe('Баттон — место 5 (Лёня)');
    expect(sp(toast.detail)).toBe('SB Саша 5 · BB Петя 10');
  });

  it('«Рассадить случайно»: кто куда по номерам мест; мест не хватило — кто остался', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    const s = at(j);
    let n = 0;
    const seq = [0.95, 0, 0.5];
    const drafts = randomSeating(s, () => seq[n++ % seq.length] ?? 0);
    const toast = randomSeatingToast(s, drafts, nameOf);
    expect(sp(toast.title)).toBe('Места разыграны: 3 игрока');
    expect(sp(toast.detail)).toBe('Лёня — 1, Саша — 6, Петя — 10');

    // Все 10 мест держат игроки в игре — одиннадцатому места нет.
    const full = journal();
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11'];
    full.join(...ids);
    ids.slice(0, 10).forEach((id, i) => full.seat(id, i + 1));
    const fs = at(full);
    expect(randomSeating(fs, () => 0)).toEqual([]);
    const none = randomSeatingToast(fs, [], nameOf);
    expect(sp(none.title)).toBe('Места разыграны: 0 игроков');
    expect(none.detail).toBe('Мест не хватило: p11.');
  });
});

describe('«Режим стола»: плитки по номерам мест', () => {
  it('рассадки нет — порядок посадки, номера нет', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    expect(seatTiles(at(j)).map((t) => [t.playerId, t.seat])).toEqual([
      ['a', null],
      ['b', null],
      ['c', null],
    ]);
  });

  it('рассадка есть — по номерам мест, без места — не на плитках, вылетевший на своём месте', () => {
    const j = table();
    j.seat('d', 1);
    j.add('join', { playerId: 'e' });
    j.button(5);
    j.wait(5).bust('a', ['b']);
    const tiles = seatTiles(at(j));
    expect(tiles.map((t) => [t.playerId, t.seat, t.alive, t.roles])).toEqual([
      ['d', 1, true, ['BB']],
      ['a', 3, false, []],
      ['b', 5, true, ['D']],
      ['c', 8, true, ['SB']],
    ]);
    expect(unseatedPlayers(at(j))).toEqual(['e']);
  });

  it('место вылетевшего отдали — он уходит с плиток (остаётся в ряду вылетевших)', () => {
    const j = table();
    j.wait(5).bust('c', ['a']);
    j.seat('d', 8);
    expect(seatTiles(at(j)).map((t) => [t.playerId, t.seat])).toEqual([
      ['a', 3],
      ['b', 5],
      ['d', 8],
    ]);
  });
});

describe('лента: места и баттон, раздачи подряд', () => {
  const rub = (n: number) => `${n} ₽`;

  it('«Саша — место 3», «Баттон — место 3 (Саша)»: игрок — на момент записи баттона', () => {
    const j = table();
    const b1 = j.button(3);
    // Петя пересаживается на 4, место 3 занимает Ваня: прежняя запись баттона — всё ещё Петя.
    j.seat('a', 4);
    const s2 = j.seat('d', 3);
    const b2 = j.button(3);
    const ctx = feedContext(j.events, replayLog(F, j.events, j.now()));
    const line = (id: number) =>
      describeEvent(j.events.find((e) => e.id === id) as EveningEvent, nameOf, rub, F, ctx);
    expect(line(b1)).toEqual({ kind: 'seat', title: 'Баттон — место 3 (Петя)', detail: null });
    expect(line(s2)).toEqual({ kind: 'seat', title: 'Ваня — место 3', detail: null });
    expect(line(b2).title).toBe('Баттон — место 3 (Ваня)');
  });

  it('баттон на пустом месте (не принят) — без имени; без контекста — без имени', () => {
    const j = table();
    const b = j.button(7);
    const ctx = feedContext(j.events, replayLog(F, j.events, j.now()));
    const ev = j.events.find((e) => e.id === b) as EveningEvent;
    expect(describeEvent(ev, nameOf, rub, F, ctx).title).toBe('Баттон — место 7');
    expect(describeEvent(ev, nameOf, rub, F).title).toBe('Баттон — место 7');
    expect(rejectedTitle('seat', 'Место занято')).toBe('Рассадка не принята: Место занято');
    expect(rejectedTitle('button', 'x')).toBe('Баттон не принят: x');
  });

  it('рассадка — только в журнале пульта; у игроков и в итогах её нет', () => {
    const j = table();
    j.button(3);
    j.hand();
    const all = feedEvents(j.events, { seating: true }).map((e) => e.type);
    const plain = feedEvents(j.events).map((e) => e.type);
    expect(all.filter((t) => t === 'seat' || t === 'button')).toHaveLength(4);
    expect(plain.some((t) => t === 'seat' || t === 'button')).toBe(false);
    expect(plain).toEqual(['hand', 'timer_start', 'join', 'join', 'join', 'join']);
  });

  it('раздачи подряд — одной строкой по последней; другая запись, отмена и «не принято» рвут серию', () => {
    const j = table();
    j.button(3);
    const h1 = j.hand();
    j.hand();
    const h3 = j.hand();
    const bust = j.wait(1).bust('d', ['a']);
    const h4 = j.hand();
    const h5 = j.hand();
    j.voidEvent(h5);
    const h6 = j.hand();
    const h7 = j.hand();
    const feed = feedEvents(j.events);
    const rows = feedRows(feed, new Set([h7]));
    expect(rows.slice(0, 5).map((r) => [r.event.id, r.hands])).toEqual([
      [h7, 1],
      [h6, 1],
      [h5, 1],
      [h4, 1],
      [bust, 0],
    ]);
    expect(rows[5]).toEqual({ event: feed.find((e) => e.id === h3), hands: 3 });
    expect(rows.some((r) => r.event.id === h1)).toBe(false);
    expect(handsRowTitle(1)).toBe('Раздача сыграна');
    expect(handsRowTitle(3).replace(/ /g, ' ')).toBe('3 раздачи сыграны');
    expect(handsRowTitle(7).replace(/ /g, ' ')).toBe('7 раздач сыграно');
    expect(handsRowTitle(21).replace(/ /g, ' ')).toBe('21 раздача сыграна');
  });

  it('вопрос перед отменой: что пересчитается у места, баттона и раздачи', () => {
    expect(voidConsequenceText('seat', false)).toBe(
      'Рассадка вернётся к прежней. На деньги и очки это не влияет.',
    );
    expect(voidConsequenceText('button', false)).toBe(
      'Баттон вернётся туда, где был до этой записи.',
    );
    expect(voidConsequenceText('hand', false)).toBe('Счёт раздач, уровень и баттон пересчитаются.');
    expect(voidConsequenceText('level_next', false)).toBe('Таймер и уровень пересчитаются.');
    expect(voidConsequenceText('finish', true)).toMatch(/останется завершённым/);
  });
});

describe('отмена входа берёт с собой рассадку (ревью 028)', () => {
  /** Неотменённые записи с игроком id — как refs слияния профилей (merge_report_body, 024). */
  const mentions = (events: readonly EveningEvent[], id: string) =>
    events.filter((e) => !e.voided && eventPlayerId(e) === id).map((e) => e.type);
  const idOf = (j: Journal, type: string, playerId: string) =>
    j.events.find((e) => e.type === type && eventPlayerId(e) === playerId)?.id as number;

  /** До старта: шестеро за столом, «Рассадить случайно», баттон — на месте Лёни. */
  function announced() {
    const j = journal();
    j.join('a', 'b', 'c', 'd', 'e', 'f');
    for (const d of randomSeating(at(j), prng(7))) j.add(d.type, d.payload);
    const button = j.button(at(j).players.b?.seat as number);
    return { j, seatB: idOf(j, 'seat', 'b'), button, joinB: idOf(j, 'join', 'b') };
  }

  it('«Убрать из-за стола» до старта: место игрока и баттон на нём — вместе с входом', () => {
    const { j, seatB, button, joinB } = announced();
    // Без них журнал перестал бы принимать обе записи, а ленты до старта нет — отменить их негде.
    const impact = voidImpact(F, j.events, [joinB], j.now());
    expect(impact.rejected.map((r) => r.event.id)).toEqual([seatB, button]);
    expect(seatingVoidedWith(F, j.events, [joinB], j.now()).map((e) => e.id)).toEqual([
      seatB,
      button,
    ]);
    // Отменили всё одним действием — непринятых нет, баттон снят, остальные на местах.
    for (const id of [joinB, seatB, button]) j.voidEvent(id);
    const s = at(j);
    expect(s.errors).toEqual([]);
    expect(s.buttonSeat).toBeNull();
    expect(tablePositions(s).unseatedAlive).toEqual([]);
    // Сел снова — без места (прежней записи нет), непринятых записей нет.
    j.add('join', { playerId: 'b' });
    const again = at(j);
    expect(again.errors).toEqual([]);
    expect(tablePositions(again).unseatedAlive).toEqual(['b']);
  });

  it('отмена входа гостя: в журнале не остаётся записей с ним — слиянию профилей нечему мешать', () => {
    const j = table();
    const joinG = j.add('join', { playerId: 'g' });
    const seatG = j.seat('g', 10);
    const seating = seatingVoidedWith(F, j.events, [joinG], j.now());
    expect(seating.map((e) => e.id)).toEqual([seatG]);
    for (const id of [joinG, ...seating.map((e) => e.id)]) j.voidEvent(id);
    expect(mentions(j.events, 'g')).toEqual([]);
    expect(at(j).errors).toEqual([]);
  });

  it('уже непринятая запись места того, чей вход отменяют, — тоже с ним', () => {
    const j = table();
    const joinG = j.add('join', { playerId: 'g' });
    // Место 3 держит Петя в игре — запись не принята ещё до отмены входа.
    const taken = j.seat('g', 3);
    expect(at(j).errors.map((e) => e.eventId)).toEqual([taken]);
    expect(seatingVoidedWith(F, j.events, [joinG], j.now()).map((e) => e.id)).toEqual([taken]);
  });

  it('отмена вылета: место вылетевшего уже отдали — запись того, кто сел, уходит с ней', () => {
    const j = table();
    const bust = j.wait(5).bust('c', ['a']);
    const took = j.seat('d', 8);
    expect(seatingVoidedWith(F, j.events, [bust], j.now()).map((e) => e.id)).toEqual([took]);
  });

  it('остальная рассадка не трогается: отмена раздачи, ребая, второго входа', () => {
    const j = table();
    j.button(3);
    const hand = j.hand();
    expect(seatingVoidedWith(F, j.events, [hand], j.now())).toEqual([]);
    const bust = j.wait(5).bust('b', ['a']);
    const rebuy = j.rebuy('b');
    expect(seatingVoidedWith(F, j.events, [rebuy], j.now())).toEqual([]);
    expect(seatingVoidedWith(F, j.events, [bust, rebuy], j.now())).toEqual([]);
    // Лишний второй вход Пети (не принят: уже в турнире) отменили — Петин вход остаётся, место тоже.
    const extra = j.add('join', { playerId: 'a' });
    expect(seatingVoidedWith(F, j.events, [extra], j.now())).toEqual([]);
  });
});

describe('повтор жребия после попытки без ответа (ревью 028)', () => {
  it('«Рассадить случайно»: тот же пакет — тот же ключ повтора, пока он годится', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    const pending = randomSeating(at(j), prng(1));
    // Новый жребий — другой payload и другой ключ повтора: дошедший без ответа пакет задвоился бы.
    const other = randomSeating(at(j), prng(2));
    expect(retryIntent('ev', 'batch', other)).not.toBe(retryIntent('ev', 'batch', pending));
    const again = repeatSeating(pending, F, j.events, j.now());
    expect(again).toEqual(pending);
    expect(retryIntent('ev', 'batch', again)).toBe(retryIntent('ev', 'batch', pending));
    expect(repeatSeating(null, F, j.events, j.now())).toBeNull();
    expect(repeatSeating([], F, j.events, j.now())).toBeNull();
  });

  it('пакет дошёл и виден в журнале — повторять нечего', () => {
    const j = journal();
    j.join('a', 'b', 'c');
    const pending = randomSeating(at(j), prng(1));
    for (const d of pending) j.add(d.type, d.payload);
    expect(repeatSeating(pending, F, j.events, j.now())).toBeNull();
  });

  it('пока ждали, кого-то посадили руками или место заняли — новый жребий', () => {
    const pending = [
      { type: 'seat' as const, payload: { playerId: 'a', seat: 1 } },
      { type: 'seat' as const, payload: { playerId: 'b', seat: 2 } },
    ];
    const j = journal();
    j.join('a', 'b', 'c');
    expect(repeatSeating(pending, F, j.events, j.now())).toEqual(pending);
    const moved = journal();
    moved.join('a', 'b', 'c');
    moved.seat('a', 7);
    expect(repeatSeating(pending, F, moved.events, moved.now())).toBeNull();
    const taken = journal();
    taken.join('a', 'b', 'c');
    taken.seat('c', 2);
    expect(repeatSeating(pending, F, taken.events, taken.now())).toBeNull();
  });

  it('«Разыграть баттон»: то же место, пока там игрок в игре', () => {
    const j = table();
    expect(repeatButtonDraw(5, F, at(j))).toBe(5);
    expect(repeatButtonDraw(null, F, at(j))).toBeNull();
    expect(repeatButtonDraw(7, F, at(j))).toBeNull();
    j.wait(5).bust('b', ['a']);
    expect(repeatButtonDraw(5, F, at(j))).toBeNull();
  });
});
