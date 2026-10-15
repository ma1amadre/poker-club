import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT } from './format.ts';
import { computeMoney } from './money.ts';
import { canApply, canApplySequence, replay, replayLog } from './replay.ts';
import { DEFAULT_SCORING } from './scoring.ts';
import {
  SEAT_ERROR,
  drawButtonSeat,
  isTableSeat,
  nextButtonSeat,
  randomSeating,
  readButtonSeat,
  readSeat,
  seatHolder,
  seatsAfter,
  tablePositions,
  tableSeats,
} from './seats.ts';
import { summarize } from './summary.ts';
import { journal, MIN, prng, type Journal } from './test-utils.ts';
import {
  EVENT_TYPES,
  SEATING_EVENT_TYPES,
  TABLE_SEATS,
  type EveningEvent,
  type EveningState,
  type TournamentFormat,
} from './types.ts';

const F = DEFAULT_FORMAT;
const errorsOf = (s: EveningState) => s.errors.map((e) => e.message);
const state = (j: Journal, f: TournamentFormat = F) => replay(f, j.events, j.now());
const seatsOf = (s: EveningState) =>
  Object.fromEntries(s.joinOrder.map((id) => [id, s.players[id]?.seat ?? null]));
/** Позиции коротко: «место:игрок» или null. */
const short = (s: EveningState) => {
  const p = tablePositions(s);
  const at = (x: { seat: number; playerId: string } | null) =>
    x ? `${x.seat}:${x.playerId}` : null;
  return { d: at(p.dealer), sb: at(p.sb), bb: at(p.bb) };
};

