// Места за столом и баттон (миграция 028) — основа живого учёта стола.
//
// Почему так устроено:
// - Номера мест — номера на сукне 1..TABLE_SEATS, растут по часовой стрелке; раздача идёт по часовой:
//   баттон переходит к следующему большему номеру, после последнего — к 1. Позже на эти же номера
//   лягут зоны камеры, поэтому место — номер, а не «порядок игроков».
// - Место игрока держит replay (PlayerState.seat): запись 'seat' сажает или пересаживает, вылет и ребай
//   место не снимают (вылетевший сидит приглушённым), место вылетевшего можно отдать другому — тогда
//   вылетевший его теряет. Двух игроков на одном месте replay не допускает.
// - Баттон — номер места (EveningState.buttonSeat), а не игрок: пересел или вылетел игрок на баттоне —
//   метка остаётся на номере до следующей раздачи. Раздача ('hand') двигает баттон к ближайшему месту
//   по часовой, где сидит игрок в игре (не «мёртвый баттон»).
// - Позиции раздачи (D, SB, BB) — чистая функция состояния (tablePositions): их не хранят, их читают.
// - Случай (рассадка, розыгрыш баттона) — на клиенте: функции берут генератор random параметром, в
//   журнал ложатся обычные записи 'seat' и 'button'. Домен без Math.random и Date.now.
import type { EventDraft } from './replay.ts';
import { TABLE_SEATS, type EveningState, type PlayerId, type PlayerState } from './types.ts';

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/** Номер места годится: целое 1..TABLE_SEATS. */
export function isTableSeat(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= TABLE_SEATS;
}

/** Отказ номера места (тот же текст — у RPC, миграция 028). */
export const SEAT_ERROR = `Место — целое число от 1 до ${TABLE_SEATS}`;

/** Место из payload 'seat': игрок и номер; null — форма неверна. */
export function readSeat(payload: unknown): { playerId: PlayerId; seat: number } | null {
  const record = asRecord(payload);
  const { playerId, seat } = record;
  return typeof playerId === 'string' && playerId !== '' && isTableSeat(seat)
    ? { playerId, seat }
    : null;
}

/** Место баттона из payload 'button'; null — номер неверен. */
export function readButtonSeat(payload: unknown): number | null {
  const seat = asRecord(payload).seat;
  return isTableSeat(seat) ? seat : null;
}

/** Места по часовой после seat, не включая его: seat+1, …, TABLE_SEATS, 1, …, seat−1. */
export function seatsAfter(seat: number): number[] {
  return Array.from({ length: TABLE_SEATS - 1 }, (_, i) => ((seat + i) % TABLE_SEATS) + 1);
}

/** Кто держит место (в игре или вылетевший) или null — место пустое. */
export function seatHolder(state: EveningState, seat: number): PlayerState | null {
  for (const id of state.joinOrder) {
    const p = state.players[id];
    if (p?.seat === seat) return p;
  }
  return null;
}

/** Ячейка стола: номер места и кто на нём (null — пусто), в игре ли он. */
export interface TableSeat {
  seat: number;
  playerId: PlayerId | null;
  alive: boolean;
}

/** Все места стола по номерам 1..TABLE_SEATS: кто сидит и в игре ли (шторка «Рассадка», плитки). */
export function tableSeats(state: EveningState): TableSeat[] {
  return Array.from({ length: TABLE_SEATS }, (_, i) => {
    const holder = seatHolder(state, i + 1);
    return { seat: i + 1, playerId: holder?.playerId ?? null, alive: holder?.alive ?? false };
  });
}

/** Игрок на месте: номер места и кто. */
export interface SeatedPlayer {
  seat: number;
  playerId: PlayerId;
}

/** Игрок в игре на месте seat или null (пусто или вылетевший). */
function aliveAt(state: EveningState, seat: number): SeatedPlayer | null {
  const p = seatHolder(state, seat);
  return p?.alive ? { seat, playerId: p.playerId } : null;
}

/** Игроки в игре на местах по часовой после seat (не включая его). */
function aliveAfter(state: EveningState, seat: number): SeatedPlayer[] {
  return seatsAfter(seat).flatMap((n) => {
    const p = aliveAt(state, n);
    return p ? [p] : [];
  });
}

/**
 * Куда уйдёт баттон после раздачи: ближайшее место по часовой после buttonSeat, где сидит игрок в игре.
 * Другого такого места нет — баттон остаётся; баттон не задан — null. Это правило replay для 'hand'.
 */
