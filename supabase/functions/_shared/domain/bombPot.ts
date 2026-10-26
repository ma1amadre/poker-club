// Бомб-пот (миграция 030, решения пользователя 23.10.2026): раздача, в которой все в игре ставят
// одинаковый взнос, префлопа нет — флоп сразу, один борд.
//
// Почему так устроено:
// - Взнос бросает сервер (кубик в add_event, private.bomb_pot_roll): банкир сам играет, поэтому число
//   он не выбирает и не подменяет. Клиент шлёт {}, в журнал ложится {bbs, previousBbs?}. Домен только
//   читает бросок и переводит его во взнос по BB уровня в позиции записи: уровень сервер не знает, его
//   считает replay по серверному `at`.
// - Отмена и повторное объявление в той же раздаче — новый бросок (решение 7) с пометкой «переброс»:
//   previousBbs ставит сервер по отменённым броскам после последней раздачи, табло и лента его
//   показывают, отменённый бросок остаётся в ленте отменённой записью.
// - Снимок на объявлении: участники (все в игре), взнос, первое слово, места и баттон. Вылет, ребай,
//   поздний вход и смена уровня после объявления его не меняют. Раздачу закрывает 'hand' (баттон стоит,
//   решение 8, кроме вылета игрока на баттоне) или 'finish'.
// - Табло узнаёт число первым (решение 10): телефоны показывают его не раньше at + BOMB_REVEAL_MS по
//   серверному времени (оно у клиентов сверено).
// - На деньги, очки, места в итоге, нокауты, ачивки и сезоны бомб-пот не влияет: это фишки на столе.
// Модуль зовёт replay, поэтому импорты — только типы и seats (без allins: цикл импорта). Победитель
// олл-ина внутри бомб-пота — bombPotAllInWinners в riverBusts.ts.
import type { EventDraft } from './replay.ts';
import { handSeating, nextButtonSeat, seatHolder, tablePositions } from './seats.ts';
import {
  BOMB_POT_EVENT_TYPES,
  BOMB_POT_MAX_BBS,
  BOMB_POT_MIN_BBS,
  type BombPotState,
  type EveningState,
  type EventType,
  type PlayerId,
} from './types.ts';

/**
 * Через сколько после броска (серверное `at` записи) пульт и экраны игроков показывают взнос: табло
 * опрашивает board_state раз в 3 с и выводит число через ~4,6 с после того, как увидело запись, — то
 * есть не позже at + 7,6 с. До этого на телефонах «кубик брошен — смотри на табло».
 */
export const BOMB_REVEAL_MS = 9_000;

/**
 * Бомб-пот без закрытия дольше этого (раздачу забыли закрыть «Следующей раздачей») табло и экраны
 * больше не показывают: раздача-бомб-пот в 2–5 раз длиннее обычной, у олл-ина тот же срок — 10 мин.
 */
export const BOMB_POT_IDLE_HIDE_MS = 20 * 60_000;

/** Тип записи бомб-пота: 'bomb_pot' или 'bomb_pot_result'. */
export function isBombPotEvent(type: EventType): boolean {
  return BOMB_POT_EVENT_TYPES.includes(type);
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** Взнос в BB годится: целое BOMB_POT_MIN_BBS..BOMB_POT_MAX_BBS. */
export function isBombPotBbs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= BOMB_POT_MIN_BBS &&
    value <= BOMB_POT_MAX_BBS
  );
}

/** Бросок записи: bbs (0 — черновик клиента, кубик бросит сервер) и отменённые броски раздачи. */
export interface BombPotRoll {
  bbs: number;
  previousBbs: number[];
}

/**
 * Бросок из payload 'bomb_pot'. Запись журнала — {bbs, previousBbs?} (их ставит сервер); {} — черновик
 * клиента: { bbs: 0, previousBbs: [] }. null — форма неверна (replay отбросит запись).
 */