describe('форма записей', () => {
  it('номер места — целое 1..10', () => {
    expect(TABLE_SEATS).toBe(10);
    expect([1, 5, 10].every(isTableSeat)).toBe(true);
    expect([0, 11, -1, 2.5, '3', null, undefined, NaN].some(isTableSeat)).toBe(false);
    expect(readSeat({ playerId: 'A', seat: 3 })).toEqual({ playerId: 'A', seat: 3 });
    expect(readSeat({ playerId: '', seat: 3 })).toBeNull();
    expect(readSeat({ playerId: 'A', seat: 11 })).toBeNull();
    expect(readSeat({ seat: 3 })).toBeNull();
    expect(readButtonSeat({ seat: 10 })).toBe(10);
    expect(readButtonSeat({ seat: 0 })).toBeNull();
    expect(readButtonSeat({})).toBeNull();
  });

  it('типы рассадки — в списке типов событий', () => {
    expect(SEATING_EVENT_TYPES.every((t) => EVENT_TYPES.includes(t))).toBe(true);
    expect(SEATING_EVENT_TYPES).toEqual(['seat', 'button']);
  });

  it('места по часовой после номера: после 10 — 1', () => {
    expect(seatsAfter(3)).toEqual([4, 5, 6, 7, 8, 9, 10, 1, 2]);
    expect(seatsAfter(10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(seatsAfter(1)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('рассадка', () => {
  it('до старта таймера: игроки садятся на номера, без места — null', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.seat('A', 1);
    j.seat('B', 4);
    j.seat('C', 7);
    const s = state(j);
    expect(s.errors).toEqual([]);
    expect(seatsOf(s)).toEqual({ A: 1, B: 4, C: 7, D: null });
    expect(s.timer.status).toBe('not_started');
    expect(s.buttonSeat).toBeNull();
    expect(tableSeats(s).filter((c) => c.playerId !== null)).toEqual([
      { seat: 1, playerId: 'A', alive: true },
      { seat: 4, playerId: 'B', alive: true },
      { seat: 7, playerId: 'C', alive: true },
    ]);
    expect(tableSeats(s)).toHaveLength(TABLE_SEATS);
    expect(tablePositions(s).unseatedAlive).toEqual(['D']);
  });

  it('неверная форма и игрок не из турнира — отказ, место не меняется', () => {
    const j = journal().join('A', 'B');
    j.add('seat', { playerId: 'A', seat: 0 });
    j.add('seat', { playerId: 'A', seat: 11 });
    j.add('seat', { playerId: 'A', seat: 2.5 });
    j.add('seat', { seat: 3 } as never);
    j.seat('Z', 3);
    const s = state(j);
    expect(errorsOf(s)).toEqual([
      SEAT_ERROR,
      SEAT_ERROR,
      SEAT_ERROR,
      'Не указан игрок',
      'Игрок не входил в турнир',
    ]);
    expect(SEAT_ERROR).toBe('Место — целое число от 1 до 10');
    expect(seatsOf(s)).toEqual({ A: null, B: null });
  });

  it('занятое место: другой игрок в игре — «Место занято»; то же место — отказ', () => {
    const j = journal().join('A', 'B');
    j.seat('A', 3);
    const taken = j.seat('B', 3);
    const same = j.seat('A', 3);
    const s = state(j);
    expect(s.errors).toEqual([
      { eventId: taken, message: 'Место занято' },
      { eventId: same, message: 'Игрок уже на этом месте' },
    ]);
    expect(seatsOf(s)).toEqual({ A: 3, B: null });
    expect(canApply(F, s, 'seat', { playerId: 'B', seat: 3 }, j.now())).toBe('Место занято');
    expect(canApply(F, s, 'seat', { playerId: 'B', seat: 4 }, j.now())).toBeNull();
  });

  it('пересадка живого на свободное место — та же запись, старое место освобождается', () => {
    const j = journal().join('A', 'B');
    j.seat('A', 3);
    j.seat('B', 5);
    j.seat('A', 9);
    j.seat('B', 3);
    const s = state(j);
    expect(s.errors).toEqual([]);
    expect(seatsOf(s)).toEqual({ A: 9, B: 3 });
    expect(seatHolder(s, 5)).toBeNull();
  });

  it('место вылетевшего: другой его занимает, вылетевший теряет место', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 1);
    j.seat('B', 2);
    j.seat('C', 3);
    j.start();
    j.wait(5).bust('A', ['B']);
    let s = state(j);
    // Вылетевший остаётся на месте приглушённым.
    expect(seatsOf(s)).toEqual({ A: 1, B: 2, C: 3 });
    expect(tableSeats(s)[0]).toEqual({ seat: 1, playerId: 'A', alive: false });
    j.seat('C', 1);
    s = state(j);
    expect(s.errors).toEqual([]);
    expect(seatsOf(s)).toEqual({ A: null, B: 2, C: 1 });
    // Вылетевший может сесть и сам (ребай вернёт его в игру на этом месте).
    j.seat('A', 3);
    s = state(j);
    expect(s.errors).toEqual([]);
    expect(seatsOf(s)).toEqual({ A: 3, B: 2, C: 1 });
  });

  it('ребай сохраняет место', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 2);
    j.seat('B', 5);
    j.seat('C', 8);
    j.button(8);
    j.start();
    j.wait(5).bust('A', ['B']);
    j.rebuy('A');
    const s = state(j);
    expect(s.errors).toEqual([]);
    expect(s.players.A).toMatchObject({ alive: true, rebuys: 1, seat: 2 });
    expect(short(s)).toEqual({ d: '8:C', sb: '2:A', bb: '5:B' });
  });

  it('после завершения рассадка и баттон не принимаются', () => {
    const j = journal().join('A', 'B');
    j.seat('A', 1);
    j.seat('B', 2);
    j.start();
    j.wait(5).bust('B', ['A']);
    j.finish();
    const seat = j.seat('A', 5);
    const button = j.button(1);
    const s = state(j);
    expect(s.errors).toEqual([
      { eventId: seat, message: 'Вечер уже завершён' },
      { eventId: button, message: 'Вечер уже завершён' },
    ]);
    expect(s.buttonSeat).toBeNull();
  });
});

describe('баттон', () => {
  it('ставится на место игрока в игре; пустое место и вылетевший — отказ', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 1);
    j.seat('B', 4);
    j.seat('C', 6);
    j.start();
    j.wait(5).bust('C', ['A']);
    const empty = j.button(2);
    const busted = j.button(6);
    const bad = j.add('button', { seat: 11 });
    const ok = j.button(4);
    const s = state(j);
    expect(s.errors).toEqual([
      { eventId: empty, message: 'Место пустое — баттон ставят на место игрока в игре' },
      {
        eventId: busted,
        message: 'Игрок на этом месте выбыл — баттон ставят на место игрока в игре',
      },
      { eventId: bad, message: SEAT_ERROR },
    ]);
    expect(ok).toBeGreaterThan(0);
    expect(s.buttonSeat).toBe(4);
  });

  it('можно до старта таймера; раздача без баттона баттон не задаёт', () => {
    const j = journal().join('A', 'B');
    j.seat('A', 1);
    j.seat('B', 2);
    expect(state(j).buttonSeat).toBeNull();
    j.start();
    j.hand();
    expect(state(j).buttonSeat).toBeNull();
    const k = journal().join('A', 'B');
    k.seat('A', 1);
    k.seat('B', 2);
    k.button(2);
    expect(state(k)).toMatchObject({ buttonSeat: 2, errors: [] });
  });

  it('раздача двигает баттон по часовой, пропуская пустые места и вылетевших', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.seat('A', 1);
    j.seat('B', 3);
    j.seat('C', 5);
    j.seat('D', 8);
    j.button(3);
    j.start();
    j.wait(5).bust('C', ['A']);
    expect(short(state(j))).toEqual({ d: '3:B', sb: '8:D', bb: '1:A' });
    j.hand(); // 3 → 8: место 5 — вылетевший, 4, 6, 7 — пусто
    expect(state(j).buttonSeat).toBe(8);
    expect(short(state(j))).toEqual({ d: '8:D', sb: '1:A', bb: '3:B' });
    j.hand(); // 8 → 1: после 10 — 1
    expect(state(j).buttonSeat).toBe(1);
    j.hand();
    expect(state(j).buttonSeat).toBe(3);
    expect(state(j).errors).toEqual([]);
  });

  it('переход 10 → 1', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 10);
    j.seat('B', 1);
    j.seat('C', 6);
    j.button(10);
    j.start();
    expect(short(state(j))).toEqual({ d: '10:A', sb: '1:B', bb: '6:C' });
    j.hand();
    expect(state(j).buttonSeat).toBe(1);
    expect(short(state(j))).toEqual({ d: '1:B', sb: '6:C', bb: '10:A' });
  });

  it('баттон — номер места: игрок пересел или вылетел — метка на номере до следующей раздачи', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.seat('A', 2);
    j.seat('B', 4);
    j.seat('C', 6);
    j.seat('D', 8);
    j.button(4);
    j.start();
    j.seat('B', 9); // игрок на баттоне пересел
    let s = state(j);
    expect(s.buttonSeat).toBe(4);
    // Место баттона пусто: дилера нет, SB — первый в игре после места 4.
    expect(short(s)).toEqual({ d: null, sb: '6:C', bb: '8:D' });
    j.hand();
    expect(state(j).buttonSeat).toBe(6);
    j.wait(5).bust('C', ['D']); // вылетел игрок на баттоне
    s = state(j);
    expect(s.buttonSeat).toBe(6);
    expect(short(s)).toEqual({ d: null, sb: '8:D', bb: '9:B' });
    j.hand();
    expect(state(j).buttonSeat).toBe(8);
  });

  it('другого игрока в игре на местах нет — баттон остаётся', () => {
    const j = journal().join('A', 'B');
    j.seat('A', 3);
    j.button(3);
    j.start();
    j.hand(); // B без места — баттону некуда идти
    expect(state(j).buttonSeat).toBe(3);
    expect(tablePositions(state(j))).toMatchObject({
      dealer: null,
      sb: null,
      bb: null,
      unseatedAlive: ['B'],
    });
  });

  it('уровень по раздачам считается, как раньше, и баттон идёт на каждой раздаче', () => {
    const f: TournamentFormat = {
      ...F,
      levels: [
        { sb: 25, bb: 50, trigger: { type: 'hands', count: 2 } },
        { sb: 50, bb: 100, trigger: { type: 'hands', count: 2 } },
      ],
    };
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 1);
    j.seat('B', 2);
    j.seat('C', 3);
    j.button(1);
    j.start();
    j.hand();
    j.hand();
    const s = state(j, f);
    expect(s.timer.levelIndex).toBe(1);
    expect(s.timer.handsInLevel).toBe(0);
    expect(s.buttonSeat).toBe(3);
  });
});

