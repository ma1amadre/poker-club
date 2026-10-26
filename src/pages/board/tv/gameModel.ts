// Колонка игры на табло ТВ (макет доработки v3, «разгрузка»): строка над часами, короткая строка
// ребаев, фонд и призовые, тихая строка внизу. Чистые функции (тесты — gameModel.test.ts); тексты
// без рода, длительности — «1 ч 08 мин» (числа моно, единицы текстом), а не «1:08» рядом с часами.
import { payoutsFor } from '@domain/money.ts';
import type { EveningState, TournamentFormat } from '@domain/types.ts';
import { formatBlinds, formatNumber, NBSP } from '../../../shared/lib/format';
import {
  averageStackBb,
  breakLine,
  breakView,
  formatBbValue,
  rebuyWindow,
} from '../../evening/lib';
import { lastRebuyLevelIndex } from '../boardView';

const MINUTE_MS = 60_000;

/** Кусок строки: текст и выделен ли он (число — моно, ярче). */
export interface Part {
  t: string;
  b?: boolean;
  /** Узкая отбивка (моно-число и единица: «57 BB»). */
  gs?: boolean;
}

/** «1 ч 08 мин» / «28 мин» кусками: числа выделены. */
export function durationParts(minutes: number): Part[] {
  const m = Math.max(0, Math.floor(minutes));
  if (m >= 60) {
    return [
      { t: String(Math.floor(m / 60)), b: true },
      { t: `${NBSP}ч ` },
      { t: String(m % 60).padStart(2, '0'), b: true },
      { t: `${NBSP}мин` },
    ];
  }
  return [{ t: String(m), b: true }, { t: `${NBSP}мин` }];
}

/** Строка целиком (подпись для скринридера, тесты): узкая отбивка — неразрывным пробелом. */
export function partsText(parts: readonly Part[]): string {
  return parts.map((p) => (p.gs ? NBSP : p.t)).join('');
}

/** Минуты до закрытия ребаев — вверх, как часы («ещё 5 мин» до самого закрытия). */
function minutesUp(ms: number): number {
  return Math.ceil(ms / MINUTE_MS - 1e-6);
}

export type RebuyTone = 'quiet' | 'hot' | 'signal' | 'closed';

export interface RebuyView {
  tone: RebuyTone;
  parts: Part[];
}

/** Ребаи закрываются: сигнал рамкой за столько минут. */
export const REBUY_SIGNAL_MIN = 5;
/** Строка ребаев полностью — в последние столько минут. */
export const REBUY_FULL_MIN = 30;

/**
 * Строка ребаев под блайндами — коротко: «Ребаи · ещё 1 ч 08 мин». В последние 30 минут —
 * полностью («Ребаи — до конца этого уровня · ещё 28 мин»), за 5 минут — сигнал рамкой
 * («Ребаи закрываются · ещё 4 мин»), потом «Ребаи закрыты». lift — заставка смены уровня: новый
 * уровень — последний с ребаями, строка встаёт полностью вместе с блайндами.
 */
export function rebuyView(format: TournamentFormat, state: EveningState, lift = false): RebuyView {
  const win = rebuyWindow(format, state);
  if (win.kind === 'closed') return { tone: 'closed', parts: [{ t: 'Ребаи закрыты' }] };
  if (win.kind === 'whole_game') return { tone: 'quiet', parts: [{ t: 'Ребаи · всю игру' }] };
  if (win.kind === 'not_started')
    return { tone: 'quiet', parts: [{ t: `Ребаи · до конца ${win.untilLevel}-го уровня` }] };
  const thisLevel = state.timer.levelIndex === lastRebuyLevelIndex(format);
  const until = thisLevel ? 'до конца этого уровня' : `до конца ${win.untilLevel}-го уровня`;
  if (win.msLeft === null)
    return { tone: thisLevel ? 'hot' : 'quiet', parts: [{ t: `Ребаи — ${until}` }] };
  const m = minutesUp(win.msLeft);
  if (m <= 0) return { tone: 'closed', parts: [{ t: 'Ребаи закрыты' }] };
  if (lift && thisLevel)
    return { tone: 'hot', parts: [{ t: `Ребаи — ${until} · ещё ` }, ...durationParts(m)] };
  if (m <= REBUY_SIGNAL_MIN)
    return {
      tone: 'signal',
      parts: [{ t: 'Ребаи закрываются · ещё ' }, { t: String(m), b: true }, { t: `${NBSP}мин` }],
    };
  if (m <= REBUY_FULL_MIN)
    return { tone: 'hot', parts: [{ t: `Ребаи — ${until} · ещё ` }, ...durationParts(m)] };
  return { tone: 'quiet', parts: [{ t: 'Ребаи · ещё ' }, ...durationParts(m)] };
}

