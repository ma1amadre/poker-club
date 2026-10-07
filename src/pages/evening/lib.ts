// Чистые помощники экрана вечера, расчёта и табло: подписи событий, порядок игроков, оценки
// времени. Деньги, места и очки здесь НЕ считаются — только раскладка того, что посчитал домен.
import { entryAmounts, type SettlementRow } from '@domain/money.ts';
import { readStacks } from '@domain/replay.ts';
import type {
  BlindLevel,
  EveningEvent,
  EveningState,
  PlayerId,
  PlayerState,
  TournamentFormat,
} from '@domain/types.ts';
// Только чистое форматирование (Intl), без React: модуль тестируется в node.
import {
  formatClock,
  formatDuration,
  formatNumber,
  formatRub as rubText,
  NBSP,
  plural,
  pluralWithNumber,
} from '../../shared/lib/format';
import { joinNames, NAME_MAX, normalizeName } from '../../shared/lib/text';
import { RSVP_ORDER } from '../../shared/api/types';

export type NameOf = (id: PlayerId) => string;

function payloadOf(ev: EveningEvent): Record<string, unknown> {
  const p: unknown = ev.payload;
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {};
}

function playerOf(ev: EveningEvent): PlayerId | null {
  const id = payloadOf(ev).playerId;
  return typeof id === 'string' ? id : null;
}

function byOf(ev: EveningEvent): PlayerId[] {
  const by = payloadOf(ev).by;
  return Array.isArray(by) ? by.filter((x): x is string => typeof x === 'string') : [];
}

function amountOf(ev: EveningEvent): number {
  const a = payloadOf(ev).amountRub;
  return typeof a === 'number' ? a : 0;
}

export type EventKind = 'entry' | 'bust' | 'clock' | 'money' | 'finish';

export interface EventLine {
  kind: EventKind;
  title: string;
  detail: string | null;
}

/**
 * Подпись события для ленты. Глаголы в настоящем времени («выбивает») — у них нет рода,
 * а имена игроков бывают и мужские, и женские. Вход и ребай кратно стандартному — с суммой
 * («вход на 1 000 ₽»); стандартный — без подробностей, как раньше.
 */
export function describeEvent(
  ev: EveningEvent,
  nameOf: NameOf,
  formatRub: (n: number) => string,
  format: TournamentFormat,
): EventLine {
  const who = () => {
    const id = playerOf(ev);
    return id ? nameOf(id) : 'игрок';
  };
  const entrySum = (word: string): string | null => {
    const k = readStacks(ev.payload);
    return k !== null && k > 1 ? `${word} на ${formatRub(entryAmounts(format, k).rub)}` : null;
  };
  switch (ev.type) {
    case 'join':
      return { kind: 'entry', title: `Вход: ${who()}`, detail: entrySum('вход') };
    case 'rebuy':
      return { kind: 'entry', title: `Ребай: ${who()}`, detail: entrySum('ребай') };
    case 'bust': {
      const by = byOf(ev).map(nameOf);
      let detail: string;
      if (by.length === 0) detail = 'кто выбил — не указано';
      else if (by.length === 1) detail = `выбивает ${by[0]}`;
      else if (by.length === 2) detail = `выбивают ${joinNames(by)} — голова пополам`;
      else detail = `выбивают ${joinNames(by)} — голова поровну на ${by.length}`;
      return { kind: 'bust', title: `Вылет: ${who()}`, detail };
    }
    case 'timer_start':
      return { kind: 'clock', title: 'Старт турнира', detail: null };
    case 'timer_pause':
      return { kind: 'clock', title: 'Пауза', detail: null };
    case 'timer_resume':
      return { kind: 'clock', title: 'Игра продолжается', detail: null };
    case 'level_next':
      return { kind: 'clock', title: 'Уровень вперёд', detail: 'вручную' };
    case 'level_prev':
      return { kind: 'clock', title: 'Уровень назад', detail: 'вручную' };
    case 'hand':
      return { kind: 'clock', title: 'Раздача сыграна', detail: null };
    case 'payment': {
      const amount = amountOf(ev);
      return amount >= 0
        ? { kind: 'money', title: `${who()} → банкиру ${formatRub(amount)}`, detail: null }
        : { kind: 'money', title: `Банкир → ${who()} ${formatRub(-amount)}`, detail: null };
    }
    case 'finish':
      return { kind: 'finish', title: 'Игра окончена', detail: null };
    default:
      return { kind: 'clock', title: 'Событие', detail: null };
  }
}

