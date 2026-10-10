// Подписи олл-ина для экранов: улицы, ауты по мастям, «12 аутов к тёрну», «Догонит на тёрне: 33 %»,
// «устоит на N картах».
// Чистый модуль (тесты — display.test.ts).
import type { Street } from '@domain/showdown.ts';
import { NBSP, plural } from '../format';
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

/** Ауты одной масти: масть и её ранги от туза вниз (десятка — «10»). */
export interface OutsSuit {
  suit: SuitCode;
  ranks: string[];
}

const SUIT_ORDER: readonly SuitCode[] = ['s', 'h', 'd', 'c'];

/**
 * Ауты по мастям ♠ ♥ ♦ ♣ — на экране масть значком, за ней её ранги строкой: флеш-дро — одна
 * плашка «♥ A K Q J 9 7 6 4 3», стрит-дро — «♠ 9 4 · ♥ 9 4 · ♦ 9 4 · ♣ 9 4». Мастей без аутов нет.
 */
export function outsBySuit(codes: readonly string[]): OutsSuit[] {
  return SUIT_ORDER.map((suit) => ({
    suit,
    ranks: codes
      .filter((c) => suitOfCode(c) === suit)
      .map((c) => c.charAt(0))
      .sort((a, b) => RANKS.indexOf(b) - RANKS.indexOf(a))
      .map(rankLabel),
  })).filter((g) => g.ranks.length > 0);
}

/** Подпись к числу аутов: «1 аут к тёрну», «3 аута к риверу», «12 аутов к тёрну» — без числа. */
export function outsLabel(count: number, target: string): string {
  return `${plural(count, ['аут', 'аута', 'аутов'])} ${target}`;
}

/**
 * Аутов нет: на тёрне — «Аутов нет» (ривер — последняя карта, руке не догнать), на флопе — «Аутов к
 * тёрну нет»: до ривера рука ещё может собраться двумя картами (шансы — в процентах).
 */
export function noOutsText(street: Street): string {
  return street === 'flop' ? 'Аутов к тёрну нет' : 'Аутов нет';
}

/**
 * Вторая строка у аутов — с какой вероятностью следующая карта — аут (или делёж). На тёрне —
 * «Догонит: 20 %»: ривер последний, процент и есть итог. На флопе — «Догонит на тёрне: 33 %»: процент
 * только к тёрну, а крупные шансы рядом — до ривера; без улицы «55 %» и «догонит: 33 %» читаются как
 * противоречие. Строка рвётся только после «Догонит».
 */
export function catchUpText(pct: number, street: Street): string {
  const where = street === 'flop' ? ` на${NBSP}тёрне` : '';
  return `Догонит${where}:${NBSP}${pct}${NBSP}%`;
}

/**
 * Что держит тот, кто впереди: на скольких картах следующей улицы он устоит (computeHolds). На тёрне —
 * «Устоит на 35 картах из 44», «Устоит на любой карте», «Не устоит ни на одной карте» (догнать хотя бы
 * до дележа — уже не устоял). На флопе — с улицей, как «Догонит на тёрне» у отстающих: «Устоит на
 * тёрне: 30 карт из 45», «Устоит на тёрне: любая карта» — шансы рядом считаются до ривера.
 */
export function holdsText(holds: number, unseen: number, street: Street): string {
  if (street === 'flop') {
    if (holds >= unseen) return 'Устоит на тёрне: любая карта';
    const cards = plural(holds, ['карта', 'карты', 'карт']);
    return `Устоит на тёрне: ${holds}${NBSP}${cards} из${NBSP}${unseen}`;
  }
  if (holds >= unseen) return 'Устоит на любой карте';
  if (holds <= 0) return 'Не устоит ни на одной карте';
  const cards = plural(holds, ['карте', 'картах', 'картах']);
  return `Устоит на ${holds}${NBSP}${cards} из${NBSP}${unseen}`;
}