/** «Средний стек 57 BB · игра идёт 2 ч 12 мин»; без стека — «Игра идёт 2 ч 12 мин». */
export function quietParts(state: EveningState): Part[] {
  const played = durationParts(Math.floor(state.timer.totalElapsedMs / MINUTE_MS));
  const avg = averageStackBb(state);
  if (avg === null) return [{ t: 'Игра идёт ' }, ...played];
  return [
    { t: 'Средний стек ' },
    { t: formatBbValue(avg), b: true },
    { t: '', gs: true },
    { t: 'BB', b: true },
    { t: ' · игра идёт ' },
    ...played,
  ];
}

/** Призовые мелко: «1-е 2 800 ₽ / 2-е 1 200 ₽» — суммы домена (payoutsFor). */
export function prizeParts(
  format: TournamentFormat,
  state: EveningState,
): { place: string; rub: string }[] {
  return payoutsFor(format, state.prizePoolRub, state.joinOrder.length).map((rub, i) => ({
    place: `${i + 1}-е`,
    rub: `${formatNumber(rub)}${NBSP}₽`,
  }));
}

export type ClockMode = 'countdown' | 'last' | 'counting' | 'paused';

export interface LevelLine {
  /** «Уровень 4 из 8». */
  label: string;
  level: number;
  total: number;
  /** Хвост строки: «· последняя минута», «· раздач 3 из 10», «· стоим 6 мин»… */
  note: string | null;
  /** Хвост — сигналом (critical): последняя минута, перерыв вышел. */
  alarm: boolean;
  /** Хвост — акцентом: часы стоят (пауза, перерыв). */
  hot: boolean;
}

/**
 * Строка над часами: «Уровень 4 из 8» и что сейчас важно про часы. Последняя минута уровня по
 * времени — «последняя минута» (critical); уровень по раздачам или вылетам — счёт («раздач 3 из 10»);
 * последний уровень — «последний, идёт»; пауза — «стоим 6 мин», перерыв — «продолжаем через 07:12» /
 * «пора продолжать» (critical).
 */
export function levelLine(
  format: TournamentFormat,
  state: EveningState,
  nowMs: number,
  pausedMs: number | null,
): LevelLine {
  const total = format.levels.length;
  const level = Math.min(state.timer.levelIndex + 1, total);
  const base = { label: `Уровень ${level} из ${total}`, level, total, hot: false };
  const t = state.timer;
  if (t.status === 'paused') {
    const brk = breakView(state, nowMs);
    if (brk) return { ...base, note: breakLine(brk), alarm: brk.due, hot: !brk.due };
    return {
      ...base,
      note: pausedMs === null ? 'часы стоят' : `стоим ${minutesText(pausedMs)}`,
      alarm: false,
      hot: true,
    };
  }
  if (state.nextLevel === null) return { ...base, note: 'последний, идёт', alarm: false };
  const trig = state.currentLevel.trigger;
  if (trig.type === 'hands')
    return { ...base, note: `раздач ${t.handsInLevel} из ${trig.count}`, alarm: false };
  if (trig.type === 'eliminations')
    return { ...base, note: `вылетов ${t.bustsInLevel} из ${trig.count}`, alarm: false };
  if (finalMinute(state)) return { ...base, note: 'последняя минута', alarm: true };
  return { ...base, note: null, alarm: false };
}

/** «меньше минуты», «6 мин», «1 ч 5 мин». */
function minutesText(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / MINUTE_MS);
  if (m === 0) return 'меньше минуты';
  if (m < 60) return `${m}${NBSP}мин`;
  return `${Math.floor(m / 60)}${NBSP}ч ${m % 60}${NBSP}мин`;
}

/** Последняя минута уровня по времени: часы идут, следующий уровень есть, осталось ≤ 59 с. */
export function finalMinute(state: EveningState): boolean {
  const t = state.timer;
  const left = t.levelRemainingMs;
  return (
    t.status === 'running' &&
    !state.finished &&
    state.currentLevel.trigger.type === 'time' &&
    state.nextLevel !== null &&
    left !== null &&
    left > 0 &&
    left <= 59_000
  );
}

/** Режим часов: отсчёт, последний уровень (идёт), уровень не по времени (идёт), пауза. */
export function clockMode(state: EveningState): ClockMode {
  if (state.timer.status === 'paused') return 'paused';
  if (state.nextLevel === null) return 'last';
  if (state.timer.levelRemainingMs === null) return 'counting';
  return 'countdown';
}

/** Блайнды флапами: «50/100» (неразрывные пробелы разрядов — узкие ячейки). */
export function blindsText(level: { sb: number; bb: number }): string {
  return formatBlinds({ sb: level.sb, bb: level.bb });
}

/** «дальше 75/150» / «последний уровень». */
export function nextText(state: EveningState): { label: string; value: string | null } {
  return state.nextLevel
    ? { label: 'дальше', value: blindsText(state.nextLevel) }
    : { label: 'больше не растут', value: null };
}

/** Анте уровня строкой или null. */
export function anteText(state: EveningState): string | null {
  const ante = state.currentLevel.ante;
  return ante ? formatNumber(ante) : null;
}
