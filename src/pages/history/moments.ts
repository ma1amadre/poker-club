// Вкладка «Моменты» истории: группировка моментов по вечерам и голосования, которые ещё идут.
// Победителей номинаций и «лучший голос» выбирает домен (clubMoments по clubFeedInput).
import type { AllIn } from '@domain/allins.ts';
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

export interface MomentEvening extends MomentGroup {
  /** Олл-ины вечера (eveningAllIns); нет — пусто. */
  allIns: readonly AllIn[];
}

/**
 * Вечера вкладки «Моменты»: с моментами или с олл-инами, в порядке истории (новые сверху — как
 * evenings). Вечер без итога (не сведён) и без моментов не показывается.
 */
export function momentEvenings(
  groups: readonly MomentGroup[],
  evenings: readonly Pick<Evening, 'id' | 'scheduled_at'>[],
  allInsByEvening: ReadonlyMap<string, readonly AllIn[]>,
): MomentEvening[] {
  const byId = new Map(groups.map((g) => [g.eveningId, g]));
  const out: MomentEvening[] = [];
  for (const e of evenings) {
    const group = byId.get(e.id);
    const allIns = allInsByEvening.get(e.id) ?? [];
    if (!group && allIns.length === 0) continue;
    out.push({
      eveningId: e.id,
      date: group?.date ?? e.scheduled_at,
      moments: group?.moments ?? [],
      allIns,
    });
    byId.delete(e.id);
  }
  // Моменты вечера, которого нет в списке (такого не бывает: моменты — из той же истории), — в конец.
  for (const g of byId.values()) out.push({ ...g, allIns: [] });
  return out;
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
