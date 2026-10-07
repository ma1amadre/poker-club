// Вкладка «Моменты» истории: группировка моментов по вечерам и голосования, которые ещё идут.
// Победителей номинаций и «лучший голос» выбирает домен (clubMoments по clubFeedInput).
import type { Moment } from '@domain/feed.ts';
import type { Evening } from '../../shared/api';
import { votingPhase } from '../../shared/lib';

export type DatedMoment = Moment & { at: string };

export interface MomentGroup {
  eveningId: string;
  /** Дата вечера (summary.date); null — итога нет (в моменты такой вечер не попадает). */
  date: string | null;
  moments: DatedMoment[];
}

/**
 * Моменты по вечерам в порядке домена (новые сверху): вечер — одна группа, внутри — порядок
 * номинаций. Группы идут в порядке первого момента вечера.
 */
export function groupMoments(
  moments: readonly DatedMoment[],
  dateOf: (eveningId: string) => string | undefined,
): MomentGroup[] {
  const groups = new Map<string, MomentGroup>();
  for (const m of moments) {
    let group = groups.get(m.eveningId);
    if (!group) {
      group = { eveningId: m.eveningId, date: dateOf(m.eveningId) ?? null, moments: [] };
      groups.set(m.eveningId, group);
    }
    group.moments.push(m);
  }
  return [...groups.values()];
}

/** Вечера, где голосование ещё идёт (фаза как у cast_vote): ближнее закрытие — первым. */
export function openVotings<E extends Pick<Evening, 'id' | 'status' | 'voting_closes_at'>>(
  evenings: readonly E[],
  nowMs: number,
): E[] {
  return evenings
    .filter((e) => votingPhase(e, nowMs) === 'open')
    .sort((a, b) => Date.parse(a.voting_closes_at ?? '') - Date.parse(b.voting_closes_at ?? ''));
}
