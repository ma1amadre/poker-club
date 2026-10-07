// Лента и моменты из истории клуба: вход домена (clubFeedInput) и «сейчас» для моментов. Чистый
// модуль без сети — тесты берут его напрямую.
import type { ClubFeedInput, MomentVote } from '@domain/feed.ts';
import type { ClubHistory } from './history';

/**
 * «Сейчас» для моментов голосования (clubMoments, лента): не позже загрузки истории. Голосование,
 * закрывшееся после загрузки, в кеше представлено только своими голосами — его моменты были бы
 * случайными; они появятся после перезапроса, который useClubHistory делает сам.
 */
export function momentsNowMs(history: Pick<ClubHistory, 'fetchedAtMs'>, nowMs: number): number {
  return Math.min(nowMs, history.fetchedAtMs);
}

/** Вход clubFeed / clubEvents / clubMoments домена из истории клуба: строки evenings и все голоса. */
export function clubFeedInput(
  history: Pick<ClubHistory, 'achievementInput' | 'evenings' | 'votesByEvening'>,
): ClubFeedInput {
  const votes: MomentVote[] = [];
  for (const list of history.votesByEvening.values()) {
    for (const v of list) {
      votes.push({
        eveningId: v.evening_id,
        voterId: v.voter_id,
        category: v.category,
        nomineeId: v.nominee_id,
        caption: v.caption,
        photoPath: v.photo_path,
        createdAt: v.created_at,
      });
    }
  }
  return {
    ...history.achievementInput,
    evenings: history.evenings.map((e) => ({
      eveningId: e.id,
      finishedAt: e.finished_at,
      votingClosesAt: e.voting_closes_at,
    })),
    votes,
  };
}

/** Ближайшее закрытие голосования после загрузки истории (мс) или null. */
export function nextVotingCloseMs(
  history: Pick<ClubHistory, 'evenings' | 'fetchedAtMs'>,
): number | null {
  let next: number | null = null;
  for (const e of history.evenings) {
    if (!e.voting_closes_at) continue;
    const ms = Date.parse(e.voting_closes_at);
    if (Number.isNaN(ms) || ms <= history.fetchedAtMs) continue;
    if (next === null || ms < next) next = ms;
  }
  return next;
}