describe('позиции раздачи', () => {
  it('три и больше: D на баттоне, SB и BB — следующие в игре по часовой', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    j.seat('A', 2);
    j.seat('B', 5);
    j.seat('C', 7);
    j.seat('D', 9);
    j.button(7);
    const p = tablePositions(state(j));
    expect(p).toEqual({
      buttonSeat: 7,
      dealer: { seat: 7, playerId: 'C' },
      sb: { seat: 9, playerId: 'D' },
      bb: { seat: 2, playerId: 'A' },
      order: [
        { seat: 7, playerId: 'C' },
        { seat: 9, playerId: 'D' },
        { seat: 2, playerId: 'A' },
        { seat: 5, playerId: 'B' },
      ],
      unseatedAlive: [],
    });
  });

  it('хедз-ап: игрок на баттоне — дилер и SB, второй — BB; баттон чередуется', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 2);
    j.seat('B', 5);
    j.seat('C', 8);
    j.button(5);
    j.start();
    j.wait(5).bust('C', ['A']);
    let s = state(j);
    expect(short(s)).toEqual({ d: '5:B', sb: '5:B', bb: '2:A' });
    expect(tablePositions(s).order).toEqual([
      { seat: 5, playerId: 'B' },
      { seat: 2, playerId: 'A' },
    ]);
    j.hand();
    s = state(j);
    expect(s.buttonSeat).toBe(2);
    expect(short(s)).toEqual({ d: '2:A', sb: '2:A', bb: '5:B' });
  });

  it('хедз-ап, на месте баттона никого в игре: SB — первый после баттона, BB — второй', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 2);
    j.seat('B', 5);
    j.seat('C', 8);
    j.button(8);
    j.start();
    j.wait(5).bust('C', ['A']);
    const s = state(j);
    expect(s.buttonSeat).toBe(8);
    expect(short(s)).toEqual({ d: null, sb: '2:A', bb: '5:B' });
  });

  it('меньше двух в игре на местах или баттон не задан — позиций нет', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 1);
    j.seat('B', 2);
    let p = tablePositions(state(j));
    expect(p).toMatchObject({ buttonSeat: null, dealer: null, sb: null, bb: null });
    expect(p.order.map((x) => x.playerId)).toEqual(['A', 'B']);
    expect(p.unseatedAlive).toEqual(['C']);
    j.button(1);
    j.start();
    j.wait(5).bust('B', ['A']);
    p = tablePositions(state(j));
    expect(p).toMatchObject({ buttonSeat: 1, dealer: null, sb: null, bb: null });
    expect(p.unseatedAlive).toEqual(['C']);
  });

  it('опоздавший садится между баттоном и SB — сразу SB, на следующей раздаче баттон у него', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 1);
    j.seat('B', 4);
    j.seat('C', 7);
    j.button(1);
    j.start();
    expect(short(state(j))).toEqual({ d: '1:A', sb: '4:B', bb: '7:C' });
    j.wait(20).join('D');
    expect(tablePositions(state(j)).unseatedAlive).toEqual(['D']);
    j.seat('D', 2);
    let s = state(j);
    expect(s.errors).toEqual([]);
    expect(short(s)).toEqual({ d: '1:A', sb: '2:D', bb: '4:B' });
    expect(tablePositions(s).unseatedAlive).toEqual([]);
    j.hand();
    s = state(j);
    expect(s.buttonSeat).toBe(2);
    expect(short(s)).toEqual({ d: '2:D', sb: '4:B', bb: '7:C' });
  });

  it('nextButtonSeat — то же правило, что у раздачи', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 3);
    j.seat('B', 6);
    j.seat('C', 9);
    expect(nextButtonSeat(state(j))).toBeNull();
    j.button(9);
    expect(nextButtonSeat(state(j))).toBe(3);
    j.start();
    j.hand();
    expect(state(j).buttonSeat).toBe(3);
  });
});

