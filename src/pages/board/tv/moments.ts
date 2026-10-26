// Моменты табло ТВ: что показать заставкой по записям журнала (replay домена), а не по сценарию.
// Чистые функции (тесты — moments.test.ts), исполнение — TvBoard (такты на часах табло).
//
// Правила (как у голоса табло, announcer.ts):
// - первый кадр — точка отсчёта: табло, открытое посреди вечера, историю не разыгрывает;
// - смена уровня — по состоянию replay: уровень вырос (часы, level_next, вылеты или раздачи) выше
//   наибольшего показанного. Назад (level_prev) — без заставки. Табло узнаёт о записях с опозданием
//   опроса (до 3 с) — заставка идёт с того, что пришло;
// - нокаут — новая запись bust (в прошлом кадре её не было), свежая (не старше FRESH_MOMENT_MS) и
//   окончательная: игрок вне игры именно после неё. Вылет и ребай одной пачкой — без заставки;
// - во время олл-ина смена уровня заставкой не идёт (часы в углу перелистываются сами), а нокаут
//   ждёт возврата к столу — так в макете: «возврат → нокаут на столе». Заставка уровня, которая
//   ждала в очереди, когда начался олл-ин, тоже снимается (withoutLevel);
// - нокауты одного кадра — раньше смены уровня: уровень «по вылетам» вырос из-за этого вылета, и
//   зритель сначала видит причину;
// - очередь — одна точка внимания за раз; смены уровня подряд склеиваются в одну заставку
//   («УРОВЕНЬ 6 ИЗ 8» после двух нажатий «Следующий уровень»);
// - вкладка табло была спрятана (часы табло стояли, опрос шёл): по возвращении несвежее из очереди
//   выбрасывается (dropStale) — нокауты десятиминутной давности не разыгрываются. Перед стартом
//   свежесть не проверяется: нокаут после олл-ина законно ждёт возврата к столу дольше 90 с.
import { readShowdownId } from '@domain/showdown.ts';
import type { EveningEvent, EveningState, PlayerId } from '@domain/types.ts';

/** Запись старше — уже не новость (табло было без связи): без заставки. */
export const FRESH_MOMENT_MS = 90_000;

export interface MomentFrame {
  /** id событий журнала (board_state отдаёт только неотменённые). */
  eventIds: ReadonlySet<number>;
  /** Уровень сейчас (с 0) и наибольший показанный. */
  levelIndex: number;
  heardLevel: number;
}

/** at — когда это случилось (мс, часы сервера): нокаут — время записи, уровень — когда табло узнало. */
export type Moment =
  | { kind: 'level'; from: number; to: number; at: number }
  | { kind: 'ko'; eventId: number; victim: PlayerId; by: PlayerId[]; at: number };

export function momentFrame(
  events: readonly EveningEvent[],
  state: EveningState,
  prev?: MomentFrame,
): MomentFrame {
  return {
    eventIds: new Set(events.map((e) => e.id)),
    levelIndex: state.timer.levelIndex,
    heardLevel: prev ? prev.heardLevel : state.timer.levelIndex,
  };
}

function bustOf(e: EveningEvent): { victim: PlayerId; by: PlayerId[] } | null {
  const p = e.payload as { playerId?: unknown; by?: unknown };
  if (typeof p.playerId !== 'string') return null;
  const by = Array.isArray(p.by)
    ? (p.by as unknown[]).filter((x): x is string => typeof x === 'string' && x !== p.playerId)
    : [];
  return { victim: p.playerId, by };
}

export interface MomentInput {
  events: readonly EveningEvent[];
  applied: readonly EveningEvent[];
  state: EveningState;
  nowMs: number;
  /** На экране олл-ин: смена уровня — без заставки. */
  allIn: boolean;
}

/**
 * Шаг детектора: что показать при переходе prev → next и кадр next с памятью показанного. prev null
 * — первый кадр: ничего.
 */