export function readBombPot(payload: unknown): BombPotRoll | null {
  const record = asRecord(payload);
  if (record === null) return null;
  const has = (key: string): boolean => key in record && record[key] !== undefined;
  if (!has('bbs')) return has('previousBbs') ? null : { bbs: 0, previousBbs: [] };
  if (!isBombPotBbs(record.bbs)) return null;
  if (!has('previousBbs')) return { bbs: record.bbs, previousBbs: [] };
  const prev: unknown = record.previousBbs;
  if (!Array.isArray(prev)) return null;
  const list: unknown[] = prev;
  return list.every(isBombPotBbs) ? { bbs: record.bbs, previousBbs: [...list] } : null;
}

/** Кто забрал банк: id записи бомб-пота и забравшие. */
export interface BombPotResultRead {
  eventId: number;
  winners: PlayerId[];
}

/**
 * Результат из payload 'bomb_pot_result': eventId — целое > 0, winners — непустой список id. Повторы,
 * участие и «в игре» проверяет replay. null — форма неверна.
 */
export function readBombPotResult(payload: unknown): BombPotResultRead | null {
  const record = asRecord(payload);
  if (record === null) return null;
  const id = record.eventId;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  const winners: unknown = record.winners;
  if (!Array.isArray(winners) || winners.length === 0) return null;
  const list: unknown[] = winners;
  return list.every((x) => typeof x === 'string' && x !== '')
    ? { eventId: id, winners: [...(list as PlayerId[])] }
    : null;
}

// --- Отказы журнала (тексты replay и canApply; те же — у RPC, где сервер проверяет сам) ---------

/** Форма броска не та (у RPC — «лишнее поле»: клиент взнос не присылает). */
export const BOMB_POT_SHAPE_ERROR = `Бомб-пот: взнос — целое число BB от ${BOMB_POT_MIN_BBS} до ${BOMB_POT_MAX_BBS}`;
/** Бомб-пот с одним игроком в игре. */
export const BOMB_POT_FEW_ERROR = 'Бомб-пот — когда в игре хотя бы двое';
/** Бомб-пот этой раздачи уже открыт (тот же текст — у RPC, миграция 030). */
export const BOMB_POT_OPEN_ERROR =
  'В этой раздаче бомб-пот уже объявлен — новый можно со следующей раздачи';
/**
 * «На следующую раздачу» при открытом бомб-поте этой раздачи (тот же текст — у RPC add_events,
 * миграция 030): раздача закрыла бы его без отметки, кто забрал банк, а бросок лёг бы в ту же
 * раздачу без «переброса».
 */
export const BOMB_POT_NEXT_OPEN_ERROR =
  'В этой раздаче бомб-пот уже объявлен — сначала отметь, кто забрал банк';
/** Форма результата не та. */
export const BOMB_POT_RESULT_SHAPE_ERROR = 'Бомб-пот: нужны запись бомб-пота и кто забрал банк';

/**
 * Почему бомб-пот сейчас не объявить: null — можно. Те же правила, что у replay (validate): вечер не
 * завершён, таймер запущен, в игре двое и больше, в этой раздаче бомб-пота ещё нет.
 */
export function bombPotRefusal(state: EveningState): string | null {
  if (state.finished) return 'Вечер уже завершён';
  if (state.timer.status === 'not_started') return 'Таймер не запущен';
  if (state.aliveCount < 2) return BOMB_POT_FEW_ERROR;
  if (state.bombPot) return BOMB_POT_OPEN_ERROR;
  return null;
}

/**
 * Почему бомб-пот не объявить «на следующую раздачу» ([hand, bomb_pot] одним действием): бомб-пот этой
 * раздачи ещё открыт — раздача закрыла бы его без «Кто забрал», а бросок лёг бы в ту же раздачу без
 * «переброса» (повтор после тайм-аута, второй телефон). То же правило — у RPC add_events; остальное
 * (таймер, двое в игре, финиш) — canApplySequence по цепочке. null — можно.
 */
export function bombPotNextRefusal(state: EveningState): string | null {
  return state.bombPot ? BOMB_POT_NEXT_OPEN_ERROR : null;
}