describe('отмена записей — пересчёт replay', () => {
  it('отмена посадки и пересадки возвращает прежние места', () => {
    const j = journal().join('A', 'B');
    j.seat('A', 1);
    const move = j.seat('A', 6);
    const b = j.seat('B', 1);
    expect(seatsOf(state(j))).toEqual({ A: 6, B: 1 });
    j.voidEvent(move);
    // A снова на 1 — и посадка B на 1 уже не принята: место занято.
    let s = state(j);
    expect(seatsOf(s)).toEqual({ A: 1, B: null });
    expect(s.errors).toEqual([{ eventId: b, message: 'Место занято' }]);
    j.voidEvent(b);
    s = state(j);
    expect(s.errors).toEqual([]);
  });

  it('отмена вылета: игрок снова в игре, его место, занятое другим, — «Место занято»', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 1);
    j.seat('B', 2);
    j.start();
    const bust = j.wait(5).bust('A', ['B']);
    const take = j.seat('C', 1);
    expect(seatsOf(state(j))).toEqual({ A: null, B: 2, C: 1 });
    j.voidEvent(bust);
    const s = state(j);
    expect(s.errors).toEqual([{ eventId: take, message: 'Место занято' }]);
    expect(seatsOf(s)).toEqual({ A: 1, B: 2, C: null });
  });

  it('отмена раздачи возвращает баттон, отмена баттона снимает его', () => {
    const j = journal().join('A', 'B', 'C');
    j.seat('A', 1);
    j.seat('B', 2);
    j.seat('C', 3);
    const button = j.button(1);
    j.start();
    j.hand();
    const second = j.hand();
    expect(state(j).buttonSeat).toBe(3);
    j.voidEvent(second);
    expect(state(j).buttonSeat).toBe(2);
    j.voidEvent(button);
    expect(state(j).buttonSeat).toBeNull();
  });
});