/** Последнее неотменённое игровое событие (платежи отменяются на экране расчёта). */
export function lastUndoable<T extends EveningEvent>(events: readonly T[]): T | null {
  let best: T | null = null;
  for (const ev of events) {
    if (ev.voided || ev.type === 'payment') continue;
    if (!best || ev.id > best.id) best = ev;
  }
  return best;
}

/** Лента: игровые события от новых к старым (платежи — на экране расчёта). */
export function feedEvents<T extends EveningEvent>(events: readonly T[]): T[] {
  return events.filter((e) => e.type !== 'payment').sort((a, b) => b.id - a.id);
}

/**
 * Порядок строк игроков: сначала живые (в порядке входа), потом вылетевшие — у кого место
 * известно, по месту; остальные — свежий вылет выше.
 */
export function orderedPlayers(state: EveningState): PlayerState[] {
  const list = state.joinOrder
    .map((id) => state.players[id])
    .filter((p): p is PlayerState => Boolean(p));
  if (state.finished) {
    return list.sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity));
  }
  const alive = list.filter((p) => p.alive);
  const dead = list
    .filter((p) => !p.alive)
    .sort((a, b) => {
      if (a.place !== null && b.place !== null) return a.place - b.place;
      return (b.finalBustEventId ?? 0) - (a.finalBustEventId ?? 0);
    });
  return [...alive, ...dead];
}

/** Средний стек в больших блайндах; null — если считать не из чего. */
export function averageStackBb(state: EveningState): number | null {
  const bb = state.currentLevel.bb;
  if (state.aliveCount <= 0 || bb <= 0) return null;
  return state.totalChips / state.aliveCount / bb;
}

/** «12,5» — одна цифра после запятой до 20 BB, дальше целые. */
export function formatBbValue(value: number): string {
  const rounded = value < 20 ? Math.round(value * 10) / 10 : Math.round(value);
  return String(rounded).replace('.', ',');
}

/** «12,5 BB». */
export function formatBb(value: number): string {
  return `${formatBbValue(value)}${NBSP}BB`;
}

export type RebuyWindow =
  | { kind: 'closed' }
  /** Таймер не запущен: регистрация и ребаи открыты, считать время не от чего. */
  | { kind: 'not_started'; untilLevel: number }
  /** Ребаи до конца турнира (rebuyUntilLevel не меньше числа уровней). */
  | { kind: 'whole_game' }
  /** msLeft — игрового времени до закрытия; null — уровни не по времени, срок не посчитать. */
  | { kind: 'open'; untilLevel: number; msLeft: number | null };

