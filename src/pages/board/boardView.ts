// Табло: что показать из replay — подписи и сигналы часов, экран ожидания, подвал голоса. Чистые
// функции без React (vitest — boardView.test.ts); деньги и места считает домен, здесь только
// раскладка посчитанного. Время — серверное nowMs табло (useNow + сверка часов).
import { payouts } from '@domain/money.ts';
import type { BlindLevel, EveningEvent, EveningState, TournamentFormat } from '@domain/types.ts';
import {
  formatBlinds,
  formatDuration,
  formatNumber,
  NBSP,
  pluralWithNumber,
} from '../../shared/lib/format';
import { joinNames } from '../../shared/lib/text';
import {
  averageStackBb,
  formatBb,
  lastBust,
  rebuyText,
  rebuyWindow,
  totalRebuys,
  type NameOf,
} from '../evening/lib';

const MINUTE_MS = 60_000;

/** «Последняя минута уровня» — световой сигнал вместо звука (решение клуба: звук — только голос). */
export const FINAL_MINUTE_MS = MINUTE_MS;
/**
 * Сколько игрового времени уровня держится вспышка смены уровня. С запасом на опрос табло (до 3 с):
 * level_next банкира табло узнаёт с задержкой, а вспышка должна успеть отыграть целиком.
 */
export const LEVEL_FLASH_MS = 6_000;
/** Строка ребаев становится акцентной, когда до закрытия осталось столько (как голос «Пять минут»). */
export const REBUYS_SOON_MS = 5 * MINUTE_MS;

/** «6 входов + 1 ребай»: ребай — тоже вход, поэтому входы считаем без ребаев. */
export function entriesText(state: EveningState): string {
  const joins = state.joinOrder.length;
  const rebuys = totalRebuys(state);
  const base = pluralWithNumber(joins, ['вход', 'входа', 'входов']);
  return rebuys > 0 ? `${base} + ${pluralWithNumber(rebuys, ['ребай', 'ребая', 'ребаев'])}` : base;
}