describe('случай на клиенте: рассадка и розыгрыш баттона', () => {
  it('«Рассадить случайно»: всем в игре без места — разные пустые места, одним действием', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const j = journal().join('A', 'B', 'C', 'D', 'E');
      j.seat('B', 4);
      const s = state(j);
      const drafts = randomSeating(s, prng(seed));
      expect(drafts.map((d) => (d.payload as { playerId: string }).playerId)).toEqual([
        'A',
        'C',
        'D',
        'E',
      ]);
      const seats = drafts.map((d) => (d.payload as { seat: number }).seat);
      expect(new Set(seats).size).toBe(4);
      expect(seats.every((n) => isTableSeat(n) && n !== 4)).toBe(true);
      expect(drafts.every((d) => d.type === 'seat')).toBe(true);
      expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    }
  });

  it('пустые места кончились — места вылетевших; мест нет — оставшиеся без записи', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `P${i + 1}`);
    const j = journal().join(...ids);
    for (let n = 1; n <= 9; n += 1) j.seat(`P${n}`, n);
    j.start();
    j.wait(5).bust('P1', ['P2']);
    const s = state(j);
    const drafts = randomSeating(s, prng(7));
    // Свободно место 10, у вылетевшего — место 1; P10, P11, P12 без места.
    expect(drafts.map((d) => d.payload)).toEqual([
      { playerId: 'P10', seat: 10 },
      { playerId: 'P11', seat: 1 },
    ]);
    expect(canApplySequence(F, j.events, drafts, j.now())).toBeNull();
    const after = replay(
      F,
      [
        ...j.events,
        ...drafts.map((d, i) => ({
          id: 1000 + i,
          type: d.type,
          payload: d.payload,
          at: new Date(j.now()).toISOString(),
          voided: false,
        })),
      ],
      j.now(),
    );
    expect(tablePositions(after).unseatedAlive).toEqual(['P12']);
    expect(after.players.P1?.seat).toBeNull();
  });

  it('«Разыграть»: случайное место среди игроков в игре на местах', () => {
    const j = journal().join('A', 'B', 'C', 'D');
    expect(drawButtonSeat(state(j), prng(1))).toBeNull();
    j.seat('A', 2);
    j.seat('B', 5);
    j.seat('C', 9);
    j.start();
    j.wait(5).bust('B', ['A']);
    const seen = new Set<number | null>();
    for (let seed = 1; seed <= 40; seed += 1) seen.add(drawButtonSeat(state(j), prng(seed)));
    expect([...seen].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2, 9]);
    expect(canApply(F, state(j), 'button', { seat: 2 }, j.now())).toBeNull();
  });
});

