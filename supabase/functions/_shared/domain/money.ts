// Деньги вечера: кто сколько внёс, выиграл и сколько осталось перевести через банкира.
// Весь взнос входа и ребая идёт в призовой фонд; денег «за голову» нет (баунти убрано
// 07.10.2026 — нокауты остаются статистикой: очки, ачивки, звания, рекорды).
// Инвариант (проверяется тестами): после finish сумма призовых по всем игрокам ровно равна
// сумме взносов — деньги не появляются и не исчезают ни на рубль.
//
// Вход и ребай — любой суммой (миграция 027): сумма лежит в самой записи (rub), фишки — по курсу
// формата (chipsForRub). Записи без суммы (все до 027) — кратность × вход формата, как раньше.
// Призовые — вниз до шага формата (payoutStepRub, 027), остаток — 1-му месту; без шага — до рубля.
import { chipsForRub, readPayment, type EntryValue } from './replay.ts';
import type { EveningEvent, EveningState, PlayerId, TournamentFormat } from './types.ts';

/** Во что обходится вход или ребай на сумму rub — для пульта банкира и подписей ленты. */
export function entryAmounts(format: TournamentFormat, rub: number = format.buyInRub): EntryValue {
  return { rub, chips: chipsForRub(format, rub) };
}

/** Быстрые суммы пульта: вход формата ×1, ×2, ×3 («500 / 1 000 / 1 500»); другая — полем. */
export const QUICK_ENTRY_MULTIPLES: readonly number[] = [1, 2, 3];

export function quickEntryAmounts(format: TournamentFormat): number[] {
  return QUICK_ENTRY_MULTIPLES.map((k) => k * format.buyInRub);
}

/**
 * payload входа или ребая на сумму rub. Стандартный вход (сумма = вход формата) — без поля, как все
 * записи до 027 и до кратных входов: старые клиенты и выгрузки читают его одинаково. Иначе — {rub}.
 */
export function entryPayload(
  format: TournamentFormat,
  playerId: PlayerId,
  rub: number,
): { playerId: PlayerId; rub?: number } {
  return rub === format.buyInRub ? { playerId } : { playerId, rub };
}

/**
 * «Оплачено сразу»: платёж игрока банкиру на взнос входа или ребая (сумма записи) — пульт пишет его
 * тем же действием, что и сам вход. В расчёте это обычный платёж (+ игрок → банкиру).
 */
export function prepaidPayment(playerId: PlayerId, rub: number): Payment {
  return { playerId, amountRub: rub };
}

export interface MoneyRow {
  owesRub: number; // взносы: сумма входа и ребаев (feeRub)
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
 * перенормируются до 100% (при 1 игроке — всё ему). Каждое место — вниз до шага stepRub (1 — до
 * рубля), остаток от округления — 1-му месту, чтобы сумма выплат точно равнялась фонду. Фонд меньше
 * шага — весь 1-му месту. Шаг не целый или меньше 1 — до рубля.
 */
export function payouts(
  prizePoolRub: number,
  payoutPct: readonly number[],
  nPlayers: number,
  stepRub = 1,
): number[] {
  const k = Math.min(Math.max(nPlayers, 0), payoutPct.length);
  if (k === 0) return [];
  const pcts = payoutPct.slice(0, k);
  const sumPct = pcts.reduce((a, b) => a + b, 0);
  if (sumPct <= 0) return pcts.map((_, i) => (i === 0 ? prizePoolRub : 0));
  const step = Number.isInteger(stepRub) && stepRub >= 1 ? stepRub : 1;
  // +1e-9: дробные доли (33.3) дают 332.99999… вместо 333 — не теряем шаг на двоичной арифметике.
  // Переплаты быть не может: доля x_i/шаг — дробь со знаменателем Σдолей·шаг (доли до сотых, шаг до
  // MAX_PAYOUT_STEP_RUB — не больше 10⁸), до целого сверху от неё не меньше 10⁻⁸ ≫ eps.
  const result = pcts.map((p) => Math.floor((prizePoolRub * p) / sumPct / step + 1e-9) * step);
  const rest = prizePoolRub - result.reduce((a, b) => a + b, 0);
  result[0] = (result[0] ?? 0) + rest;
  return result;
}

/** Шаг призовых формата: payoutStepRub (027) или 1 ₽ — так считались все вечера до него. */
export function payoutStep(format: Pick<TournamentFormat, 'payoutStepRub'>): number {
  const step = format.payoutStepRub;
  return typeof step === 'number' && Number.isInteger(step) && step >= 1 ? step : 1;
}

/** Призовые по местам по правилам формата вечера (доли и шаг округления). */
export function payoutsFor(
  format: Pick<TournamentFormat, 'payoutPct' | 'payoutStepRub'>,
  prizePoolRub: number,
  nPlayers: number,
): number[] {
  return payouts(prizePoolRub, format.payoutPct, nPlayers, payoutStep(format));
}

/**
 * Денежная таблица вечера. Призовые — только после finish: до этого места не окончательны.
 * Нокауты на деньги не влияют.
 */
export function computeMoney(format: TournamentFormat, state: EveningState): MoneyTable {
  const table: MoneyTable = {};
  const prizes = state.finished
    ? payoutsFor(format, state.prizePoolRub, state.joinOrder.length)
    : [];

  for (const id of state.joinOrder) {
    const p = state.players[id];
    if (!p) continue;
    const owesRub = p.feeRub;
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
