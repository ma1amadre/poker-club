// Деньги вечера: кто сколько внёс, выиграл и сколько осталось перевести через банкира.
// Весь взнос входа и ребая идёт в призовой фонд; денег «за голову» нет (баунти убрано
// 07.10.2026 — нокауты остаются статистикой: очки, ачивки, звания, рекорды).
// Инвариант (проверяется тестами): после finish сумма призовых по всем игрокам ровно равна
// сумме взносов — деньги не появляются и не исчезают ни на рубль.
//
// Вход и ребай бывают кратными стандартному (stacks = k в payload): вход ×k — это k стандартных
// входов сразу (взнос и фишки ×k), поэтому все суммы линейны по сумме кратностей.
import { readPayment } from './replay.ts';
import type { EveningEvent, EveningState, PlayerId, TournamentFormat } from './types.ts';

export interface EntryAmounts {
  stacks: number; // кратность k
  rub: number; // взнос: buyInRub·k — весь в призовой фонд
  chips: number; // фишки: startingChips·k
}

/** Во что обходится вход или ребай кратности `stacks` — для пульта банкира и подписей ленты. */
export function entryAmounts(format: TournamentFormat, stacks = 1): EntryAmounts {
  return {
    stacks,
    rub: format.buyInRub * stacks,
    chips: format.startingChips * stacks,
  };
}

export interface MoneyRow {
  owesRub: number; // взносы: сумма кратностей входа и ребаев × buyIn
  prizeRub: number; // призовые за место
  netRub: number; // prize − owes
}

export type MoneyTable = Record<PlayerId, MoneyRow>;

export interface Payment {
  playerId: PlayerId;
  amountRub: number; // + игрок→банкир, − банкир→игрок
}

export type SettlementStatus = 'owes' | 'awaits' | 'settled';

export interface SettlementRow {
  dueRub: number; // > 0 — игрок должен банкиру, < 0 — банкир должен игроку
  paidRub: number;
  remainingRub: number;
  status: SettlementStatus;
}

export type SettlementTable = Record<PlayerId, SettlementRow>;

/**
 * Призовые по местам. Доли берутся для первых min(nPlayers, payoutPct.length) мест и
 * перенормируются до 100% (при 1 игроке — всё ему). Каждое место — вниз до рубля,
 * остаток от округления — 1-му месту, чтобы сумма выплат точно равнялась фонду.
 */
export function payouts(
  prizePoolRub: number,
  payoutPct: readonly number[],
  nPlayers: number,
): number[] {
  const k = Math.min(Math.max(nPlayers, 0), payoutPct.length);
  if (k === 0) return [];
  const pcts = payoutPct.slice(0, k);
  const sumPct = pcts.reduce((a, b) => a + b, 0);
  if (sumPct <= 0) return pcts.map((_, i) => (i === 0 ? prizePoolRub : 0));
  // +1e-9: дробные доли (33.3) дают 332.99999… вместо 333 — не теряем рубль на двоичной арифметике.
  // Переплаты быть не может: сумма floor(x_i + eps) ≤ фонд, пока k·eps < 1.
  const result = pcts.map((p) => Math.floor((prizePoolRub * p) / sumPct + 1e-9));
  const rest = prizePoolRub - result.reduce((a, b) => a + b, 0);
  result[0] = (result[0] ?? 0) + rest;
  return result;
}

/**
 * Денежная таблица вечера. Призовые — только после finish: до этого места не окончательны.
 * Нокауты на деньги не влияют.
 */
export function computeMoney(format: TournamentFormat, state: EveningState): MoneyTable {
  const table: MoneyTable = {};
  const prizes = state.finished
    ? payouts(state.prizePoolRub, format.payoutPct, state.joinOrder.length)
    : [];

  for (const id of state.joinOrder) {
    const p = state.players[id];
    if (!p) continue;
    const owesRub = p.stacks * format.buyInRub;
    const prizeRub = p.place !== null && state.finished ? (prizes[p.place - 1] ?? 0) : 0;
    table[id] = { owesRub, prizeRub, netRub: prizeRub - owesRub };
  }
  return table;
}

/** Платежи из журнала: не voided, корректные payload. Те же правила, что у replay. */
export function paymentsFromEvents(events: readonly EveningEvent[]): Payment[] {
  const list: Payment[] = [];
  for (const ev of [...events].sort((a, b) => a.id - b.id)) {
    if (ev.voided || ev.type !== 'payment') continue;
    const p = readPayment(ev.payload);
    if (p) list.push(p);
  }
  return list;
}

function statusOf(remainingRub: number): SettlementStatus {
  if (remainingRub > 0) return 'owes';
  if (remainingRub < 0) return 'awaits';
  return 'settled';
}

/**
 * Расчёт с банкиром. Платёж игрока, которого нет в таблице (ошибка ввода), не теряется:
 * у него появляется строка с dueRub = 0 и отрицательным остатком — банкир увидит, что должен вернуть.
 */
export function settlement(money: MoneyTable, payments: readonly Payment[]): SettlementTable {
  const paid = new Map<PlayerId, number>();
  for (const pay of payments) paid.set(pay.playerId, (paid.get(pay.playerId) ?? 0) + pay.amountRub);

  const ids = [...Object.keys(money), ...[...paid.keys()].filter((id) => !(id in money))];
  const table: SettlementTable = {};
  for (const id of ids) {
    const m = money[id];
    const dueRub = m ? m.owesRub - m.prizeRub : 0;
    const paidRub = paid.get(id) ?? 0;
    const remainingRub = dueRub - paidRub;
    table[id] = { dueRub, paidRub, remainingRub, status: statusOf(remainingRub) };
  }
  return table;
}

/** Расчёт закрыт: у каждого остаток 0. */
export function isSettled(table: SettlementTable): boolean {
  return Object.values(table).every((r) => r.status === 'settled');
}
