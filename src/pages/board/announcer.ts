// Детектор объявлений голоса табло: чистая функция (prev, next) → что сказать. Кадр — журнал с
// сервера и replay на момент nowMs; табло строит кадр раз в секунду (useNow) и сравнивает с прошлым.
//
// Правила:
// - объявляются только события, которых в прошлом кадре не было (табло не зачитывает историю при
//   открытии: первый кадр — точка отсчёта), и только свежие — `at` не старше FRESH_EVENT_MS
//   (табло, потерявшее связь на полчаса, не вываливает всё накопленное разом);
// - события — в порядке журнала: старт таймера, пауза (кроме служебной паузы перед finish — её
//   пишет add_event), продолжение, нокаут (bust; voided board_state не отдаёт), победитель (finish);
// - новый уровень и закрытие ребаев — по состоянию replay: уровень вырос (таймер, level_next,
//   триггер по вылетам или раздачам), ребаи были открыты и закрылись (не из-за finish); фраза
//   уровня встаёт на место level_next в журнале, иначе — после событий; ребаи — сразу за ней;
// - «Минута до повышения» — уровень по времени, таймер идёт, следующий уровень есть, остаток
//   пересёк 60 с в этом шаге и не ушёл ниже 45 с (шаг не запоздал);
// - окно ребаев (аудит 07.10.2026): «Последний уровень ребаев» — сразу за фразой уровня (или за
//   «Поехали»), если начался уровень номер rebuyUntilLevel, в конце которого ребаи закроются (ребаи
//   не на всю игру); «Пять минут до закрытия ребаев» — игровое время до закрытия (rebuyWindow, как
//   «ещё N мин» на экранах) пересекло 5 минут в этом шаге при идущем таймере и не ушло ниже 4:45;
// - отмена не объявляется: если из журнала пропало событие (void), изменения состояния в этом
//   шаге молчат — кроме уровня, поднятого новым level_next;
// - один раз на уровень: кадр помнит, что уже сказано (heard) — наибольший уровень, уровень с
//   отзвучавшей минутой, предупреждение о пяти минутах, закрытие ребаев. Табло узнаёт о паузе с задержкой опроса: replay успевает
//   перевести уровень через границу, а запоздавшая пауза откатывает его обратно — после
//   «Продолжаем» граница пересекается снова, но второй раз не объявляется. Память сбрасывается к
//   текущему состоянию только настоящим откатом: новый level_prev, timer_start или отмена (void).
import type { EveningEvent, EveningState, TournamentFormat } from '@domain/types.ts';
import type { Announcement } from '@domain/voice.ts';
import { rebuyWindow } from '../evening/lib';
import { lastRebuyLevelIndex, REBUYS_SOON_MS } from './boardView';

/** Что уже сказано на этом табло (или было на нём при открытии) — чтобы не повторять. */
export interface VoiceHeard {
  /** Наибольший уровень (levelIndex), который объявлен или был на табло. */
  level: number;
  /** Уровень, о минуте до конца которого уже сказано; −1 — ни о каком. */
  minute: number;
  /** «Пять минут до закрытия ребаев» уже сказано (или при открытии до закрытия было меньше). */
  rebuysSoon: boolean;
  /** «Ребаи закрыты» уже сказано (или ребаи были закрыты при открытии). */
  rebuysClosed: boolean;
}

export interface VoiceFrame {
  /** Серверное «сейчас» кадра, мс. */
  nowMs: number;
  /** id всех событий журнала из ответа сервера (board_state отдаёт только неотменённые). */
  eventIds: ReadonlySet<number>;
  /** Принятые replay события (replayLog.applied). */
  applied: readonly EveningEvent[];
  state: EveningState;
  /** Память сказанного: у нового кадра — по его состоянию, дальше её ведёт voiceStep. */
  heard: VoiceHeard;
}

