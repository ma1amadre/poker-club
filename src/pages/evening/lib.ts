// Чистые помощники экрана вечера, расчёта и табло: подписи событий, порядок игроков, оценки
// времени. Деньги, места и очки здесь НЕ считаются — только раскладка того, что посчитал домен.
import {
  computeMoney,
  entryAmounts,
  prepaidPayment,
  settlement,
  type Payment,
  type SettlementRow,
} from '@domain/money.ts';
import {
  pauseLeftMs,
  readAmend,
  readPause,
  readStacks,
  readTimeAdjust,
  replayLog,
  type EventDraft,
  type ReplayLog,
} from '@domain/replay.ts';
import { readShowdown, streetOf } from '@domain/showdown.ts';
import { spectatesEvening } from '@domain/spectators.ts';
import type {
  BlindLevel,
  EveningEvent,
  EveningState,
  EventType,
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
import { cardLabel } from '../../shared/lib/poker/cards';
import { joinNames, NAME_MAX, nameMatchKey, normalizeName } from '../../shared/lib/text';
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

export type EventKind = 'entry' | 'bust' | 'clock' | 'money' | 'finish' | 'showdown';

export interface EventLine {
  kind: EventKind;
  title: string;
  detail: string | null;
}

/**
 * Как журнал применил записи (правка на месте, миграция 022): лента показывает исправленную запись
 * с поправкой в силе, а саму поправку — со ссылкой на исправляемую.
 */
export interface FeedContext {
  /** id исправленной записи → она же с поправкой в силе (replayLog.applied). */
  effective: ReadonlyMap<number, EveningEvent>;
  /** id → запись журнала: для поправки — исправляемая запись. */
  byId: ReadonlyMap<number, EveningEvent>;
  /**
   * id поправки → исправляемая запись со значением, которое было в силе перед этой поправкой:
   * последняя принятая поправка той же записи раньше неё, иначе исходное (подпись «было»).
   */
  previous: ReadonlyMap<number, EveningEvent>;
}

export function feedContext(
  events: readonly EveningEvent[],
  log: Pick<ReplayLog, 'applied' | 'amended'>,
): FeedContext {
  const effective = new Map<number, EveningEvent>();
  for (const e of log.applied) if (log.amended.has(e.id)) effective.set(e.id, e);
  const byId = new Map(events.map((e) => [e.id, e]));
  const accepted = new Set(log.applied.filter((e) => e.type === 'amend').map((e) => e.id));
  const inForce = new Map<number, EveningEvent>();
  const previous = new Map<number, EveningEvent>();
  for (const ev of [...events].sort((a, b) => a.id - b.id)) {
    if (ev.type !== 'amend') continue;
    const patch = readAmend(ev.payload);
    const target = patch ? byId.get(patch.eventId) : undefined;
    if (!patch || !target) continue;
    previous.set(ev.id, inForce.get(target.id) ?? target);
    if (accepted.has(ev.id)) {
      const base = target.payload as Record<string, unknown>;
      const payload =
        'by' in patch ? { ...base, by: [...patch.by] } : { ...base, stacks: patch.stacks };
      inForce.set(target.id, { ...target, payload: payload as EveningEvent['payload'] });
    }
  }
  return { effective, byId, previous };
}

/** «выбивает Саша», «выбивают Саша и Дима — нокаут каждому», «кто выбил — не указано». */
function killersText(names: readonly string[]): string {
  if (names.length === 0) return 'кто выбил — не указано';
  if (names.length === 1) return `выбивает ${names[0]}`;
  return `выбивают ${joinNames(names)} — нокаут каждому`;
}

/** «1 мин», «30 с», «1 мин 30 с» — поправка времени уровня. */
function shiftText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (m === 0) return `${sec}${NBSP}с`;
  return sec === 0 ? `${m}${NBSP}мин` : `${m}${NBSP}мин ${sec}${NBSP}с`;
}

/**
 * Подпись события для ленты. Глаголы в настоящем времени («выбивает») — у них нет рода,
 * а имена игроков бывают и мужские, и женские. Вход и ребай кратно стандартному — с суммой
 * («вход на 1 000 ₽»); стандартный — без подробностей, как раньше. С контекстом ленты (`ctx`)
 * исправленная запись показана с поправкой в силе и пометкой «исправлено».
 */