/** Время игры часами и минутами: «2:14», «0:45». */
export function formatGameTime(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Сколько стоим: от последней принятой паузы до nowMs; null — часы не на паузе. */
export function pausedForMs(
  state: EveningState,
  applied: readonly EveningEvent[],
  nowMs: number,
): number | null {
  if (state.timer.status !== 'paused') return null;
  for (let i = applied.length - 1; i >= 0; i -= 1) {
    const ev = applied[i];
    if (ev?.type !== 'timer_pause') continue;
    const at = Date.parse(ev.at);
    return Number.isFinite(at) ? Math.max(0, nowMs - at) : null;
  }
  return null;
}

/** «стоим 6 мин», «стоим 1 ч 5 мин», «стоим меньше минуты». */
export function pauseText(ms: number): string {
  return `стоим ${formatDuration(ms)}`;
}

export interface BoardClock {
  paused: boolean;
  /** Последний уровень: часы не считают вверх — главным числом блайнды. */
  lastLevel: boolean;
  /** Последняя минута уровня по времени, часы идут, следующий уровень есть. */
  finalMinute: boolean;
  /** Уровень только что сменился (или начался): вспышка блока часов. */
  fresh: boolean;
}

export function boardClock(state: EveningState): BoardClock {
  const t = state.timer;
  const started = t.status !== 'not_started';
  const running = t.status === 'running' && !state.finished;
  const left = t.levelRemainingMs;
  return {
    paused: t.status === 'paused',
    lastLevel: started && state.nextLevel === null,
    finalMinute:
      running &&
      state.currentLevel.trigger.type === 'time' &&
      state.nextLevel !== null &&
      left !== null &&
      left <= FINAL_MINUTE_MS,
    fresh: running && t.levelElapsedMs < LEVEL_FLASH_MS,
  };
}

/**
 * Индекс уровня (с 0), в конце которого закроются ребаи, или null: ребаи открыты всю игру
 * (последний уровень сам не кончается — rebuyWindow) или закрыты с самого старта.
 */
export function lastRebuyLevelIndex(format: TournamentFormat): number | null {
  const until = format.rebuyUntilLevel;
  return until >= 1 && until < format.levels.length ? until - 1 : null;
}

/**
 * Строка ребаев табло. На последнем уровне ребаев (и когда до закрытия меньше пяти минут) —
 * акцентная: «Последний уровень ребаев — ещё 25 мин». Иначе — та же строка, что на пульте.
 */
export function rebuyLine(
  format: TournamentFormat,
  state: EveningState,
): { text: string; emphasis: boolean } {
  const win = rebuyWindow(format, state);
  if (win.kind !== 'open') return { text: rebuyText(win), emphasis: false };
  const last = state.timer.levelIndex === lastRebuyLevelIndex(format);
  const soon = win.msLeft !== null && win.msLeft <= REBUYS_SOON_MS;
  if (last) {
    return {
      text:
        win.msLeft === null
          ? 'Последний уровень ребаев'
          : `Последний уровень ребаев${NBSP}— ещё ${formatDuration(win.msLeft)}`,
      emphasis: true,
    };
  }
  return { text: rebuyText(win), emphasis: soon };
}

/**
 * Последний нокаут одной строкой: жертва и кто выбил — «Миша» + «выбивают Саша и Дима». Глагол в
 * настоящем времени, как в ленте: у него нет рода. Нокаута не было — null.
 */
export function lastKnockout(
  applied: readonly EveningEvent[],
  nameOf: NameOf,
): { victim: string; by: string } | null {
  const bust = lastBust(applied);
  if (!bust) return null;
  const killers = bust.by.filter((id) => id !== bust.victim).map(nameOf);
  const by =
    killers.length === 0
      ? 'кто выбил — не указано'
      : `${killers.length === 1 ? 'выбивает' : 'выбивают'} ${joinNames(killers)}`;
  return { victim: nameOf(bust.victim), by };
}

/** Нижняя строка табло: «Средний стек 12,5 BB · игра идёт 2:14»; null — часы не запущены. */
export function tableLine(state: EveningState): string | null {
  if (state.timer.status === 'not_started') return null;
  const parts: string[] = [];
  const avg = averageStackBb(state);
  if (avg !== null) parts.push(`Средний стек ${formatBb(avg)}`);
  const time = `игра идёт ${formatGameTime(state.timer.totalElapsedMs)}`;
  parts.push(parts.length > 0 ? time : `Игра идёт ${formatGameTime(state.timer.totalElapsedMs)}`);
  // Неразрывный пробел перед точкой: строка переносится после «·», а не перед ней.
  return parts.join(`${NBSP}· `);
}

// --- Экран ожидания ------------------------------------------------------------------------------

/** «через 12 мин», «через 1 ч 20 мин» (минуты — вверх); null — время старта уже прошло. */
export function startsInText(scheduledMs: number, nowMs: number): string | null {
  const left = scheduledMs - nowMs;
  if (!Number.isFinite(left) || left <= 0) return null;
  return `через ${formatDuration(Math.ceil(left / MINUTE_MS) * MINUTE_MS)}`;
}

export interface LevelPlanRow {
  /** Номер уровня с 1. */
  n: number;
  level: BlindLevel;
  /** Начало уровня (мс), если все уровни до него — по времени; иначе null. */
  at: number | null;
  /** В конце этого уровня закрываются ребаи. */
  lastRebuy: boolean;
}

/**
 * Структура уровней с часами: уровень 1 — в startMs, каждый следующий — после длительности
 * предыдущего. Уровень по вылетам или раздачам длится неизвестно сколько — дальше часов нет.
 */
export function levelPlan(format: TournamentFormat, startMs: number): LevelPlanRow[] {
  const lastRebuy = lastRebuyLevelIndex(format);
  let at: number | null = startMs;
  return format.levels.map((level, i) => {
    const row: LevelPlanRow = { n: i + 1, level, at, lastRebuy: i === lastRebuy };
    const t = level.trigger;
    at = at !== null && t.type === 'time' && t.minutes > 0 ? at + t.minutes * MINUTE_MS : null;
    return row;
  });
}

/** Стартовый стек в больших блайндах первого уровня; null — считать не из чего. */
export function startingStackBb(format: TournamentFormat): number | null {
  const bb = format.levels[0]?.bb ?? 0;
  return bb > 0 && format.startingChips > 0 ? format.startingChips / bb : null;
}

export interface PayoutRow {
  place: number;
  pct: number;
  /** Сумма по нынешнему фонду — когда за столом не меньше игроков, чем призовых мест. */
  rub: number | null;
}

/**
 * Выплаты экрана ожидания: доли формата и, если за столом уже хватает игроков на все призовые
 * места, суммы по нынешнему фонду (доменная раскладка payouts). Игроков меньше — домен делит фонд
 * на меньшее число мест, и доли формата с суммами разошлись бы; тогда только доли.
 */
export function payoutPlan(format: TournamentFormat, state: EveningState): PayoutRow[] {
  const seated = state.joinOrder.length;
  const enough = seated >= format.payoutPct.length && state.prizePoolRub > 0;
  const amounts = enough ? payouts(state.prizePoolRub, format.payoutPct, seated) : [];
  return format.payoutPct.map((pct, i) => ({
    place: i + 1,
    pct,
    rub: enough ? (amounts[i] ?? null) : null,
  }));
}

// --- Блайнды крупно -------------------------------------------------------------------------------

/** Цифра главного числа (Sofia Sans Condensed 800, табличные) в em — с запасом: замер 0,504. */
const DIGIT_EM = 0.53;
/** Остальные знаки строки блайндов (неразрывный пробел, «/», скобки) — замер 0,13–0,24 em. */
const NARROW_EM = 0.25;

/**
 * Строка блайндов кусками с местом переноса после «/» (между кусками — <wbr>). Внутри разрядов
 * пробелы неразрывные, а между «/» и цифрой браузер строку не рвёт: узкая колонка либо вылезала за
 * экран, либо (overflow-wrap: anywhere) резала число посреди разряда — «1 000/2 00» и «0». Перед
 * «(анте)» обычный пробел — там перенос и так возможен.
 */
export function blindsParts(text: string): string[] {
  const slash = text.indexOf('/');
  return slash < 0 ? [text] : [text.slice(0, slash + 1), text.slice(slash + 1)];
}

export interface BigBlinds {
  /** «1 000/2 000» — без анте: на табло анте отдельной строкой, главное число короче. */
  text: string;
  /** Анте числом («3 000») или null. */
  ante: string | null;
  /**
   * Ширина text в em шрифта главного числа, с запасом: по ней board.css вписывает число в колонку
   * одной строкой (--bd-em), уменьшая кегль, а не разрывая число.
   */
  em: number;
}

/** Блайнды последнего уровня — главное число табло. */
export function bigBlinds(level: Pick<BlindLevel, 'sb' | 'bb' | 'ante'>): BigBlinds {
  const text = formatBlinds({ sb: level.sb, bb: level.bb });
  const digits = text.replace(/\D/g, '').length;
  const em = digits * DIGIT_EM + (text.length - digits) * NARROW_EM;
  return {
    text,
    ante: level.ante ? formatNumber(level.ante) : null,
    em: Math.round(em * 100) / 100,
  };
}

// --- Подвал голоса --------------------------------------------------------------------------------

/** Чего голосу не хватает на этом вечере: сервер ответил, а клипа нет. */
export interface VoiceGaps {
  /** Игроки (как на табло), чьё имя ещё не озвучено. */
  names: string[];
  /** Фраз уровней («Поехали!», «Новый уровень…»), которых нет. */
  levels: number;
  /** Фиксированных фраз и кусков («Пауза.», «Голос включён.»…), которых нет. */
  phrases: number;
}

export const NO_VOICE_GAPS: VoiceGaps = { names: [], levels: 0, phrases: 0 };

/**
 * Подвал о неозвученном — без обещаний сверх того, что табло сделает. Для имени есть запасной
 * вариант (фраза без него, announcementVariants); для уровня и фиксированной фразы — нет: такое
 * объявление табло пропустит.
 */
export function voiceGapNotes(gaps: VoiceGaps): string[] {
  const out: string[] = [];
  if (gaps.levels + gaps.phrases > 0)
    out.push('Часть объявлений этого вечера ещё не озвучена — их табло пропустит.');
  if (gaps.names.length === 1)
    out.push(
      `Имя ${gaps.names[0]} ещё не озвучено — нокауты и победу этого игрока табло объявит без имени.`,
    );
  else if (gaps.names.length > 1)
    out.push(
      `Имена ${joinNames(gaps.names)} ещё не озвучены — нокауты и победы этих игроков табло объявит без имён.`,
    );
  if (out.length > 0) out.push(`Новые фразы и${NBSP}имена озвучиваются раз в${NBSP}сутки.`);
  return out;
}