function levelMs(level: BlindLevel | undefined): number | null {
  if (!level || level.trigger.type !== 'time') return null;
  const ms = level.trigger.minutes * 60_000;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * До какого момента открыты ребаи. Ребаи закрываются с началом уровня rebuyUntilLevel + 1,
 * то есть по окончании уровня rebuyUntilLevel (нумерация с 1). Последний уровень сам не
 * заканчивается, поэтому при rebuyUntilLevel ≥ числа уровней ребаи открыты всю игру.
 */
export function rebuyWindow(format: TournamentFormat, state: EveningState): RebuyWindow {
  if (!state.rebuysOpen) return { kind: 'closed' };
  const until = format.rebuyUntilLevel;
  if (until >= format.levels.length) return { kind: 'whole_game' };
  if (state.timer.status === 'not_started') return { kind: 'not_started', untilLevel: until };
  const current = state.timer.levelIndex; // 0-based; закрытие — при переходе на индекс `until`
  let ms = state.timer.levelRemainingMs;
  if (ms === null) return { kind: 'open', untilLevel: until, msLeft: null };
  for (let i = current + 1; i < until; i += 1) {
    const dur = levelMs(format.levels[i]);
    if (dur === null) return { kind: 'open', untilLevel: until, msLeft: null };
    ms += dur;
  }
  return { kind: 'open', untilLevel: until, msLeft: ms };
}

/** Строка про ребаи: «Ребаи открыты до конца 5-го уровня — ещё 1 ч 20 мин». */
export function rebuyText(win: RebuyWindow): string {
  switch (win.kind) {
    case 'closed':
      return 'Ребаи и поздняя регистрация закрыты';
    case 'whole_game':
      return 'Ребаи открыты всю игру';
    case 'not_started':
      return `Ребаи открыты до конца ${win.untilLevel}-го уровня`;
    case 'open':
      return win.msLeft === null
        ? `Ребаи открыты до конца ${win.untilLevel}-го уровня`
        : `Ребаи открыты до конца ${win.untilLevel}-го уровня — ещё ${formatDuration(win.msLeft)}`;
  }
}

export interface TriggerProgress {
  label: string;
  done: number;
  total: number;
}

/** Прогресс уровня с триггером «вылеты» или «раздачи»; null — уровень по времени. */
export function triggerProgress(state: EveningState): TriggerProgress | null {
  const trig = state.currentLevel.trigger;
  if (trig.type === 'eliminations')
    return { label: 'Вылетов на уровне', done: state.timer.bustsInLevel, total: trig.count };
  if (trig.type === 'hands')
    return { label: 'Раздач на уровне', done: state.timer.handsInLevel, total: trig.count };
  return null;
}

/** Длительность уровня словами: «40 мин», «3 вылета», «10 раздач». */
export function describeTrigger(level: BlindLevel): string {
  const t = level.trigger;
  if (t.type === 'time') return `${t.minutes}${NBSP}мин`;
  if (t.type === 'eliminations') return pluralWithNumber(t.count, ['вылет', 'вылета', 'вылетов']);
  return pluralWithNumber(t.count, ['раздача', 'раздачи', 'раздач']);
}

/** Лучшие охотники вечера: максимум нокаутов (больше нуля); при равенстве — все. */
export function bestHunters(state: EveningState): PlayerId[] {
  let max = 0;
  for (const id of state.joinOrder) max = Math.max(max, state.players[id]?.kos ?? 0);
  if (max === 0) return [];
  return state.joinOrder.filter((id) => (state.players[id]?.kos ?? 0) === max);
}

/** Последний принятый нокаут (для табло): жертва и выбившие. */
export function lastBust(
  applied: readonly EveningEvent[],
): { victim: PlayerId; by: PlayerId[]; at: string } | null {
  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const ev = applied[i];
    if (ev?.type !== 'bust') continue;
    const victim = playerOf(ev);
    if (victim) return { victim, by: byOf(ev), at: ev.at };
  }
  return null;
}

// --- Расчёт -----------------------------------------------------------------------------------

export type SettleDirection = 'to_banker' | 'from_banker' | 'none';

/** Кто кому должен по строке расчёта (знак remaining задаёт домен: + игрок → банкиру). */
export function settleDirection(row: Pick<SettlementRow, 'remainingRub'>): SettleDirection {
  if (row.remainingRub > 0) return 'to_banker';
  if (row.remainingRub < 0) return 'from_banker';
  return 'none';
}