export function nextButtonSeat(state: EveningState): number | null {
  const from = state.buttonSeat;
  if (from === null) return null;
  return aliveAfter(state, from)[0]?.seat ?? from;
}

/** Позиции раздачи: баттон, дилер, блайнды и кто в игре без места. */
export interface TablePositions {
  /** Номер места баттона (как в состоянии) или null. */
  buttonSeat: number | null;
  /** Игрок в игре на месте баттона; null — баттон не задан, место пустое или игрок на нём вылетел. */
  dealer: SeatedPlayer | null;
  /** Малый блайнд; в хедз-апе — игрок на баттоне. */
  sb: SeatedPlayer | null;
  /** Большой блайнд. */
  bb: SeatedPlayer | null;
  /**
   * Игроки в игре на местах по часовой, начиная с дилера (дилера нет — с малого блайнда); позиции не
   * определены — от места 1. Строка порядка на табло: «D Петя · SB Лёня · BB Саша · Ваня · …».
   */
  order: SeatedPlayer[];
  /** Игроки в игре без места (в порядке входа) — экраны предупреждают: в раздаче их не учесть. */
  unseatedAlive: PlayerId[];
}

/**
 * Позиции раздачи по состоянию вечера. Учитываются только игроки в игре на местах:
 * - 3 и больше: дилер — игрок на месте баттона, если он в игре (иначе null); SB — первый в игре после
 *   места баттона по часовой; BB — следующий в игре после SB;
 * - ровно 2 (хедз-ап): игрок на баттоне в игре — он дилер и SB, второй — BB; иначе SB — первый в игре
 *   после места баттона, BB — второй;
 * - меньше 2 или баттон не задан — дилер, SB и BB не определены (null).
 */
export function tablePositions(state: EveningState): TablePositions {
  const unseatedAlive = state.joinOrder.filter((id) => {
    const p = state.players[id];
    return p !== undefined && p.alive && p.seat === null;
  });
  const button = state.buttonSeat;
  const seated: SeatedPlayer[] = [];
  for (let n = 1; n <= TABLE_SEATS; n += 1) {
    const p = aliveAt(state, n);
    if (p) seated.push(p);
  }
  if (button === null || seated.length < 2) {
    return { buttonSeat: button, dealer: null, sb: null, bb: null, order: seated, unseatedAlive };
  }
  const dealer = aliveAt(state, button);
  const after = aliveAfter(state, button);
  const order = dealer ? [dealer, ...after] : after;
  if (seated.length === 2 && dealer) {
    return { buttonSeat: button, dealer, sb: dealer, bb: after[0] ?? null, order, unseatedAlive };
  }
  return {
    buttonSeat: button,
    dealer,
    sb: after[0] ?? null,
    bb: after[1] ?? null,
    order,
    unseatedAlive,
  };
}

/** Случайное число [0, 1) — генератор клиента (Math.random) или детерминированный в тестах. */
export type RandomSource = () => number;

function pick<T>(list: T[], random: RandomSource): T | undefined {
  if (list.length === 0) return undefined;
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)));
  return list.splice(i, 1)[0];
}

/**
 * «Рассадить случайно»: записи 'seat' для всех игроков в игре без места (в порядке входа) — каждому
 * случайное место из пустых; пустые кончились — из мест вылетевших (вылетевший место теряет). Мест не
 * хватает — оставшиеся без записи (экран предупреждает, unseatedAlive). Пишутся одним действием
 * (add_events); журнал не меняется, проверка — canApplySequence.
 */
export function randomSeating(state: EveningState, random: RandomSource): EventDraft[] {
  const cells = tableSeats(state);
  const empty = cells.filter((c) => c.playerId === null).map((c) => c.seat);
  const ofBusted = cells.filter((c) => c.playerId !== null && !c.alive).map((c) => c.seat);
  const drafts: EventDraft[] = [];
  for (const playerId of tablePositions(state).unseatedAlive) {
    const seat = pick(empty, random) ?? pick(ofBusted, random);
    if (seat === undefined) break;
    drafts.push({ type: 'seat', payload: { playerId, seat } });
  }
  return drafts;
}

/** «Разыграть» баттон: случайное место среди игроков в игре на местах; null — никто в игре не сидит. */
export function drawButtonSeat(state: EveningState, random: RandomSource): number | null {
  const seats = tableSeats(state)
    .filter((c) => c.playerId !== null && c.alive)
    .map((c) => c.seat);
  return pick(seats, random) ?? null;
}