/**
 * Почему результат не принять (вечер не завершён — проверяет вызывающий): null — можно. Бомб-пот —
 * открытый, результата у него ещё нет, забравшие — без повторов, его участники и сейчас в игре.
 */
export function bombPotResultRefusal(state: EveningState, read: BombPotResultRead): string | null {
  const open = state.bombPot;
  if (open?.eventId !== read.eventId) {
    return state.bombPots.some((b) => b.eventId === read.eventId)
      ? 'Этот бомб-пот уже закрыт'
      : 'Бомб-пот не принят журналом или отменён — отмечать, кто забрал банк, нечего';
  }
  if (open.result) return 'Кто забрал бомб-пот, уже отмечено — сначала отмени прежнюю запись';
  if (new Set(read.winners).size !== read.winners.length)
    return 'Игрок повторяется в списке забравших банк';
  for (const id of read.winners) {
    if (!open.players.includes(id)) return 'Забрать бомб-пот может только его участник';
    if (!state.players[id]?.alive)
      return 'Забрать бомб-пот может только игрок, который сейчас в игре';
  }
  return null;
}

// --- Снимок на объявлении -------------------------------------------------------------------------

/** Участники и первое слово бомб-пота, если объявить его сейчас. */
export interface BombPotLineup {
  /** Все в игре: по часовой от первого слова (позиций нет — от места 1), без места — в конце по входу. */
  players: PlayerId[];
  /** Первое слово после флопа — первый в игре слева от баттона: 3+ — SB, хедз-ап — BB; позиций нет — null. */
  firstToAct: PlayerId | null;
}

/**
 * Кто играет бомб-пот и кто говорит первым: правило торговли после флопа — первый живой слева от
 * баттона, баттон говорит последним (ресерч, §2). В хедз-апе баттон — он же SB, поэтому первым после
 * флопа говорит BB.
 */
export function bombPotLineup(state: EveningState): BombPotLineup {
  const pos = tablePositions(state);
  const headsUpDealer = pos.order.length === 2 && pos.dealer !== null;
  const first = pos.sb === null ? null : headsUpDealer ? pos.bb : pos.sb;
  const seated = pos.order.map((p) => p.playerId);
  const from = first === null ? 0 : Math.max(0, seated.indexOf(first.playerId));
  const clockwise = [...seated.slice(from), ...seated.slice(0, from)];
  return { players: [...clockwise, ...pos.unseatedAlive], firstToAct: first?.playerId ?? null };
}

/**
 * Что показать в шторке «Бомб-пот» до броска: BB уровня сейчас, вилка взноса, участники, первое слово
 * и баттон — по строке «Баттон — Миша · первое слово — Вова» банкир видит, на какую раздачу объявляет.
 */
export interface BombPotPreview extends BombPotLineup {
  bb: number;
  minStake: number; // BOMB_POT_MIN_BBS·bb
  maxStake: number; // BOMB_POT_MAX_BBS·bb
  buttonSeat: number | null;
}

export function bombPotPreview(state: EveningState): BombPotPreview {
  const bb = state.currentLevel.bb;
  return {
    ...bombPotLineup(state),
    bb,
    minStake: BOMB_POT_MIN_BBS * bb,
    maxStake: BOMB_POT_MAX_BBS * bb,
    buttonSeat: state.buttonSeat,
  };
}

/** Снимок бомб-пота для записи ev (её бросок — roll) по состоянию в позиции записи. Зовёт replay. */
export function newBombPot(
  state: EveningState,
  ev: { id: number; at: string },
  roll: BombPotRoll,
): BombPotState {
  const lineup = bombPotLineup(state);
  const bb = state.currentLevel.bb;
  const stake = roll.bbs * bb;
  return {
    eventId: ev.id,
    at: ev.at,
    bbs: roll.bbs,
    previousBbs: [...roll.previousBbs],
    reroll: roll.previousBbs.length > 0,
    levelIndex: state.timer.levelIndex,
    bb,
    stake,
    players: lineup.players,
    pot: stake * lineup.players.length,
    firstToAct: lineup.firstToAct,
    seating: handSeating(state),
    allIn: null,
    result: null,
    closed: null,
  };
}

