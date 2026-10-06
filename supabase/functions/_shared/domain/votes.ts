// Голосование после вечера: рука / блеф / бэд-бит вечера.
import type { PlayerId } from './types.ts';

export type VoteCategory = 'hand' | 'bluff' | 'badbeat';

export const VOTE_CATEGORIES: readonly VoteCategory[] = ['hand', 'bluff', 'badbeat'];

export const VOTE_CATEGORY_META: Record<VoteCategory, { title: string }> = {
  hand: { title: 'Рука вечера' },
  bluff: { title: 'Блеф вечера' },
  badbeat: { title: 'Бэд-бит вечера' },
};

export interface Vote {
  voterId: PlayerId;
  category: VoteCategory;
  nomineeId: PlayerId;
}

export interface VoteResult {
  winners: PlayerId[]; // ничья — несколько победителей; нет голосов — пусто
  counts: Record<PlayerId, number>;
}

export function voteResults(votes: readonly Vote[]): Record<VoteCategory, VoteResult> {
  const result = {} as Record<VoteCategory, VoteResult>;
  for (const cat of VOTE_CATEGORIES) result[cat] = { winners: [], counts: {} };

  for (const v of votes) {
    const r = result[v.category];
    // Неизвестная категория и голос за себя (БД такое не пропускает) просто не считаются.
    if (!r || v.voterId === v.nomineeId) continue;
    r.counts[v.nomineeId] = (r.counts[v.nomineeId] ?? 0) + 1;
  }
  for (const cat of VOTE_CATEGORIES) {
    const r = result[cat];
    const max = Math.max(0, ...Object.values(r.counts));
    // Сортировка — чтобы порядок победителей не зависел от порядка строк из БД.
    r.winners =
      max > 0
        ? Object.keys(r.counts)
            .filter((id) => r.counts[id] === max)
            .sort()
        : [];
  }
  return result;
}
