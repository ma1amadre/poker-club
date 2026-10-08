// Напоминание о голосовании (миграция 021): за VOTING_REMINDER_HOURS часа до закрытия голосования
// вечера cron-tick пишет в группу «Голосование закрывается в 18:00 — проголосовали 3 из 7» с кнопкой.
// Один раз на закрытие голосования (evenings.voting_reminder_posted_at; новое закрытие после отмены
// и повторного finish снимает отметку — триггер миграции 021). Чистые функции без БД — их проверяет
// vitest (votingReminder.test.ts), применяет cron-tick, текст поста — votingReminderPost в messages.ts.

const HOUR_MS = 60 * 60 * 1000;

/** За сколько часов до закрытия голосования напоминать. */
export const VOTING_REMINDER_HOURS = 3;
/**
 * Меньше этого до закрытия — не напоминаем, только отмечаем: по кнопке человек успел бы увидеть
 * «Голосование по этому вечеру закрыто». В обычной работе не срабатывает — cron-tick идёт раз в
 * 15 минут, и напоминание уходит за 2 ч 45 мин – 3 ч; это на случай, если будильник стоял.
 */
export const VOTING_REMINDER_MIN_LEFT_MS = 30 * 60 * 1000;

export interface VotingReminderEveningLike {
  status: string;
  voting_closes_at: string | null;
  results_posted_at: string | null;
  voting_reminder_posted_at: string | null;
}

/**
 * Что делать с вечером на этом тике:
 * - none          — не время (окно не открыто или голосование закрыто) или напоминание уже ушло;
 * - wait_results  — окно открыто, а итогов вечера в группе ещё нет: напоминание не идёт впереди них;
 * - fresh_results — итоги ушли уже внутри окна: в них и так сказано, до какого времени голосовать —
 *                   отметить без поста (как «свежий анонс» у поста дня игры);
 * - too_late      — до закрытия меньше VOTING_REMINDER_MIN_LEFT_MS: отметить без поста;
 * - post          — посчитать, кто проголосовал, и написать (turnoutDecision).
 */
export type VotingReminderDecision =
  'none' | 'wait_results' | 'fresh_results' | 'too_late' | 'post';

export function decideVotingReminder(
  evening: VotingReminderEveningLike,
  nowMs: number,
): VotingReminderDecision {
  if (evening.status !== 'finished' && evening.status !== 'settled') return 'none';
  if (evening.voting_reminder_posted_at !== null || evening.voting_closes_at === null)
    return 'none';
  const closesMs = Date.parse(evening.voting_closes_at);
  if (!Number.isFinite(closesMs) || closesMs <= nowMs) return 'none';
  const windowStartMs = closesMs - VOTING_REMINDER_HOURS * HOUR_MS;
  if (nowMs < windowStartMs) return 'none';
  if (evening.results_posted_at === null) return 'wait_results';
  const resultsMs = Date.parse(evening.results_posted_at);
  if (Number.isFinite(resultsMs) && resultsMs >= windowStartMs) return 'fresh_results';
  if (closesMs - nowMs < VOTING_REMINDER_MIN_LEFT_MS) return 'too_late';
  return 'post';
}

// ---------------------------------------------------------------------------
// Кто может голосовать и кто уже проголосовал
// ---------------------------------------------------------------------------

export interface TurnoutPlayerRow {
  id: string;
  /** bigint: PostgREST отдаёт числом, но не полагаемся. */
  tg_id: number | string | null;
  is_active: boolean;
}

export interface Turnout {
  voted: number;
  eligible: number;
}

/**
 * Голосовать может игрок вечера (действующий join — is_participant), который способен войти в
 * Mini App: активный (current_player_id) и с Telegram (вход только через tg-auth). Гость без Telegram
 * играл, но проголосовать не может — в «из M» его нет. Проголосовал — есть хотя бы один голос в любой
 * номинации; голос игрока, которого с тех пор выключили, не считается, как и он сам.
 */
export function votingTurnout(
  participantIds: readonly string[],
  players: readonly TurnoutPlayerRow[],
  voterIds: readonly string[],
): Turnout {
  const byId = new Map(players.map((p) => [p.id, p]));
  const eligible = new Set(
    participantIds.filter((id) => {
      const p = byId.get(id);
      return p !== undefined && p.is_active && p.tg_id !== null && String(p.tg_id).trim() !== '';
    }),
  );
  const voted = new Set(voterIds.filter((id) => eligible.has(id)));
  return { voted: voted.size, eligible: eligible.size };
}

/**
 * post — напоминать; all_voted — проголосовали все, кто может, no_voters — голосовать некому:
 * в обоих случаях отметить без поста.
 */
export function turnoutDecision(t: Turnout): 'post' | 'all_voted' | 'no_voters' {
  if (t.eligible === 0) return 'no_voters';
  if (t.voted >= t.eligible) return 'all_voted';
  return 'post';
}
