// Правка записи на месте (миграция 022): помощники пульта поверх replay.
//
// Поправка 'amend' {eventId, stacks | by} исправляет у более ранней записи кратность (вход, ребай)
// или выбивших (вылет) и встаёт на место исходной: replay применяет её в позиции исходной записи,
// поэтому порядок мест, ребаи и уровни после неё не сдвигаются (в отличие от «отменить и записать
// заново» — новая запись встала бы в конец журнала). Отмена поправки возвращает прежнее значение.
// Кратность и выбившие не участвуют ни в одном правиле приёма записей: поправка принятой записи
// меняет только деньги (кратность) и нокауты (выбившие), приём остальных записей она не трогает.
// Починка непринятой записи (вылет с выбывшим выбившим) — другое дело: запись вступает в силу в
// своей позиции, и записи после неё журнал может принять иначе (повторно записанный вылет того же
// игрока станет «Не принято», ребай после него вступит в силу, места и «Игра окончена» сдвинутся).
// Такую правку canAmend не пропускает (amendImpact) — replay её по-прежнему читает, как раньше.
import { readAmend, readStacks, replayLog, type EventDraft, type ReplayLog } from './replay.ts';
import type { AmendPayload, EveningEvent, PlayerId, TournamentFormat } from './types.ts';

export type AmendField = 'stacks' | 'by';

/** Что исправляется у записи: кратность у входа и ребая, выбившие у вылета; иначе null. */
export function amendField(ev: Pick<EveningEvent, 'type'>): AmendField | null {
  if (ev.type === 'join' || ev.type === 'rebuy') return 'stacks';
  if (ev.type === 'bust') return 'by';
  return null;
}

/** Текущее значение записи: кратность или выбившие — из того, что применил replay, иначе исходное. */
export type AmendValue = { stacks: number } | { by: PlayerId[] };

function byOf(payload: unknown): PlayerId[] {
  const by = (payload as { by?: unknown } | null)?.by;
  return Array.isArray(by) ? by.filter((x): x is string => typeof x === 'string') : [];
}

function valueOf(ev: EveningEvent): AmendValue | null {
  const field = amendField(ev);
  if (field === 'stacks') return { stacks: readStacks(ev.payload) ?? 1 };
  if (field === 'by') return { by: byOf(ev.payload) };
  return null;
}

/**
 * Значение записи сейчас: с поправкой в силе (как её применил replay) или исходное, если поправок
 * нет или запись журнал не принял. null — запись не исправляется (или её нет).
 */
export function currentAmendValue(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  eventId: number,
  nowMs: number,
): AmendValue | null {
  const raw = events.find((e) => e.id === eventId);
  if (!raw) return null;
  const applied = replayLog(format, events, nowMs).applied.find((e) => e.id === eventId);
  return valueOf(applied ?? raw);
}

/** Черновик поправки для отправки (add_event 'amend'). */
export function amendDraft(eventId: number, value: AmendValue): EventDraft {
  const payload: AmendPayload =
    'stacks' in value ? { eventId, stacks: value.stacks } : { eventId, by: [...value.by] };
  return { type: 'amend', payload };
}

