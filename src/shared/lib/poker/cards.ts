// Карты движка эквити. Перенос cards.js из курса (D:\personal\poker-course\js\cards.js): карта —
// число 0..51 = ранг·4 + масть, ранг 0 — двойка … 12 — туз, масть 0 — трефы (c), 1 — бубны (d),
// 2 — червы (h), 3 — пики (s). Нотация журнала — строки 'As', 'Td', '9h' (домен, showdown.ts);
// разбор здесь такой же строгий: ранг заглавной, масть строчной, десятка — 'T'.
// Подписи для экрана: десятка рисуется как «10», масть — символом.

export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export const rankOf = (card: Card): number => card >> 2;
export const suitOf = (card: Card): number => card & 3;

/** 'As' → 51. Не карта — ошибка: в движок попадает только проверенный доменом payload. */
export function parseCard(code: string): Card {
  const r = code.length === 2 ? RANKS.indexOf(code.charAt(0)) : -1;
  const s = code.length === 2 ? SUITS.indexOf(code.charAt(1)) : -1;
  if (r < 0 || s < 0) throw new Error(`Не карта: «${code}»`);
  return r * 4 + s;
}

export function parseCards(codes: readonly string[]): Card[] {
  return codes.map(parseCard);
}

/** 51 → 'As'. */
export function cardCode(card: Card): string {
  return RANKS.charAt(rankOf(card)) + SUITS.charAt(suitOf(card));
}

/** Колода без указанных карт, по возрастанию. */
export function deckWithout(used: Iterable<Card>): Card[] {
  const blocked = new Uint8Array(52);
  for (const c of used) blocked[c] = 1;
  const deck: Card[] = [];
  for (let c = 0; c < 52; c += 1) if (!blocked[c]) deck.push(c);
  return deck;
}

// --- Подписи ---------------------------------------------------------------------------------

export type SuitCode = 's' | 'h' | 'd' | 'c';

export const SUIT_SYMBOL: Readonly<Record<SuitCode, string>> = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** Масть в родительном падеже: «туз пик», «дама червей». */
const SUIT_GENITIVE: Readonly<Record<SuitCode, string>> = {
  s: 'пик',
  h: 'червей',
  d: 'бубён',
  c: 'треф',
};

const RANK_NAME: Readonly<Record<string, string>> = {
  '2': 'двойка',
  '3': 'тройка',
  '4': 'четвёрка',
  '5': 'пятёрка',
  '6': 'шестёрка',
  '7': 'семёрка',
  '8': 'восьмёрка',
  '9': 'девятка',
  T: 'десятка',
  J: 'валет',
  Q: 'дама',
  K: 'король',
  A: 'туз',
};

/** Ранг для экрана: 'T' — «10». */
export function rankLabel(rank: string): string {
  return rank === 'T' ? '10' : rank;
}

/** Масть карты 'As' → 's'. */
export function suitOfCode(code: string): SuitCode {
  return code.charAt(1) as SuitCode;
}

/** 'Td' → «10♦». */
export function cardLabel(code: string): string {
  return rankLabel(code.charAt(0)) + (SUIT_SYMBOL[suitOfCode(code)] ?? '');
}

/** 'Td' → «десятка бубён» — для скринридера. */
export function cardName(code: string): string {
  return `${RANK_NAME[code.charAt(0)] ?? code.charAt(0)} ${SUIT_GENITIVE[suitOfCode(code)] ?? ''}`.trim();
}
