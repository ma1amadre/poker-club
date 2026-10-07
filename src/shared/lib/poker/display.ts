// Подписи олл-ина для экранов: улицы, ауты по рангам. Чистый модуль (тесты — display.test.ts).
import type { Street } from '@domain/showdown.ts';
import { rankLabel, RANKS, suitOfCode, type SuitCode } from './cards';

/** «Олл-ин · флоп»: улица по числу карт на столе. */
export const STREET_LABEL: Readonly<Record<Street, string>> = {
  preflop: 'до флопа',
  flop: 'флоп',
  turn: 'тёрн',
  river: 'ривер',
};

/** Ауты на флопе — к тёрну, на тёрне — к риверу. */
export function outsTarget(street: Street): string | null {
  if (street === 'flop') return 'к тёрну';
  if (street === 'turn') return 'к риверу';
  return null;
}

export interface OutsGroup {
  /** Ранг для экрана: «A», «10». */
  rank: string;
  /** Масти по порядку ♠ ♥ ♦ ♣. */
  suits: SuitCode[];
}

const SUIT_ORDER: readonly SuitCode[] = ['s', 'h', 'd', 'c'];

/** Ауты компактно: по рангам от туза вниз, у ранга — его масти: «A ♠♥♦ · K ♠♥♦ · 7 ♣». */
export function groupOuts(codes: readonly string[]): OutsGroup[] {
  const byRank = new Map<string, Set<SuitCode>>();
  for (const code of codes) {
    const rank = code.charAt(0);
    const set = byRank.get(rank) ?? new Set<SuitCode>();
    set.add(suitOfCode(code));
    byRank.set(rank, set);
  }
  return [...byRank.entries()]
    .sort((a, b) => RANKS.indexOf(b[0]) - RANKS.indexOf(a[0]))
    .map(([rank, suits]) => ({
      rank: rankLabel(rank),
      suits: SUIT_ORDER.filter((s) => suits.has(s)),
    }));
}