function sameValue(a: AmendValue, b: AmendValue): boolean {
  if ('stacks' in a) return 'stacks' in b && a.stacks === b.stacks;
  if (!('by' in b)) return false;
  // Порядок выбивших ни на что не влияет (денег за голову нет): тот же набор — та же запись.
  const x = [...new Set(a.by)].sort();
  const y = [...new Set(b.by)].sort();
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/** Журнал до правки и с правкой в хвосте (id — следующий за последним, время — nowMs). */
function withAmend(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  patch: AmendPayload,
  nowMs: number,
): { before: ReplayLog; after: ReplayLog; amendId: number } {
  const amendId = events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  const draft = amendDraft(patch.eventId, 'stacks' in patch ? patch : { by: patch.by });
  const tail: EveningEvent = {
    id: amendId,
    type: draft.type,
    payload: draft.payload,
    at: new Date(nowMs).toISOString(),
    voided: false,
  };
  return {
    before: replayLog(format, events, nowMs),
    after: replayLog(format, [...events, tail], nowMs),
    amendId,
  };
}

/** Что правка заденет, кроме самой записи: приём других записей журнала и итог вечера. */
export interface AmendImpact {
  /** Другие записи, которые журнал сейчас не принимает, а с правкой примет (id по порядку). */
  revived: number[];
  /** Принятые сейчас записи, которые с правкой журнал принимать перестанет, — с причиной. */
  rejected: { eventId: number; message: string }[];
  /** Завершённый вечер с правкой перестанет быть завершённым или в нём поменяются места. */
  resultChanged: boolean;
}

function impactOf(
  events: readonly EveningEvent[],
  targetId: number,
  { before, after, amendId }: ReturnType<typeof withAmend>,
): AmendImpact {
  const was = new Set(before.applied.map((e) => e.id));
  const now = new Set(after.applied.map((e) => e.id));
  const errorsAfter = new Map(after.state.errors.map((e) => [e.eventId, e.message]));
  const others = events
    .filter((e) => !e.voided && e.id !== targetId && e.id !== amendId)
    .sort((a, b) => a.id - b.id);
  const samePlaces =
    before.state.places.length === after.state.places.length &&
    before.state.places.every((id, i) => after.state.places[i] === id);
  return {
    revived: others.filter((e) => !was.has(e.id) && now.has(e.id)).map((e) => e.id),
    rejected: others.flatMap((e) =>
      was.has(e.id) && !now.has(e.id)
        ? [{ eventId: e.id, message: errorsAfter.get(e.id) ?? 'Запись не принята' }]
        : [],
    ),
    resultChanged: before.state.finished && (!after.state.finished || !samePlaces),
  };
}

/**
 * Что правка заденет, кроме самой записи (для шторки: какие записи и почему). У принятой записи
 * всегда пусто — кратность и выбившие в правилах приёма не участвуют; задеть другие записи может
 * только починка непринятой.
 */
export function amendImpact(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  payload: AmendPayload,
  nowMs: number,
): AmendImpact {
  const patch = readAmend(payload);
  if (patch === null) return { revived: [], rejected: [], resultChanged: false };
  return impactOf(events, patch.eventId, withAmend(format, events, patch, nowMs));
}

export function hasAmendImpact(impact: AmendImpact): boolean {
  return impact.revived.length > 0 || impact.rejected.length > 0 || impact.resultChanged;
}

/** Отказ правки, которая задела бы другие записи (canAmend). */
export const AMEND_IMPACT_ERROR =
  'Правка заденет другие записи журнала — так исправить нельзя. Отмени непринятую запись и, если нужно, запиши её заново';

/**
 * Можно ли так исправить запись: текст отказа или null. Отказ — форма поправки неверна, запись не
 * найдена, отменена или не исправляется, значение то же, что сейчас, исправленная запись не
 * проходит правила в своей позиции (replay журнала с поправкой в хвосте — тексты те же, что даст
 * replay) или правка задевает другие записи: меняет их приём или места завершённого вечера
 * (amendImpact) — правка исправляет только саму запись.
 */
export function canAmend(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  payload: AmendPayload,
  nowMs: number,
): string | null {
  const patch = readAmend(payload);
  if (patch === null)
    return 'Правка: нужна исправляемая запись и одно новое значение — кратность или выбившие';
  const target = events.find((e) => e.id === patch.eventId);
  if (!target) return 'Правка: исправляемой записи нет в журнале';
  if (target.voided) return 'Правка: исправляемая запись отменена';
  const now = currentAmendValue(format, events, target.id, nowMs);
  if (now === null) return 'Правка: исправить можно только вход, ребай или вылет';
  const next: AmendValue = 'stacks' in patch ? { stacks: patch.stacks } : { by: patch.by };
  if (sameValue(now, next)) return 'Правка ничего не меняет';
  const logs = withAmend(format, events, patch, nowMs);
  const own = logs.after.state.errors.find((e) => e.eventId === logs.amendId);
  if (own) return own.message;
  return hasAmendImpact(impactOf(events, target.id, logs)) ? AMEND_IMPACT_ERROR : null;
}
