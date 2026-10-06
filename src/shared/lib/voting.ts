// Голосование «звёзды вечера»: фаза по тем же правилам, что у cast_vote, и участники вечера по
// определению is_participant. Используют главная и экран голосования.
import type { EveningEvent, PlayerId } from '@domain/types.ts';
import type { EveningStatus } from '../api/types';

// --- Фаза голосования ------------------------------------------------------------------------

/** pending — игра не окончена, open — идёт голосование, closed — итоги открыты всем. */
export type VotingPhase = 'pending' | 'open' | 'closed';

export interface VotingEveningLike {
  status: EveningStatus;
  voting_closes_at: string | null;
}

/**
 * Фаза по тем же правилам, что у cast_vote: голосовать можно в завершённом вечере, пока
 * now < voting_closes_at. После закрытия RLS открывает чужие голоса.
 */
export function votingPhase(evening: VotingEveningLike, nowMs: number): VotingPhase {
  const finished = evening.status === 'finished' || evening.status === 'settled';
  const closesMs = evening.voting_closes_at ? Date.parse(evening.voting_closes_at) : Number.NaN;
  if (!finished || Number.isNaN(closesMs)) return 'pending';
  return nowMs < closesMs ? 'open' : 'closed';
}

// --- Участники -------------------------------------------------------------------------------

/**
 * Участники вечера по определению is_participant (003_rpc.sql): есть не отменённый join.
 * Порядок — порядок входа; повторы не дублируются.
 */
export function participantIds(events: readonly EveningEvent[]): PlayerId[] {
  const out: PlayerId[] = [];
  const seen = new Set<PlayerId>();
  for (const event of [...events].sort((a, b) => a.id - b.id)) {
    if (event.voided || event.type !== 'join') continue;
    const id = (event.payload as { playerId?: unknown }).playerId;
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
