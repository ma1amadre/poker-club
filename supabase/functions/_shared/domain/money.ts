// Деньги вечера: кто сколько внёс, выиграл и сколько осталось перевести через банкира.
// Инвариант (проверяется тестами): после finish сумма prize + bounty по всем игрокам
// ровно равна сумме owes — деньги не появляются и не исчезают ни на рубль.
import { readPayment } from './replay.ts';
import type { EveningEvent, EveningState, PlayerId, TournamentFormat } from './types.ts';

export interface MoneyRow {
  owesRub: number; // взносы: (вход + ребаи) × buyIn
  prizeRub: number; // призовые за место
  bountyRub: number; // головы; у победителя ещё своя голова и сиротские
  netRub: number; // prize + bounty − owes
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
 * Денежная таблица вечера. Призы и «свою голову + сиротские» победитель получает только
 * после finish: до этого места не окончательны.
 */
export function computeMoney(format: TournamentFormat, state: EveningState): MoneyTable {
  const table: MoneyTable = {};
  const prizes = state.finished
    ? payouts(state.prizePoolRub, format.payoutPct, state.joinOrder.length)
    : [];
  // Нераспределённые головы = своя голова победителя + сиротские (bust с пустым by).
  // Считаем как разность, а не перечислением — так инвариант держится по построению.
  const distributed = state.joinOrder.reduce(
    (s, id) => s + (state.players[id]?.bountyWonRub ?? 0),
    0,
  );
  const undistributed = state.totalEntries * format.bountyRub - distributed;
  const winner = state.finished ? state.places[0] : undefined;

  for (const id of state.joinOrder) {
    const p = state.players[id];
    if (!p) continue;
    const owesRub = p.entries * format.buyInRub;
    const prizeRub = p.place !== null && state.finished ? (prizes[p.place - 1] ?? 0) : 0;
    const bountyRub = p.bountyWonRub + (id === winner ? undistributed : 0);
    table[id] = { owesRub, prizeRub, bountyRub, netRub: prizeRub + bountyRub - owesRub };
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
    const dueRub = m ? m.owesRub - m.prizeRub - m.bountyRub : 0;
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