export function detectMoments(
  prev: MomentFrame | null,
  input: MomentInput,
): { moments: Moment[]; frame: MomentFrame } {
  const { events, applied, state, nowMs, allIn } = input;
  const frame = momentFrame(events, state, prev ?? undefined);
  if (!prev) return { moments: [], frame };
  const moments: Moment[] = [];
  const running = state.timer.status !== 'not_started' && !state.finished;

  // Нокауты: новые свежие вылеты, после которых игрок вне игры. Раньше смены уровня того же кадра.
  for (const e of applied) {
    if (e.type !== 'bust' || prev.eventIds.has(e.id)) continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || nowMs - at > FRESH_MOMENT_MS) continue;
    const bust = bustOf(e);
    if (!bust) continue;
    const p = state.players[bust.victim];
    if (!p || p.alive || p.finalBustEventId !== e.id) continue;
    moments.push({ kind: 'ko', eventId: e.id, ...bust, at });
  }

  // Уровень: выше наибольшего показанного — заставка (кроме олл-ина); откат журнала (level_prev,
  // отмена) — память опускается вместе с ним, чтобы следующий подъём снова был заставкой.
  const level = state.timer.levelIndex;
  const rolledBack =
    level < prev.levelIndex &&
    (applied.some(
      (e) => !prev.eventIds.has(e.id) && (e.type === 'level_prev' || e.type === 'timer_start'),
    ) ||
      [...prev.eventIds].some((id) => !frame.eventIds.has(id)));
  if (rolledBack) frame.heardLevel = level;
  if (running && level > frame.heardLevel) {
    if (!allIn) moments.push({ kind: 'level', from: frame.heardLevel, to: level, at: nowMs });
    frame.heardLevel = level;
  }
  return { moments, frame };
}

/** Очередь моментов: смены уровня подряд склеиваются (с первого «от» до последнего «к»). */
export function enqueue(queue: readonly Moment[], add: readonly Moment[]): Moment[] {
  const out = [...queue];
  for (const m of add) {
    if (m.kind === 'level') {
      const i = out.findIndex((x) => x.kind === 'level');
      const prev = i >= 0 ? out[i] : undefined;
      if (prev && prev.kind === 'level') {
        out[i] = {
          kind: 'level',
          from: prev.from,
          to: Math.max(prev.to, m.to),
          at: Math.max(prev.at, m.at),
        };
        continue;
      }
    }
    if (m.kind === 'ko' && out.some((x) => x.kind === 'ko' && x.eventId === m.eventId)) continue;
    out.push(m);
  }
  return out;
}

/** Олл-ин начался: заставка уровня, ждавшая в очереди, не идёт (уровень сменился под олл-ином). */
export function withoutLevel(queue: readonly Moment[]): Moment[] {
  return queue.filter((m) => m.kind !== 'level');
}

/** Вкладка снова видна: несвежее (старше FRESH_MOMENT_MS) уже не новость — без заставки. */
export function dropStale(queue: readonly Moment[], nowMs: number): Moment[] {
  return queue.filter((m) => nowMs - m.at <= FRESH_MOMENT_MS);
}

/**
 * Момент ещё в силе перед показом: нокаут — игрок всё ещё вне игры после той же записи (ребай или
 * отмена — без заставки); уровень — уровень всё ещё выше «от».
 */
export function stillValid(m: Moment, state: EveningState): boolean {
  if (state.finished) return false;
  if (m.kind === 'ko') {
    const p = state.players[m.victim];
    return Boolean(p && !p.alive && p.finalBustEventId === m.eventId);
  }
  return state.timer.levelIndex > m.from;
}

/** Место выбывшего на карточке: известно (ребаи закрыты) — «6-е место», иначе «вне игры». */
export function koPlace(state: EveningState, victim: PlayerId): number | null {
  return state.players[victim]?.place ?? null;
}

/**
 * Развязка олл-ина на экране олл-ина. После ривера банкир отвечает, кто вылетел (или «остаётся за
 * столом»), — запись вылетов и закрытие раздачи ложатся одним действием, и табло узнаёт о них в
 * одном опросе вместе с тем, что раздачи больше нет. Чтобы развязка из макета («6-е место» и флап
 * «ВЫЛЕТ», «остаётся в игре») была видна, а не пропадала со шторкой, экран олл-ина задерживается,
 * если раздачу закрыли записью (showdown_close) уже на ривере. Спрятанная временем раздача (банкир
 * не ответил) или закрытая до ривера — сразу к столу.
 */
export function closedAtRiver(
  showdown: { showdownId: string; board: readonly unknown[] },
  applied: readonly Pick<EveningEvent, 'type' | 'payload'>[],
): boolean {
  if (showdown.board.length < 5) return false;
  return applied.some(
    (e) => e.type === 'showdown_close' && readShowdownId(e.payload) === showdown.showdownId,
  );
}

/**
 * Кто из проигравших раздачу остаётся в игре после ответа банкира: в игре и не вылетал в этой
 * раздаче (вылетел и сразу докупился — тоже «остаётся»: он снова за столом).
 */
export function stayedAfterRiver(
  losers: readonly PlayerId[],
  busted: ReadonlySet<PlayerId>,
  isAlive: (id: PlayerId) => boolean,
): Set<PlayerId> {
  return new Set(losers.filter((id) => !busted.has(id) && isAlive(id)));
}