export function describeEvent(
  ev: EveningEvent,
  nameOf: NameOf,
  formatRub: (n: number) => string,
  format: TournamentFormat,
  ctx?: FeedContext,
): EventLine {
  const shown = ctx?.effective.get(ev.id) ?? ev;
  const amended = shown !== ev;
  const withMark = (detail: string | null): string | null =>
    amended ? [detail, 'исправлено'].filter(Boolean).join(' · ') : detail;
  const who = () => {
    const id = playerOf(ev);
    return id ? nameOf(id) : 'игрок';
  };
  const entrySum = (word: string): string | null => {
    const k = readStacks(shown.payload);
    // Исправленный стандартный вход — тоже с суммой: видно, на что его поправили.
    return k !== null && (k > 1 || amended)
      ? `${word} на ${formatRub(entryAmounts(format, k).rub)}`
      : null;
  };
  switch (ev.type) {
    case 'join':
      return { kind: 'entry', title: `Вход: ${who()}`, detail: withMark(entrySum('вход')) };
    case 'rebuy':
      return { kind: 'entry', title: `Ребай: ${who()}`, detail: withMark(entrySum('ребай')) };
    case 'bust':
      return {
        kind: 'bust',
        title: `Вылет: ${who()}`,
        detail: withMark(killersText(byOf(shown).map(nameOf))),
      };
    case 'amend': {
      const patch = readAmend(ev.payload);
      const target = patch ? ctx?.byId.get(patch.eventId) : undefined;
      // «Было» — значение в силе перед этой правкой (после прошлых правок той же записи).
      const before = ctx?.previous.get(ev.id) ?? target;
      const targetWho = target ? playerOf(target) : null;
      const name = targetWho ? `: ${nameOf(targetWho)}` : '';
      if (patch && 'by' in patch) {
        const was = before ? byOf(before).map(nameOf) : null;
        return {
          kind: 'bust',
          title: `Правка вылета${name}`,
          detail: [
            killersText(patch.by.map(nameOf)),
            was ? `было: ${was.length > 0 ? joinNames(was) : 'не указано'}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      }
      if (patch && 'stacks' in patch) {
        const was = before ? readStacks(before.payload) : null;
        return {
          kind: 'entry',
          title: `Правка ${target?.type === 'rebuy' ? 'ребая' : 'входа'}${name}`,
          detail: [
            `×${patch.stacks} — ${formatRub(entryAmounts(format, patch.stacks).rub)}`,
            was !== null ? `было: ×${was}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      }
      return { kind: 'entry', title: 'Правка записи', detail: null };
    }
    case 'time_adjust': {
      const seconds = readTimeAdjust(ev.payload);
      return {
        kind: 'clock',
        title:
          seconds === null
            ? 'Время уровня'
            : `Время уровня: ${seconds > 0 ? '+' : '−'}${shiftText(Math.abs(seconds))}`,
        detail: null,
      };
    }
    case 'timer_start':
      return { kind: 'clock', title: 'Старт турнира', detail: null };
    case 'timer_pause': {
      const minutes = readPause(ev.payload)?.minutes ?? null;
      return {
        kind: 'clock',
        title: minutes === null ? 'Пауза' : `Перерыв ${minutes}${NBSP}мин`,
        detail: null,
      };
    }
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
    case 'showdown': {
      // Каждая правка олл-ина — полное состояние; в ленте — что добавилось: руки или улица.
      const read = readShowdown(ev.payload);
      if (!read.ok) return { kind: 'showdown', title: 'Олл-ин', detail: null };
      const { hands, board } = read.value;
      const names = joinNames(hands.map((h) => nameOf(h.playerId)));
      const cards = (codes: readonly string[]) => codes.map(cardLabel).join(' ');
      const street = streetOf(board.length);
      if (street === 'preflop') {
        return {
          kind: 'showdown',
          title: `Олл-ин: ${names}`,
          detail: hands.map((h) => `${nameOf(h.playerId)} — ${cards(h.cards)}`).join(', '),
        };
      }
      const title =
        street === 'flop'
          ? `Флоп: ${cards(board)}`
          : `${street === 'turn' ? 'Тёрн' : 'Ривер'}: ${cards(board.slice(-1))}`;
      return { kind: 'showdown', title, detail: `олл-ин: ${names}` };
    }
    case 'showdown_close':
      return { kind: 'showdown', title: 'Олл-ин закрыт', detail: null };
    default:
      return { kind: 'clock', title: 'Событие', detail: null };
  }
}

// --- Что изменит отмена записи и переход уровня -----------------------------------------------

export interface VoidImpact<T extends EveningEvent> {
  /** Отменяемая запись — первая из списка (null — такой в журнале нет). */
  voided: T | null;
  /** Записи, которые журнал сейчас не принимает, а после отмены примет. */
  revived: T[];
  /** Принятые сейчас записи, которые после отмены журнал принимать перестанет, — с причиной. */
  rejected: { event: T; message: string }[];
  /** Вечер завершён по журналу сейчас и после отмены. */
  finishedBefore: boolean;
  finishedAfter: boolean;
}

/**
 * Что сделает отмена записи: replay «до» и «после». Отмена старого вылета, например, оживляет
 * игрока — и ребай после этого вылета журнал перестаёт принимать (ребай живому не положен), а
 * отмена вылета финалиста в завершённом вечере снимает «Игра окончена». Несколько id — отмена
 * действия целиком (вылет и ребай, вход с оплатой): последствия считаются для всех вместе.
 */
export function voidImpact<T extends EveningEvent>(
  format: TournamentFormat,
  events: readonly T[],
  eventIds: number | readonly number[],
  nowMs: number,
): VoidImpact<T> {
  const list = typeof eventIds === 'number' ? [eventIds] : eventIds;
  const ids = new Set(list);
  const before = replayLog(format, events, nowMs);
  const after = replayLog(
    format,
    events.map((e) => (ids.has(e.id) ? { ...e, voided: true } : e)),
    nowMs,
  );
  const errorsBefore = new Map(before.state.errors.map((e) => [e.eventId, e.message]));
  const errorsAfter = new Map(after.state.errors.map((e) => [e.eventId, e.message]));
  const appliedAfter = new Set(after.applied.map((e) => e.id));
  const others = events.filter((e) => !e.voided && !ids.has(e.id)).sort((a, b) => a.id - b.id);
  return {
    voided: events.find((e) => e.id === list[0]) ?? null,
    revived: others.filter((e) => errorsBefore.has(e.id) && appliedAfter.has(e.id)),
    rejected: others.flatMap((event) => {
      const message = errorsAfter.get(event.id);
      return message !== undefined && !errorsBefore.has(event.id) ? [{ event, message }] : [];
    }),
    finishedBefore: before.state.finished,
    finishedAfter: after.state.finished,
  };
}

/** Первая буква строчная: причина из домена встаёт внутрь фразы. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Хвост подтверждения отмены: какие записи оживут, какие станут «не принято», перестанет ли вечер
 * быть завершённым. label — «Ребай: Саша», 20:15 (подпись записи со временем). Пусто — отмена
 * ничего, кроме себя, не трогает. Что вечер вернётся в игру при отмене самой «Игра окончена»,
 * объясняет вызывающий — здесь об этом ни слова.
 */
export function voidImpactText<T extends EveningEvent>(
  impact: VoidImpact<T>,
  label: (event: T) => string,
): string {
  const parts: string[] = [];
  const unfinished =
    impact.finishedBefore && !impact.finishedAfter && impact.voided?.type !== 'finish';
  if (impact.revived.length > 0) {
    const many = impact.revived.length > 1;
    parts.push(
      `После отмены вступит в силу ${many ? 'записи' : 'запись'}, которую журнал сейчас не принимает: ${impact.revived
        .map(label)
        .join(
          '; ',
        )}. Если ${many ? 'они тоже лишние — отмени и их' : 'она тоже лишняя — отмени и её'}.`,
    );
  }
  // «Игра окончена» в этом списке не нужна: о ней — отдельная фраза про завершённый вечер.
  const rejected = impact.rejected.filter((r) => !(unfinished && r.event.type === 'finish'));
  if (rejected.length > 0) {
    const many = rejected.length > 1;
    parts.push(
      `Журнал перестанет принимать ${many ? 'записи' : 'запись'}: ${rejected
        .map((r) => `${label(r.event)} (${lowerFirst(r.message)})`)
        .join(
          '; ',
        )}. ${many ? 'Они останутся' : 'Она останется'} в ленте с пометкой «Не принято», места, нокауты и деньги посчитаются без ${many ? 'них' : 'неё'}.`,
    );
  }
  if (unfinished) {
    parts.push(
      'Вечер перестанет быть завершённым — придётся вернуть его в игру, записать недостающее и завершить заново. Пока этого не сделать, вечер не попадёт в рейтинг, ачивки и итоги.',
    );
  }
  return parts.join(' ');
}

/**
 * «Уровень вперёд» закроет ребаи и позднюю регистрацию: кто из вылетевших ещё мог докупиться (в
 * порядке входа). null — переход ребаи не закрывает (или перехода не будет).
 */
export function levelNextClosesRebuys(
  format: TournamentFormat,
  state: EveningState,
): { busted: PlayerId[] } | null {
  const t = state.timer;
  if (!state.rebuysOpen || t.status === 'not_started') return null;
  if (t.levelIndex >= format.levels.length - 1) return null;
  // Номер уровня после перехода (с 1); ребаи открыты, пока он не больше rebuyUntilLevel.
  if (t.levelIndex + 2 <= format.rebuyUntilLevel) return null;
  const busted = state.joinOrder.filter((id) => {
    const p = state.players[id];
    return (
      p !== undefined && !p.alive && (format.rebuyLimit === null || p.rebuys < format.rebuyLimit)
    );
  });
  return { busted };
}

/** «Ребаи закроются — Саша и Дима не смогут докупиться». Без рода: имена бывают любые. */
export function rebuysClosingText(bustedNames: readonly string[]): string {
  if (bustedNames.length === 0)
    return 'Ребаи и поздняя регистрация закроются: докупиться и сесть за стол будет нельзя.';
  const many = bustedNames.length > 1;
  return `Ребаи закроются — ${many ? 'вылетевшие ' : ''}${joinNames(bustedNames)} не ${many ? 'смогут' : 'сможет'} докупиться. Поздняя регистрация тоже закроется.`;
}

/** До авто-перехода уровня меньше edgeMs (таймер идёт, уровень по времени): сколько осталось. */
export function levelEdgeLeftMs(state: EveningState, edgeMs: number): number | null {
  const t = state.timer;
  if (t.status !== 'running' || t.levelRemainingMs === null) return null;
  return t.levelRemainingMs < edgeMs ? t.levelRemainingMs : null;
}

/**
 * Уровень сменился, пока банкир отвечал на вопрос «Уровень вперёд» (время вышло, вылет или
 * раздача с другого устройства): запись перескочила бы через уровень. Текст отказа или null.
 */
export function levelMovedText(fromLevelIndex: number, state: EveningState): string | null {
  const now = state.timer.levelIndex;
  return now === fromLevelIndex ? null : `Уровень уже сменился — сейчас ${now + 1}-й`;
}

/**
 * Нажатие повторяет запись, которая дошла до сервера без ответа (тайм-аут, обрыв), — она уже в
 * журнале. Повтор по совету тоста задвоил бы её, а новое действие (следующая раздача, ещё уровень)
 * — нет: спрашиваем. `label` — «Раздача сыграна», 20:15.
 */
export function landedQuestion(label: string): {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
} {
  return {
    title: 'Запись уже в журнале',
    message: `${label} — прошлое нажатие дошло до сервера, хотя ответа не было. Повторять не нужно. Ещё одна запись нужна, только если это новое действие, например следующая раздача.`,
    confirmText: 'Записать ещё одну',
    cancelText: 'Не записывать',
  };
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

export interface SettleShareInput {
  /** День вечера: «9 октября». */
  dateLabel: string;
  bankerId: PlayerId | null;
  /** Игроки в порядке экрана расчёта (settleOrder). */
  ids: readonly PlayerId[];
  /** settlement домена: остаток каждого (+ игрок → банкиру, − банкир → игроку). */
  table: Readonly<Record<PlayerId, Pick<SettlementRow, 'remainingRub'> | undefined>>;
  nameOf: NameOf;
  formatRub: (rub: number) => string;
}

/**
 * Расчёт текстом для чата — его вставляет банкир («Скопировать расчёт»): сначала кто переводит
 * банкиру, потом кому переводит банкир, в конце — кто уже в расчёте. Суммы — остатки settlement
 * домена, имена в именительном (склонять чужие имена нельзя): «Лёша → банкиру: 1 500 ₽», «Банкир →
 * Саша: 2 850 ₽». Строка самого банкира — его собственные деньги, в текст она не идёт.
 */
export function settleShareText(input: SettleShareInput): string {
  const { bankerId, ids, table, nameOf, formatRub } = input;
  const players = ids.filter((id) => id !== bankerId && table[id]);
  const remaining = (id: PlayerId): number => table[id]?.remainingRub ?? 0;
  const toBanker = players.filter((id) => remaining(id) > 0);
  const fromBanker = players.filter((id) => remaining(id) < 0);
  const settled = players.filter((id) => remaining(id) === 0);

  const banker = bankerId ? ` · банкир — ${nameOf(bankerId)}` : '';
  const lines = [`Расчёт за вечер ${input.dateLabel}${banker}`];
  for (const id of toBanker) lines.push(`${nameOf(id)} → банкиру: ${formatRub(remaining(id))}`);
  for (const id of fromBanker) lines.push(`Банкир → ${nameOf(id)}: ${formatRub(-remaining(id))}`);
  if (toBanker.length + fromBanker.length === 0) lines.push('Все в расчёте');
  else if (settled.length > 0) lines.push(`В расчёте: ${joinNames(settled.map(nameOf))}`);
  return lines.join('\n');
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

/** Перерыв с длительностью (пауза на N минут, миграция 022): отсчёт до конца или «пора продолжать». */
export interface BreakView {
  minutes: number;
  /** До конца перерыва, мс (0 — срок вышел). */
  leftMs: number;
  /** Срок вышел: пора продолжать (таймер сам не продолжает — только банкир). */
  due: boolean;
  /** «07:12» — обратный отсчёт до конца перерыва. */
  countdown: string;
}

/** Перерыв на N минут сейчас (nowMs — серверное время) или null: не пауза или пауза без срока. */
export function breakView(state: EveningState, nowMs: number): BreakView | null {
  const left = pauseLeftMs(state, nowMs);
  const minutes = state.timer.pause?.minutes ?? null;
  if (left === null || minutes === null) return null;
  return { minutes, leftMs: Math.max(0, left), due: left <= 0, countdown: formatClock(left) };
}

/** «продолжаем через 07:12» / «пора продолжать» — строка перерыва на часах (с маленькой буквы). */
export function breakLine(view: BreakView): string {
  return view.due ? 'пора продолжать' : `продолжаем через ${view.countdown}`;
}

/**
 * Нужны ли на пульте кнопки ±1 мин: уровень по времени, не последний, таймер запущен, вечер не
 * завершён. Граница (не в минус, не длиннее уровня) — canApply домена: кнопка недоступна.
 */
export function timeAdjustable(state: EveningState): boolean {
  return (
    !state.finished &&
    state.timer.status !== 'not_started' &&
    state.currentLevel.trigger.type === 'time' &&
    state.nextLevel !== null
  );
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

// --- Шторка вылета: кто выбил ----------------------------------------------------------------

/** Кто может выбить игрока: все, кто сейчас в игре, кроме него самого, — в порядке входа. */
export function possibleKillers(state: EveningState, victimId: PlayerId): PlayerId[] {
  return state.joinOrder.filter((id) => id !== victimId && state.players[id]?.alive);
}

/**
 * Выбор выбивших при открытии шторки. В хедз-апе выбить может только соперник — он отмечен
 * заранее, и вылет записывается одним нажатием. Иначе — никто не отмечен.
 */
export function initialKillers(state: EveningState, victimId: PlayerId): PlayerId[] {
  const killers = possibleKillers(state, victimId);
  return killers.length === 1 ? killers : [];
}

/**
 * Подсказка под выбором «Кто выбил». Переключателя дележа нет: два и больше отмеченных и есть
 * «выбили вместе». Нокаут — только статистика, поэтому о деньгах ни слова.
 */
export function killersHint(killerNames: readonly string[], nobody: boolean): string {
  if (nobody) return 'Нокаут никому не засчитается.';
  if (killerNames.length === 0)
    return 'Отметь, кто выбил. Выбили вместе — отметь каждого, нокаут засчитается всем.';
  if (killerNames.length === 1)
    return `Нокаут засчитается: ${killerNames[0]}. Выбили вместе — отметь и остальных.`;
  return `Выбивают вместе ${joinNames(killerNames)} — нокаут засчитается каждому.`;
}

/** Главная кнопка шторки вылета: пока не ясно, кто выбил, — что сделать, а не «Отметить вылет». */
export function bustButtonLabel(killers: number, nobody: boolean): string {
  return killers === 0 && !nobody ? 'Выбери, кто выбил' : 'Отметить вылет';
}

// --- Кратность входа и ребая -----------------------------------------------------------------

/** «1 000 ₽ · 1 000 фишек» — во что обходится вход или ребай кратности k. */
export function stacksAmountText(format: TournamentFormat, k: number): string {
  const a = entryAmounts(format, k);
  return `${rubText(a.rub)} · ${formatNumber(a.chips)}${NBSP}${plural(a.chips, ['фишка', 'фишки', 'фишек'])}`;
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

/** Payload входа или ребая: кратность пишется, только если она больше 1 (стандартный — как раньше). */
export function entryPayload(
  playerId: PlayerId,
  k: number,
): { playerId: PlayerId; stacks?: number } {
  return k > 1 ? { playerId, stacks: k } : { playerId };
}

// --- Одно действие — несколько записей: вылет и ребай, вход с оплатой -------------------------

/** Платёж как черновик записи журнала. */
function paymentDraft(payment: Payment): EventDraft {
  return { type: 'payment', payload: { playerId: payment.playerId, amountRub: payment.amountRub } };
}

/**
 * Записи посадки одним нажатием: вход каждого (кратность одна на всех) и, если «Оплачено сразу»,
 * следом его платёж на сумму взноса (сумма — доменная prepaidPayment).
 */
export function seatDrafts(
  format: TournamentFormat,
  playerIds: readonly PlayerId[],
  k: number,
  paid: boolean,
): EventDraft[] {
  return playerIds.flatMap((id) => [
    { type: 'join' as const, payload: entryPayload(id, k) },
    ...(paid ? [paymentDraft(prepaidPayment(format, id, k))] : []),
  ]);
}

/** Ребай и, если «Оплачено сразу», платёж на его сумму. */
export function rebuyDrafts(
  format: TournamentFormat,
  playerId: PlayerId,
  k: number,
  paid: boolean,
): EventDraft[] {
  return [
    { type: 'rebuy', payload: entryPayload(playerId, k) },
    ...(paid ? [paymentDraft(prepaidPayment(format, playerId, k))] : []),
  ];
}

/** «Вылет и ребай ×k»: вылет, сразу ребай того же игрока и, если «Оплачено сразу», платёж. */
export function bustRebuyDrafts(
  format: TournamentFormat,
  bust: { playerId: PlayerId; by: PlayerId[] },
  k: number,
  paid: boolean,
): EventDraft[] {
  return [
    { type: 'bust', payload: { playerId: bust.playerId, by: bust.by } },
    ...rebuyDrafts(format, bust.playerId, k, paid),
  ];
}

/** Вторая кнопка шторки вылета: кратность — на кнопке, если ребай крупнее стандартного. */
export function bustRebuyLabel(k: number): string {
  return k > 1 ? `Вылет и ребай ×${k}` : 'Вылет и ребай';
}

/**
 * Подсказка под «Оплачено сразу»: что запишется вместе с входом или ребаем. many — посадка
 * нескольких: сумма у каждого своя запись.
 */
export function prepaidHint(
  format: TournamentFormat,
  kind: 'entry' | 'rebuy',
  k: number,
  many = false,
): string {
  const sum = rubText(entryAmounts(format, k).rub);
  const what = kind === 'entry' ? 'со входом' : 'с ребаем';
  return many
    ? `Вместе ${what} каждого запишется его платёж банкиру — по${NBSP}${sum}. В расчёте это обычный платёж.`
    : `Вместе ${what} запишется платёж банкиру — ${sum}. В расчёте это обычный платёж.`;
}

/**
 * Платёж, записанный тем же действием, что вход или ребай («Оплачено сразу»): платёж того же
 * игрока на сумму этого взноса, с тем же временем (одна транзакция add_events или add_guest —
 * одно серверное время) и тем же автором, позже по журналу. null — оплаты при входе не было.
 * Отмена входа отменяет и её: деньги за вход, которого нет, банкир возвращает.
 */
export function linkedPayment<T extends EveningEvent & { createdBy?: string | null }>(
  events: readonly T[],
  entry: T,
  format: TournamentFormat,
): T | null {
  if (entry.type !== 'join' && entry.type !== 'rebuy') return null;
  const id = playerOf(entry);
  const k = readStacks(entry.payload);
  if (!id || k === null) return null;
  const amount = entryAmounts(format, k).rub;
  return (
    events.find(
      (e) =>
        e.type === 'payment' &&
        !e.voided &&
        e.id > entry.id &&
        e.at === entry.at &&
        playerOf(e) === id &&
        amountOf(e) === amount &&
        (e.createdBy ?? null) === (entry.createdBy ?? null),
    ) ?? null
  );
}

// --- Записано, но не принято журналом ------------------------------------------------------

const REJECTED_TITLE: Partial<Record<EventType, string>> = {
  amend: 'Правка не принята',
  time_adjust: 'Поправка времени не принята',
  timer_pause: 'Пауза не принята',
  join: 'Вход не принят',
  rebuy: 'Ребай не принят',
  bust: 'Вылет не принят',
  payment: 'Платёж не принят',
  level_next: 'Переход уровня не принят',
  level_prev: 'Переход уровня не принят',
  hand: 'Раздача не принята',
  finish: 'Завершение не принято',
  showdown: 'Олл-ин не принят',
  showdown_close: 'Закрытие олл-ина не принято',
};

/** Заголовок тоста о непринятой записи: «Ребай не принят: Ребаи закрыты». */
export function rejectedTitle(type: EventType, message: string): string {
  return `${REJECTED_TITLE[type] ?? 'Запись не принята'}: ${message}`;
}

/** Записи действия в тосте. Все — мужского рода: на этом держатся «записан», «пришёл», «его». */
const RECORD_NOUN: Partial<Record<EventType, string>> = {
  bust: 'вылет',
  rebuy: 'ребай',
  join: 'вход',
  payment: 'платёж',
};

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export interface RejectedPart<T> {
  /** Непринятые записи действия с причиной (state.errors replay), по порядку журнала. */
  rejected: { event: T; message: string }[];
  /** Что отменяет кнопка тоста: непринятые записи и оплата, записанная вместе с непринятым взносом. */
  toVoid: T[];
  /** Принятые записи, которые кнопка не трогает (вылет перед непринятым ребаем). */
  kept: T[];
}

/**
 * Действие дошло до сервера, но журнал принял не всё: replay судит по серверному `at`, и «Вылет и
 * ребай», отправленный за полсекунды до закрытия ребаев, приходит уже после — вылет принят, ребай
 * нет. Отменять из тоста можно только непринятое и оплату, записанную вместе с непринятым входом
 * или ребаем (за взнос, которого нет, деньги возвращают), — принятый вылет остаётся. null — принято
 * всё. records — записи одного действия (одна транзакция add_events или одна запись add_event).
 */
export function rejectedPart<T extends EveningEvent & { createdBy?: string | null }>(
  format: TournamentFormat,
  records: readonly T[],
  errors: readonly { eventId: number; message: string }[],
): RejectedPart<T> | null {
  const rejected = records.flatMap((event) => {
    const error = errors.find((e) => e.eventId === event.id);
    return error ? [{ event, message: error.message }] : [];
  });
  if (rejected.length === 0) return null;
  const ids = new Set(rejected.map((r) => r.event.id));
  for (const r of rejected) {
    const paid = linkedPayment(records, r.event, format);
    if (paid) ids.add(paid.id);
  }
  return {
    rejected,
    toVoid: records.filter((e) => ids.has(e.id)),
    kept: records.filter((e) => !ids.has(e.id)),
  };
}

/**
 * Тост о непринятом: заголовок с причиной, что осталось в силе, где искать непринятое и что
 * сделает кнопка. time — серверное время записи («21:20»). Кнопка называет, что отменяет:
 * «Отменить ребай» после «Вылет и ребай» не тронет принятый вылет.
 */
export function rejectedToast<T extends EveningEvent>(
  part: RejectedPart<T>,
  time: string,
): { title: string; detail: string; actionLabel: string } {
  const [first, ...more] = part.rejected;
  if (!first) throw new Error('rejectedToast: принято всё');
  const noun = more.length === 0 ? (RECORD_NOUN[first.event.type] ?? null) : null;
  const rejectedIds = new Set(part.rejected.map((r) => r.event.id));
  const paid = part.toVoid.filter((e) => !rejectedIds.has(e.id));
  const many = more.length > 0;

  const [onlyKept, ...moreKept] = part.kept;
  const keptOne = onlyKept && moreKept.length === 0 ? RECORD_NOUN[onlyKept.type] : undefined;
  const keptText =
    part.kept.length === 0
      ? null
      : keptOne
        ? `${capitalize(keptOne)} записан.`
        : 'Остальное записано.';
  const where = `на сервер в ${time} и ${many ? 'помечены' : noun ? 'помечен' : 'помечена'} в ленте «Не принято».`;
  const rejectedText = many
    ? `Непринятые записи пришли ${where}`
    : noun
      ? `${capitalize(noun)} пришёл ${where}`
      : `Запись пришла ${where}`;
  const them = many ? 'их' : noun ? 'его' : 'её';
  const actionLabel = noun
    ? `Отменить ${noun}`
    : many
      ? part.kept.length === 0
        ? 'Отменить записи'
        : 'Отменить непринятое'
      : 'Отменить запись';
  const payers = new Set(paid.map(playerOf));
  const actionText =
    paid.length > 0
      ? `«${actionLabel}» снимет и оплату — деньги верни ${payers.size > 1 ? 'игрокам' : 'игроку'}.`
      : many
        ? 'Если они лишние — отмени их.'
        : `Если ${noun ? 'он лишний' : 'она лишняя'} — отмени ${them}.`;

  return {
    title: rejectedTitle(first.event.type, first.message),
    detail: [keptText, rejectedText, actionText].filter(Boolean).join(' '),
    actionLabel,
  };
}

// --- «Ты за столом» --------------------------------------------------------------------------

export interface MySeat {
  alive: boolean;
  /** Место вылетевшего, когда оно уже известно (ребаи закрыты): «5-е место»; иначе null. */
  place: string | null;
  /** Вылетевшему, пока можно докупиться: «Можно докупиться — ещё 25 мин»; иначе null. */
  rebuyNote: string | null;
  /** «2 входа: ×2, ×1 · взнос 1 500 ₽». */
  entries: string;
  /** «2 нокаута» / «Нокаутов пока нет». */
  kos: string;
  /** Баланс с банкиром сейчас (settlement домена): «Твой долг банкиру — 1 000 ₽». */
  balance: string;
  /** Сколько уже отдано банкиру: «оплачено 500 ₽»; null — платежей нет. */
  paid: string | null;
  balanceTone: 'owe' | 'await' | 'none';
}

/**
 * Блок «Ты за столом» на экране идущего вечера у игрока: статус, входы и взнос, нокауты, баланс с
 * банкиром прямо сейчас. Деньги — доменные computeMoney и settlement (до финала призовых нет, баланс
 * — взносы минус платежи). null — игрок не за столом. Без прошедшего времени: у него есть род.
 */
export function mySeat(
  format: TournamentFormat,
  state: EveningState,
  applied: readonly EveningEvent[],
  payments: readonly Payment[],
  playerId: PlayerId,
): MySeat | null {
  const p = state.players[playerId];
  if (!p) return null;

  let rebuyNote: string | null = null;
  const limitLeft = format.rebuyLimit === null || p.rebuys < format.rebuyLimit;
  if (!p.alive && limitLeft) {
    const win = rebuyWindow(format, state);
    if (win.kind === 'open' && win.msLeft !== null)
      rebuyNote = `Можно докупиться — ещё ${formatDuration(win.msLeft)}`;
    else if (win.kind === 'open' || win.kind === 'not_started')
      rebuyNote = `Можно докупиться до конца ${win.untilLevel}-го уровня`;
    else if (win.kind === 'whole_game') rebuyNote = 'Можно докупиться до конца игры';
  }

  const ks = applied
    .filter((e) => (e.type === 'join' || e.type === 'rebuy') && playerOf(e) === playerId)
    .map((e) => readStacks(e.payload) ?? 1);
  const count = pluralWithNumber(ks.length, ['вход', 'входа', 'входов']);
  const multiples = ks.some((k) => k > 1) ? `: ${ks.map((k) => `×${k}`).join(', ')}` : '';
  const money = computeMoney(format, state);
  const owes = money[playerId]?.owesRub ?? 0;
  const row = settlement(money, payments)[playerId];
  const remaining = row?.remainingRub ?? 0;
  const balance =
    remaining > 0
      ? `Твой долг банкиру — ${rubText(remaining)}`
      : remaining < 0
        ? `Банкир должен тебе ${rubText(-remaining)}`
        : 'С банкиром в расчёте';

  return {
    alive: p.alive,
    place: !p.alive && p.place !== null ? `${ordinalPlace(p.place)} место` : null,
    rebuyNote,
    entries: `${count}${multiples} · взнос ${rubText(owes)}`,
    kos:
      p.kos > 0 ? pluralWithNumber(p.kos, ['нокаут', 'нокаута', 'нокаутов']) : 'Нокаутов пока нет',
    balance,
    paid: row && row.paidRub !== 0 ? `оплачено ${rubText(row.paidRub)}` : null,
    balanceTone: remaining > 0 ? 'owe' : remaining < 0 ? 'await' : 'none',
  };
}

// --- Кого посадить за стол -------------------------------------------------------------------

export type RsvpAnswer = 'yes' | 'maybe' | 'no';

/**
 * Значение переключателя «Твой ответ»: пока ответ уходит на сервер — он, иначе сохранённый. Нет
 * ответа (в том числе пока ответы ещё грузятся) — пустая строка: Segmented «Материи» при
 * value === undefined подсвечивает первый вариант, «Иду», и не ответивший видел бы себя идущим.
 */
export function rsvpSegmentValue(
  saved: RsvpAnswer | null | undefined,
  pending?: RsvpAnswer | null,
): RsvpAnswer | '' {
  return pending ?? saved ?? '';
}

export interface SeatCandidate<P> {
  player: P;
  rsvp: RsvpAnswer | null;
}

/**
 * Кого можно посадить за стол: активные игроки клуба, ещё не вошедшие в турнир. Сначала ответившие
 * «иду», затем «под вопросом», молчавшие и «не иду»; постоянные игроки раньше болельщиков (миграция
 * 024: их тоже можно посадить — тогда на этот вечер они игроки), болельщики раньше гостей; дальше
 * по имени.
 */
export function seatCandidates<
  P extends {
    id: string;
    display_name: string;
    is_active: boolean;
    is_guest: boolean;
    is_spectator?: boolean | null;
  },
>(
  players: readonly P[],
  state: EveningState,
  rsvps: readonly { player_id: string; status: RsvpAnswer }[],
): SeatCandidate<P>[] {
  const answer = new Map(rsvps.map((r) => [r.player_id, r.status]));
  const rank = (c: SeatCandidate<P>) => (c.player.is_guest ? 2 : seatSpectator(c) ? 1 : 0);
  return players
    .filter((p) => p.is_active && !state.players[p.id])
    .map((player) => ({ player, rsvp: answer.get(player.id) ?? null }))
    .sort(
      (a, b) =>
        RSVP_ORDER[a.rsvp ?? 'none'] - RSVP_ORDER[b.rsvp ?? 'none'] ||
        rank(a) - rank(b) ||
        a.player.display_name.localeCompare(b.player.display_name, 'ru'),
    );
}

/** Кандидат на посадку — болельщик на этот вечер (ещё не за столом): подпись «болельщик» в шторке. */
export function seatSpectator(c: SeatCandidate<{ is_spectator?: boolean | null }>): boolean {
  return spectatesEvening({ spectator: c.player.is_spectator, rsvp: c.rsvp });
}

/** Имя гостя так же, как его сохранит сервер: пробелы схлопнуты; null — пусто или длиннее 40. */
export function normalizeGuestName(text: string): string | null {
  const name = normalizeName(text);
  return name.length >= 1 && Array.from(name).length <= NAME_MAX ? name : null;
}

/** Имя для сравнения — общий помощник (shared/lib/text): им же админка ищет дубли гостей. */
export { nameMatchKey };

export interface NameMatches<P> {
  /** Активные игроки клуба с таким именем, ещё не вошедшие в турнир: их можно посадить. */
  seatable: P[];
  /** С таким именем уже в турнире. */
  seated: P[];
}

/**
 * Кто в клубе уже носит имя, вписанное в поле «Гость»: каждый ввод имени создаёт нового игрока,
 * а дубль гостя потом не слить. Подсказка предлагает посадить того же человека.
 */
export function nameMatches<P extends { id: string; display_name: string; is_active: boolean }>(
  players: readonly P[],
  state: EveningState,
  text: string,
): NameMatches<P> {
  const key = nameMatchKey(text);
  if (!key) return { seatable: [], seated: [] };
  const same = players.filter((p) => p.is_active && nameMatchKey(p.display_name) === key);
  return {
    seatable: same.filter((p) => !state.players[p.id]),
    seated: same.filter((p) => Boolean(state.players[p.id])),
  };
}

export interface NameMatchNotice {
  title: string;
  text: string;
  /** Посадить найденного одним нажатием: подпись кнопки и id игрока. */
  seat: { label: string; playerId: string } | null;
}

const ANOTHER_PERSON = 'Другой человек с тем же именем — нажми «Добавить гостя».';

/**
 * Подсказка под полем «Гость»: такой человек в клубе уже есть — посадить его, а не заводить дубль
 * (вечера иначе разойдутся по двум профилям). Без рода: «уже есть», «посади этого гостя». null —
 * совпадений нет.
 */
export function nameMatchNotice<P extends { id: string; display_name: string; is_guest: boolean }>(
  matches: NameMatches<P>,
): NameMatchNotice | null {
  const [first] = matches.seatable;
  if (first && matches.seatable.length === 1) {
    return first.is_guest
      ? {
          title: `Такой гость уже есть: ${first.display_name}`,
          text: `Тот же человек — посади этого гостя, и вечера останутся в одном профиле. ${ANOTHER_PERSON}`,
          seat: { label: 'Посадить этого гостя', playerId: first.id },
        }
      : {
          title: `Такой игрок клуба уже есть: ${first.display_name}`,
          text: `Тот же человек — посади его из клуба, а не гостем: иначе вечера разойдутся по двум профилям. ${ANOTHER_PERSON}`,
          seat: { label: 'Посадить этого игрока', playerId: first.id },
        };
  }
  if (first) {
    return {
      title: `В клубе несколько: ${first.display_name}`,
      text: `Отметь нужного в списке выше. ${ANOTHER_PERSON}`,
      seat: null,
    };
  }
  const [seated] = matches.seated;
  if (seated) {
    return { title: `${seated.display_name} уже в этом вечере`, text: ANOTHER_PERSON, seat: null };
  }
  return null;
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
  /** Сумма выплат: призовые. */
  outRub: number;
  /** Деньги у банкира сейчас: все платежи игроков минус выплаты им. */
  bankerHoldsRub: number;
}

export function settleTotals(
  money: Readonly<Record<string, { owesRub: number; prizeRub: number }>>,
  table: Readonly<Record<string, { paidRub: number }>>,
): SettleTotals {
  let inRub = 0;
  let outRub = 0;
  for (const row of Object.values(money)) {
    inRub += row.owesRub;
    outRub += row.prizeRub;
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