/** Событие старше — уже не новость (табло долго было без связи). */
export const FRESH_EVENT_MS = 90_000;
const MINUTE_MS = 60_000;
/** Предупреждение, пойманное позже 45 с до конца уровня, уже неправда — молчим. */
const MINUTE_LATE_MS = 15_000;

/** Игровое время до закрытия ребаев или null — ребаи закрыты, открыты всю игру, срок не посчитать. */
function rebuysLeftMs(format: TournamentFormat, state: EveningState): number | null {
  const win = rebuyWindow(format, state);
  return win.kind === 'open' ? win.msLeft : null;
}

/** Память «как будто табло только что открыли»: всё, что уже на экране, — сказано. */
function heardNow(format: TournamentFormat, state: EveningState): VoiceHeard {
  const t = state.timer;
  const started = t.status !== 'not_started';
  const rebuysLeft = rebuysLeftMs(format, state);
  return {
    level: t.levelIndex,
    minute:
      started && t.levelRemainingMs !== null && t.levelRemainingMs <= MINUTE_MS ? t.levelIndex : -1,
    rebuysSoon:
      started && (!state.rebuysOpen || (rebuysLeft !== null && rebuysLeft <= REBUYS_SOON_MS)),
    rebuysClosed: started && !state.rebuysOpen,
  };
}

export function voiceFrame(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  replayed: { state: EveningState; applied: readonly EveningEvent[] },
  nowMs: number,
): VoiceFrame {
  return {
    nowMs,
    eventIds: new Set(events.filter((e) => !e.voided).map((e) => e.id)),
    applied: replayed.applied,
    state: replayed.state,
    heard: heardNow(format, replayed.state),
  };
}

function isFresh(event: EveningEvent, nowMs: number): boolean {
  const at = Date.parse(event.at);
  return Number.isFinite(at) && nowMs - at <= FRESH_EVENT_MS;
}

function bustOf(event: EveningEvent): { victim: string; by: string[] } | null {
  const payload = event.payload as { playerId?: unknown; by?: unknown };
  if (typeof payload.playerId !== 'string') return null;
  const by = Array.isArray(payload.by)
    ? (payload.by as unknown[]).filter((id): id is string => typeof id === 'string')
    : [];
  return { victim: payload.playerId, by };
}

/** Что сказать при переходе prev → next (см. voiceStep). */
export function detectAnnouncements(
  format: TournamentFormat,
  prev: VoiceFrame,
  next: VoiceFrame,
): Announcement[] {
  return voiceStep(format, prev, next).say;
}

/**
 * Шаг детектора: что сказать при переходе prev → next и кадр next с памятью сказанного — его
 * табло передаёт как prev следующему шагу. Память ведётся и при выключенном голосе.
 */