/**
 * Куда встанет баттон после раздачи-бомб-пота: остаётся на месте (решение 8, как на WSOP 2024 — иначе
 * SB и BB следующей раздачи пропустили бы блайнды), если на его месте игрок в игре; иначе (игрок на
 * баттоне вылетел или пересел) — обычное правило: к следующему в игре по часовой. Баттон не задан — null.
 */
export function buttonAfterBombPot(state: EveningState): number | null {
  const seat = state.buttonSeat;
  if (seat === null) return null;
  return seatHolder(state, seat)?.alive ? seat : nextButtonSeat(state);
}

// --- Время ---------------------------------------------------------------------------------------

/** Когда телефонам показать взнос: серверное `at` записи + BOMB_REVEAL_MS; сломанное время — NaN. */
export function bombPotRevealAtMs(bombPot: Pick<BombPotState, 'at'>): number {
  return Date.parse(bombPot.at) + BOMB_REVEAL_MS;
}

/**
 * Пора ли телефону показать взнос (nowMs — серверное «сейчас»). Табло этим не пользуется: оно
 * показывает число первым, своей сценой. Сломанное время — показывать сразу.
 */
export function isBombPotRevealed(bombPot: Pick<BombPotState, 'at'>, nowMs: number): boolean {
  const at = bombPotRevealAtMs(bombPot);
  return !Number.isFinite(at) || nowMs >= at;
}

/**
 * Открытый бомб-пот, если его ещё показывать: не дольше BOMB_POT_IDLE_HIDE_MS от объявления (раздачу
 * забыли закрыть — бейдж гаснет сам). Время серверное — табло и телефоны прячут его одновременно.
 */
export function visibleBombPot(state: EveningState, nowMs: number): BombPotState | null {
  const open = state.bombPot;
  if (!open) return null;
  const at = Date.parse(open.at);
  return Number.isFinite(at) && nowMs - at > BOMB_POT_IDLE_HIDE_MS ? null : open;
}

/**
 * Ставят ли в этой раздаче блайнды и анте: в бомб-поте взнос их заменяет (решение 4) — метки SB и BB
 * на табло и экранах гаснут, баттон (D) остаётся. Позиции (tablePositions) от этого не меняются.
 */
export function blindsInHand(state: EveningState): boolean {
  return state.bombPot === null;
}

/** Последний принятый бомб-пот вечера (открытый или закрытый) или null — для развязки на табло. */
export function lastBombPot(state: EveningState): BombPotState | null {
  return state.bombPots.at(-1) ?? null;
}

// --- Записи пульта --------------------------------------------------------------------------------

/** Объявить бомб-пот: клиент шлёт {} — бросок ставит сервер (ключ повтора вернёт ту же запись). */
export const BOMB_POT_DRAFT: EventDraft = { type: 'bomb_pot', payload: {} };

/** «Кто забрал бомб-пот»: участники, кто сейчас в игре, по часовой от первого слова (ряд пульта). */
export function bombPotWinnerChoices(state: EveningState): PlayerId[] {
  const open = state.bombPot;
  return open ? open.players.filter((id) => state.players[id]?.alive) : [];
}

/**
 * Закрыть бомб-пот одним действием (add_events) вместо «Следующей раздачи»: кто забрал банк и
 * раздача; забравших нет («Не отмечать») — только раздача. Одно `at` у обеих записей — «Отменить» в
 * тосте снимает их вместе. Кто забрал, уже отмечено (раздачу, которая закрыла бомб-пот, отменили
 * отдельно) — только раздача: вторую отметку журнал не примет.
 */
export function bombPotCloseDrafts(
  bombPot: Pick<BombPotState, 'eventId' | 'result'>,
  winners: readonly PlayerId[],
): EventDraft[] {
  const hand: EventDraft = { type: 'hand', payload: {} };
  if (winners.length === 0 || bombPot.result !== null) return [hand];
  return [
    { type: 'bomb_pot_result', payload: { eventId: bombPot.eventId, winners: [...winners] } },
    hand,
  ];
}