/** Подпись статуса: «Должен банкиру 500 ₽», «Банкир должен 300 ₽», «В расчёте». */
export function settleLabel(
  row: Pick<SettlementRow, 'remainingRub'>,
  formatRub: (n: number) => string,
): string {
  const dir = settleDirection(row);
  if (dir === 'to_banker') return `Должен банкиру ${formatRub(row.remainingRub)}`;
  if (dir === 'from_banker') return `Банкир должен ${formatRub(-row.remainingRub)}`;
  return 'В расчёте';
}

/**
 * Сумма платежа со знаком по контракту payment: + игрок отдал банкиру, − банкир отдал игроку.
 * amountAbs — сколько денег перешло из рук в руки (положительное число).
 */
export function signedPayment(amountAbs: number, direction: SettleDirection): number {
  const n = Math.round(Math.abs(amountAbs));
  return direction === 'from_banker' ? -n : n;
}

/**
 * Разбор суммы из поля ввода: «1 500», «1500 ₽», «500 руб.» → целые рубли; мусор, ноль, дроби → null.
 * Единица срезается только в конце строки, а точка и запятая внутри числа — отказ: «500.00» —
 * это не 50 000 ₽, а дробная запись, которую банкир должен перепроверить.
 */
export function parseRub(text: string): number | null {
  const cleaned = text
    .trim()
    .replace(/\s*(₽|руб\.?|р\.?)$/i, '')
    .replace(/\s/g, ''); // \s в JS покрывает и неразрывные пробелы
  if (!/^\d{1,7}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 && n <= 1_000_000 ? n : null;
}

/** Доля призовых из поля ввода: «70», «33,3», «33.3» → число; пусто или мусор → NaN. */
function parsePct(text: string): number {
  const s = text.trim().replace(/\s/g, '').replace(',', '.');
  return /^(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : Number.NaN;
}

/** Сумма долей для подсказки «сейчас 90 %»; null — есть нечисловое поле. */
export function payoutTextSum(texts: readonly string[]): number | null {
  const nums = texts.map(parsePct);
  if (nums.some((n) => Number.isNaN(n))) return null;
  // Округление убирает хвосты двоичной арифметики: 33,3 + 33,3 + 33,4 = 100.
  return Math.round(nums.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
}

/**
 * Призовые доли из полей ввода — то же правило, что у validateFormat и RPC set_payout:
 * 1–10 мест, каждая доля больше нуля, сумма 100 %. Ошибка — текст для поля.
 */
export function parsePayouts(
  texts: readonly string[],
): { ok: true; pct: number[] } | { ok: false; error: string } {
  if (texts.length < 1 || texts.length > 10)
    return { ok: false, error: 'Призовых мест — от 1 до 10.' };
  const pct = texts.map(parsePct);
  if (pct.some((n) => !Number.isFinite(n) || n <= 0))
    return { ok: false, error: 'Каждая доля — число процентов больше нуля, например 70 или 33,3.' };
  const sum = payoutTextSum(texts) ?? Number.NaN;
  if (Math.abs(sum - 100) > 1e-9)
    return {
      ok: false,
      error: `Сумма долей должна быть 100 %, сейчас ${String(sum).replace('.', ',')} %.`,
    };
  return { ok: true, pct };
}

// --- Подписи игроков и уровня ----------------------------------------------------------------

/** «1-е», «5-е» — место в турнире (средний род: «место»). */
export function ordinalPlace(place: number): string {
  return `${place}-е`;
}

/** «Уровень 3 из 8»; после последнего уровня блайнды не растут — номер не превышает число уровней. */
export function levelLabel(format: TournamentFormat, state: EveningState): string {
  const total = format.levels.length;
  const n = Math.min(state.timer.levelIndex + 1, total);
  return `Уровень ${n} из ${total}`;
}

export interface ClockView {
  /** Крупные цифры: обратный отсчёт, прошедшее время уровня или «--:--». */
  text: string;
  /** Для скринридера. */
  aria: string;
  /** Пояснение под часами (последний уровень) или null. */
  note: string | null;
}

/**
 * Что показывать на часах пульта и табло. На последнем уровне обратного отсчёта нет: уровень сам
 * не кончается (блайнды остаются последними), поэтому «00:00» сбивало бы с толку — показываем,
 * сколько идёт уровень.
 */
export function clockView(state: EveningState): ClockView {
  const t = state.timer;
  if (t.status === 'not_started') return { text: '--:--', aria: 'Таймер не запущен', note: null };
  if (state.nextLevel === null) {
    return {
      text: formatClock(t.levelElapsedMs, 'elapsed'),
      aria: `Последний уровень идёт ${formatDuration(t.levelElapsedMs)}`,
      note: 'Последний уровень — блайнды больше не растут',
    };
  }
  if (t.levelRemainingMs !== null) {
    return {
      text: formatClock(t.levelRemainingMs),
      aria: `До конца уровня ${formatDuration(t.levelRemainingMs)}`,
      note: null,
    };
  }
  return {
    text: formatClock(t.levelElapsedMs, 'elapsed'),
    aria: `Уровень идёт ${formatDuration(t.levelElapsedMs)}`,
    note: null,
  };
}

/**
 * Вторая строка игрока в списке: «5-е место · вылет на 4-м уровне · 2 входа · 1 нокаут».
 * Статус «в игре / вне игры» — в бейдже рядом. Без глаголов прошедшего времени: у них есть род,
 * а имена бывают и мужские, и женские. Пустая строка — сказать нечего. Если хоть один вход или
 * ребай был кратным, видно, сколько всего внесено: «2 входа · взнос 1 500 ₽».
 */
export function playerLine(p: PlayerState, format: TournamentFormat): string {
  const parts: string[] = [];
  if (!p.alive && p.place !== null) parts.push(`${ordinalPlace(p.place)} место`);
  if (!p.alive && p.bustLevel !== null) parts.push(`вылет на${NBSP}${p.bustLevel}-м уровне`);
  if (p.entries > 1) parts.push(pluralWithNumber(p.entries, ['вход', 'входа', 'входов']));
  if (p.stacks > p.entries) parts.push(`взнос ${rubText(entryAmounts(format, p.stacks).rub)}`);
  if (p.kos > 0) parts.push(pluralWithNumber(p.kos, ['нокаут', 'нокаута', 'нокаутов']));
  return parts.join(' · ');
}

// --- Кратность входа и ребая -----------------------------------------------------------------

/** «1 000 ₽ · 1 000 фишек» — во что обходится вход или ребай кратности k. */
export function stacksAmountText(format: TournamentFormat, k: number): string {
  const a = entryAmounts(format, k);
  return `${rubText(a.rub)} · ${formatNumber(a.chips)}${NBSP}${plural(a.chips, ['фишка', 'фишки', 'фишек'])}`;
}

/** Подсказка под выбором кратности: куда разойдутся деньги этого входа. */
export function stacksHint(format: TournamentFormat, k: number): string {
  const a = entryAmounts(format, k);
  return a.bountyRub > 0
    ? `Голова — ${rubText(a.bountyRub)}, в фонд — ${rubText(a.poolRub)}.`
    : `Всё в фонд — ${rubText(a.poolRub)}.`;
}

/**
 * Главная кнопка шторки посадки. Кратность одна на всех отмеченных, поэтому при входе крупнее
 * стандартного сумма видна прямо на кнопке — до записи, а не только в тосте после неё.
 */
export function seatButtonLabel(count: number, format: TournamentFormat, k: number): string {
  if (count === 0) return 'Выбери, кого посадить';
  if (k <= 1) return `Посадить за стол: ${count}`;
  // С суммой — без «за стол»: кнопка не переносит строку и на 320 px иначе не влезает.
  const sum = rubText(entryAmounts(format, k).rub);
  return `Посадить: ${count} · ${count > 1 ? `по${NBSP}` : ''}${sum}`;
}

/**
 * Подпись к баунти на табло: сколько стоит голова у тех, кто сейчас в игре, — у каждого голова
 * его текущего входа или ребая. Все одинаковые — «200 ₽ за голову», разные — «100–300 ₽ за голову»;
 * в игре никого — стандартная голова формата.
 */
export function bountyNote(state: EveningState, format: TournamentFormat): string {
  const heads = state.joinOrder
    .map((id) => state.players[id])
    .filter((p): p is PlayerState => Boolean(p?.alive))
    .map((p) => entryAmounts(format, p.currentStacks).bountyRub);
  if (heads.length === 0) return `${rubText(format.bountyRub)} за голову`;
  const min = Math.min(...heads);
  const max = Math.max(...heads);
  const range = min === max ? rubText(min) : `${formatNumber(min)}–${rubText(max)}`;
  return `${range} за голову`;
}

/** Payload входа или ребая: кратность пишется, только если она больше 1 (стандартный — как раньше). */
export function entryPayload(
  playerId: PlayerId,
  k: number,
): { playerId: PlayerId; stacks?: number } {
  return k > 1 ? { playerId, stacks: k } : { playerId };
}

// --- Кого посадить за стол -------------------------------------------------------------------

export type RsvpAnswer = 'yes' | 'maybe' | 'no';

export interface SeatCandidate<P> {
  player: P;
  rsvp: RsvpAnswer | null;
}

/**
 * Кого можно посадить за стол: активные игроки клуба, ещё не вошедшие в турнир. Сначала ответившие
 * «иду», затем «под вопросом», молчавшие и «не иду»; постоянные игроки раньше гостей; дальше по имени.
 */
export function seatCandidates<
  P extends { id: string; display_name: string; is_active: boolean; is_guest: boolean },
>(
  players: readonly P[],
  state: EveningState,
  rsvps: readonly { player_id: string; status: RsvpAnswer }[],
): SeatCandidate<P>[] {
  const answer = new Map(rsvps.map((r) => [r.player_id, r.status]));
  return players
    .filter((p) => p.is_active && !state.players[p.id])
    .map((player) => ({ player, rsvp: answer.get(player.id) ?? null }))
    .sort(
      (a, b) =>
        RSVP_ORDER[a.rsvp ?? 'none'] - RSVP_ORDER[b.rsvp ?? 'none'] ||
        Number(a.player.is_guest) - Number(b.player.is_guest) ||
        a.player.display_name.localeCompare(b.player.display_name, 'ru'),
    );
}

/** Имя гостя так же, как его сохранит сервер: пробелы схлопнуты; null — пусто или длиннее 40. */
export function normalizeGuestName(text: string): string | null {
  const name = normalizeName(text);
  return name.length >= 1 && Array.from(name).length <= NAME_MAX ? name : null;
}

// --- Итоги и расчёт: раскладка того, что посчитал домен -----------------------------------------

/** id игроков расчёта: сначала по местам (или по входу до finish), затем «лишние» из платежей. */
export function settleOrder(state: EveningState, tableIds: readonly string[]): string[] {
  const base = orderedPlayers(state).map((p) => p.playerId);
  const seen = new Set(base);
  return [...base, ...tableIds.filter((id) => !seen.has(id))];
}

export interface SettleTotals {
  /** Сумма взносов (входы и ребаи). */
  inRub: number;
  /** Сумма выплат: призы и головы. */
  outRub: number;
  /** Деньги у банкира сейчас: все платежи игроков минус выплаты им. */
  bankerHoldsRub: number;
}

export function settleTotals(
  money: Readonly<Record<string, { owesRub: number; prizeRub: number; bountyRub: number }>>,
  table: Readonly<Record<string, { paidRub: number }>>,
): SettleTotals {
  let inRub = 0;
  let outRub = 0;
  for (const row of Object.values(money)) {
    inRub += row.owesRub;
    outRub += row.prizeRub + row.bountyRub;
  }
  let bankerHoldsRub = 0;
  for (const row of Object.values(table)) bankerHoldsRub += row.paidRub;
  return { inRub, outRub, bankerHoldsRub };
}

/** Платежи журнала от новых к старым (включая отменённые — экран показывает их зачёркнутыми). */
export function paymentEvents<T extends EveningEvent>(events: readonly T[]): T[] {
  return events.filter((e) => e.type === 'payment').sort((a, b) => b.id - a.id);
}

/** Игрок из payload события (для экрана расчёта и ленты). */
export function eventPlayerId(ev: EveningEvent): PlayerId | null {
  return playerOf(ev);
}

// --- Табло ------------------------------------------------------------------------------------

/** Сколько ребаев сделали все вместе. */
export function totalRebuys(state: EveningState): number {
  return state.joinOrder.reduce((s, id) => s + (state.players[id]?.rebuys ?? 0), 0);
}

export interface ReopenedNotice {
  title: string;
  text: string;
}

/**
 * Пометка «расчёт снова открыт»: закрытый расчёт сам вернулся в «Игра окончена», потому что после
 * закрытия правили журнал (миграция 008, evenings.settle_reopened_at). null — пометка не нужна.
 * Тому, кто ведёт расчёт, — что делать; игроку вечера — проверить свой остаток; остальным
 * участникам клуба переводить нечего — только что происходит.
 */
export function reopenedNotice(
  evening: { status: string; settle_reopened_at: string | null },
  canControl: boolean,
  played: boolean,
): ReopenedNotice | null {
  if (evening.status !== 'finished' || !evening.settle_reopened_at) return null;
  const title = 'Расчёт снова открыт';
  if (canControl)
    return {
      title,
      text: 'Журнал изменился после закрытия расчёта — проверь остатки и закрой его заново.',
    };
  if (played)
    return {
      title,
      text: 'Журнал изменился после закрытия расчёта — проверь, сколько осталось перевести через банкира.',
    };
  return {
    title,
    text: 'Журнал изменился после закрытия расчёта — банкир сверит остатки и закроет его заново.',
  };
}

/**
 * Пометка закрытого расчёта. Остатки по журналу на экране не нулевые — значит, журнал после
 * закрытия менялся (старые данные или правка в обход триггера 008): предупредить, а не писать,
 * что баланс сошёлся.
 */
export function settledNotice(
  allSettled: boolean,
  canControl: boolean,
  settledText: string | null,
): { tone: 'positive' | 'caution'; title: string; text: string } {
  if (allSettled)
    return {
      tone: 'positive',
      title: 'Расчёт закрыт',
      text: settledText
        ? `Баланс банкира сошёлся в ноль — ${settledText}.`
        : 'Баланс банкира сошёлся в ноль.',
    };
  return {
    tone: 'caution',
    title: 'Расчёт закрыт, но остатки не нулевые',
    text: canControl
      ? 'После закрытия журнал менялся — проверь остатки ниже и открой расчёт заново.'
      : 'После закрытия журнал менялся — проверь остатки ниже.',
  };
}

/**
 * Какой журнал видит экран расчёта: последний id и число отменённых записей. mark_settled
 * (миграция 010) закрывает расчёт, только если на сервере журнал тот же: платёж, записанный или
 * отменённый с другого устройства, пока Realtime не обновил экран, расчёт с долгом не закроет.
 */
export function journalVersion(events: readonly { id: number; voided: boolean }[]): {
  lastEventId: number;
  voidedCount: number;
} {
  let lastEventId = 0;
  let voidedCount = 0;
  for (const e of events) {
    if (e.id > lastEventId) lastEventId = e.id;
    if (e.voided) voidedCount += 1;
  }
  return { lastEventId, voidedCount };
}