export function voiceStep(
  format: TournamentFormat,
  prev: VoiceFrame,
  next: VoiceFrame,
): { say: Announcement[]; frame: VoiceFrame } {
  const out: Announcement[] = [];
  const removed = [...prev.eventIds].some((id) => !next.eventIds.has(id));
  const added = next.applied.filter((e) => !prev.eventIds.has(e.id));
  const fresh = added.filter((e) => isFresh(e, next.nowMs));
  // Настоящий откат или перезапуск — память сказанного сбрасывается к текущему состоянию.
  // Запоздавшая пауза откатывает replay без такого события — память остаётся.
  const reset = removed || added.some((e) => e.type === 'level_prev' || e.type === 'timer_start');
  const heard = prev.heard;
  const lastRebuyLevel = lastRebuyLevelIndex(format);

  let levelSlot = -1;
  fresh.forEach((event, i) => {
    switch (event.type) {
      case 'timer_start': {
        const first = format.levels[0];
        if (first) out.push({ kind: 'start', level: first });
        // Ребаи только на первом уровне — об этом сразу за «Поехали».
        if (
          first &&
          lastRebuyLevel === 0 &&
          next.state.timer.levelIndex === 0 &&
          next.state.rebuysOpen
        )
          out.push({ kind: 'rebuys_last_level' });
        return;
      }
      case 'timer_pause':
        // add_event пишет паузу перед finish идущего вечера — объявим только победителя.
        if (!fresh.slice(i + 1).some((e) => e.type === 'finish')) out.push({ kind: 'pause' });
        return;
      case 'timer_resume':
        out.push({ kind: 'resume' });
        return;
      case 'level_next':
        if (levelSlot < 0) levelSlot = out.length;
        return;
      case 'bust': {
        const bust = bustOf(event);
        if (bust) out.push({ kind: 'knockout', victim: bust.victim, by: bust.by });
        return;
      }
      case 'finish':
        out.push({ kind: 'winner', winner: next.state.places[0] ?? null });
        return;
      default:
        return;
    }
  });

  const t0 = prev.state.timer;
  const t1 = next.state.timer;
  const running = t1.status !== 'not_started' && !next.state.finished;
  const trusted = !removed || levelSlot >= 0;
  const fromIndex = t0.status === 'not_started' ? 0 : t0.levelIndex;

  // Уровень, о котором уже сказано: откат replay из-за запоздавшей паузы его не «отменяет».
  const heardLevel = reset ? fromIndex : Math.max(fromIndex, heard.level);
  const derived: Announcement[] = [];
  if (running && trusted && t1.levelIndex > heardLevel) {
    derived.push({ kind: 'level', level: next.state.currentLevel });
    if (t1.levelIndex === lastRebuyLevel && next.state.rebuysOpen)
      derived.push({ kind: 'rebuys_last_level' });
  }
  const rebuysClosed =
    running &&
    trusted &&
    prev.state.rebuysOpen &&
    !next.state.rebuysOpen &&
    (reset || !heard.rebuysClosed);
  if (rebuysClosed) derived.push({ kind: 'rebuys_closed' });
  if (derived.length > 0) {
    if (levelSlot >= 0) out.splice(levelSlot, 0, ...derived);
    else out.push(...derived);
  }

  const left0 = t0.levelRemainingMs;
  const left1 = t1.levelRemainingMs;
  const minute =
    !reset &&
    running &&
    t1.status === 'running' &&
    t0.status !== 'not_started' &&
    t1.levelIndex === t0.levelIndex &&
    t1.levelIndex !== heard.minute &&
    next.state.currentLevel.trigger.type === 'time' &&
    next.state.nextLevel !== null &&
    left0 !== null &&
    left1 !== null &&
    left0 > MINUTE_MS &&
    left1 <= MINUTE_MS &&
    left1 > MINUTE_MS - MINUTE_LATE_MS;
  if (minute) out.push({ kind: 'minute' });

  // Пять минут до закрытия ребаев: игровое время до закрытия пересекло порог в этом шаге (часы
  // идут, ребаи открыты), шаг не запоздал. Один раз: откат запоздавшей паузы его не повторит.
  const soonLeft0 = rebuysLeftMs(format, prev.state);
  const soonLeft1 = rebuysLeftMs(format, next.state);
  const soon =
    !reset &&
    !heard.rebuysSoon &&
    running &&
    t1.status === 'running' &&
    t0.status !== 'not_started' &&
    soonLeft0 !== null &&
    soonLeft1 !== null &&
    soonLeft0 > REBUYS_SOON_MS &&
    soonLeft1 <= REBUYS_SOON_MS &&
    soonLeft1 > REBUYS_SOON_MS - MINUTE_LATE_MS;
  if (soon) out.push({ kind: 'rebuys_soon' });

  const base = reset ? heardNow(format, next.state) : heard;
  return {
    say: out,
    frame: {
      ...next,
      heard: {
        level: Math.max(base.level, t1.levelIndex),
        minute: minute ? t1.levelIndex : base.minute,
        rebuysSoon: base.rebuysSoon || soon,
        rebuysClosed: base.rebuysClosed || rebuysClosed,
      },
    },
  };
}