describe('рассадка не меняет игру, деньги и итоги', () => {
  function evening(): { withSeats: EveningEvent[]; without: EveningEvent[] } {
    const j = journal().join('A', 'B', 'C', 'D');
    const ids: number[] = [];
    ids.push(j.seat('A', 1), j.seat('B', 3), j.seat('C', 5), j.seat('D', 8), j.button(3));
    j.start();
    j.wait(10).hand();
    j.hand();
    j.wait(5).bust('C', ['A']);
    ids.push(j.seat('A', 5));
    j.rebuy('C');
    ids.push(j.seat('C', 2));
    j.wait(30).hand();
    j.bust('D', ['B']);
    ids.push(j.button(2));
    j.wait(250).bust('C', ['A', 'B']);
    j.hand();
    j.bust('B', ['A']);
    j.finish();
    const without = j.events.map((e) => (ids.includes(e.id) ? { ...e, voided: true } : e));
    return { withSeats: j.events, without };
  }

  const strip = (s: EveningState) => ({
    ...s,
    buttonSeat: null,
    players: Object.fromEntries(
      Object.entries(s.players).map(([id, p]) => [id, { ...p, seat: null }]),
    ),
  });

  it('состояние то же, кроме мест и баттона; деньги и summarize те же', () => {
    const { withSeats, without } = evening();
    const lastMs = Date.parse(withSeats.at(-1)?.at ?? '') + 5 * MIN;
    const a = replayLog(F, withSeats, lastMs);
    const b = replayLog(F, without, lastMs);
    expect(a.state.errors).toEqual([]);
    expect(strip(a.state)).toEqual(b.state);
    expect(a.applied.filter((e) => !SEATING_EVENT_TYPES.includes(e.type))).toEqual(b.applied);
    expect(computeMoney(F, a.state)).toEqual(computeMoney(F, b.state));
    expect(summarize('e1', '2026-10-08', F, withSeats, DEFAULT_SCORING)).toEqual(
      summarize('e1', '2026-10-08', F, without, DEFAULT_SCORING),
    );
  });

  it('сгенерированные вечера: место держит один игрок, после раздачи баттон у игрока в игре', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rnd = prng(seed);
      const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, 2 + Math.floor(rnd() * 5));
      const j = journal().join(...ids);
      const seating: number[] = [];
      for (let step = 0; step < 45; step += 1) {
        const s = state(j);
        const alive = s.joinOrder.filter((id) => s.players[id]?.alive);
        const dead = s.joinOrder.filter((id) => !s.players[id]?.alive);
        const r = rnd();
        const anyone = ids[Math.floor(rnd() * ids.length)] as string;
        const seat = 1 + Math.floor(rnd() * TABLE_SEATS);
        if (s.timer.status === 'not_started' && r < 0.1) j.start();
        else if (r < 0.35) seating.push(j.seat(anyone, seat));
        else if (r < 0.45) seating.push(j.button(seat));
        else if (r < 0.7) {
          const handId = j.wait(1).hand();
          const after = state(j);
          if (!after.errors.some((e) => e.eventId === handId) && after.buttonSeat !== null) {
            const aliveSeated = tableSeats(after).filter((c) => c.playerId !== null && c.alive);
            if (aliveSeated.length > 0)
              expect(seatHolder(after, after.buttonSeat)?.alive).toBe(true);
          }
        } else if (r < 0.85 && alive.length > 1) {
          const victim = alive[Math.floor(rnd() * alive.length)] as string;
          j.wait(1).bust(victim, alive.filter((x) => x !== victim).slice(0, 1));
        } else if (dead.length > 0 && s.rebuysOpen) {
          j.rebuy(dead[Math.floor(rnd() * dead.length)] as string);
        } else if (rnd() < 0.2 && seating.length > 0) {
          j.voidEvent(seating[Math.floor(rnd() * seating.length)] as number);
        }
        const now = state(j);
        // Место держит один игрок, номер — 1..10.
        const taken = now.joinOrder.flatMap((id) => {
          const n = now.players[id]?.seat ?? null;
          return n === null ? [] : [n];
        });
        expect(new Set(taken).size).toBe(taken.length);
        expect(taken.every(isTableSeat)).toBe(true);
        expect(now.buttonSeat === null || isTableSeat(now.buttonSeat)).toBe(true);
        // Позиции: только игроки в игре на своих местах; в хедз-апе дилер — он же SB.
        const p = tablePositions(now);
        for (const x of [p.dealer, p.sb, p.bb]) {
          if (x)
            expect(seatHolder(now, x.seat)).toMatchObject({ playerId: x.playerId, alive: true });
        }
        if (p.sb && p.bb) expect(p.sb.seat).not.toBe(p.bb.seat);
        if (p.order.length === 2 && p.dealer) expect(p.sb).toEqual(p.dealer);
        if (p.order.length > 2 && p.dealer) expect(p.sb).not.toEqual(p.dealer);
        expect(new Set(p.order.map((x) => x.seat)).size).toBe(p.order.length);
        // Без записей рассадки — то же состояние игры.
        const without = j.events.map((e) =>
          SEATING_EVENT_TYPES.includes(e.type) ? { ...e, voided: true } : e,
        );
        const seatingIds = new Set(
          j.events.filter((e) => SEATING_EVENT_TYPES.includes(e.type)).map((e) => e.id),
        );
        expect({
          ...strip(now),
          errors: now.errors.filter((e) => !seatingIds.has(e.eventId)),
        }).toEqual(replay(F, without, j.now()));
      }
    }
  }, 60_000);
});
