// Оценка покерной руки из 5, 6 или 7 карт. Перенос evaluator.js из курса
// (D:\personal\poker-course\js\evaluator.js), проверенного там полным перебором всех 133 784 560
// семикарточных наборов. Счёт — целое: чем больше, тем сильнее рука; равные числа — равные руки
// (делёж). Упаковка: категория·13⁵ + k1·13⁴ + k2·13³ + k3·13² + k4·13 + k5.
// Индексы в типизированных массивах ниже всегда в пределах (ранг 0..12, масть 0..3) — отсюда `!`.
import type { Card } from './cards';

export const CATEGORY = {
  HIGH: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

const P1 = 13;
const P2 = 169;
const P3 = 2197;
const P4 = 28561;
const P5 = 371293;

function pack(cat: number, k1 = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0): number {
  return cat * P5 + k1 * P4 + k2 * P3 + k3 * P2 + k4 * P1 + k5;
}

/** Старшая карта стрита по битовой маске рангов, либо −1. */
export function straightHigh(mask: number): number {
  const x = mask & (mask >> 1) & (mask >> 2) & (mask >> 3) & (mask >> 4);
  if (x) return 31 - Math.clz32(x) + 4;
  // «Колесо» A-2-3-4-5: биты туза (12) и 2, 3, 4, 5 (0..3), старшая — пятёрка (индекс 3).
  if ((mask & 0x100f) === 0x100f) return 3;
  return -1;
}

/** n старших рангов из маски, по убыванию. */
function topN(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r -= 1) {
    if (mask & (1 << r)) out.push(r);
  }
  return out;
}

// Рабочие массивы одного вызова: оценка идёт миллионами раз, без выделения памяти на каждый.
const rankCount = new Int32Array(13);
const suitCount = new Int32Array(4);
const suitMask = new Int32Array(4);

/** Счёт руки из первых `length` карт массива (по умолчанию — всех). */
export function evaluate(cards: ArrayLike<Card>, length: number = cards.length): number {
  rankCount.fill(0);
  suitCount.fill(0);
  suitMask.fill(0);

  let mask = 0;
  for (let i = 0; i < length; i += 1) {
    const c = cards[i]!;
    const r = c >> 2;
    const s = c & 3;
    rankCount[r] = rankCount[r]! + 1;
    suitCount[s] = suitCount[s]! + 1;
    suitMask[s] = suitMask[s]! | (1 << r);
    mask |= 1 << r;
  }

  // --- флеш и стрит-флеш ---
  let flushSuit = -1;
  for (let s = 0; s < 4; s += 1) {
    if (suitCount[s]! >= 5) {
      flushSuit = s;
      break;
    }
  }
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMask[flushSuit]!);
    if (sf >= 0) return pack(CATEGORY.STRAIGHT_FLUSH, sf);
  }

  // --- разбор по кратности рангов (по убыванию ранга) ---
  let quad = -1;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r -= 1) {
    const n = rankCount[r]!;
    if (n === 4) {
      if (quad < 0) quad = r;
    } else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
  }

  if (quad >= 0) {
    let kicker = -1;
    for (let r = 12; r >= 0; r -= 1) {
      if (r !== quad && rankCount[r]! > 0) {
        kicker = r;
        break;
      }
    }
    return pack(CATEGORY.QUADS, quad, Math.max(kicker, 0));
  }

  if (trips.length >= 2) return pack(CATEGORY.FULL_HOUSE, trips[0], trips[1]);
  if (trips.length === 1 && pairs.length >= 1) return pack(CATEGORY.FULL_HOUSE, trips[0], pairs[0]);

  if (flushSuit >= 0) {
    const f = topN(suitMask[flushSuit]!, 5);
    return pack(CATEGORY.FLUSH, f[0], f[1], f[2], f[3], f[4]);
  }

  const st = straightHigh(mask);
  if (st >= 0) return pack(CATEGORY.STRAIGHT, st);

  if (trips.length === 1) {
    const t = trips[0]!;
    const k = topN(mask & ~(1 << t), 2);
    return pack(CATEGORY.TRIPS, t, k[0], k[1]);
  }

  if (pairs.length >= 2) {
    const a = pairs[0]!;
    const b = pairs[1]!;
    const k = topN(mask & ~(1 << a) & ~(1 << b), 1);
    return pack(CATEGORY.TWO_PAIR, a, b, k[0]);
  }

  if (pairs.length === 1) {
    const p = pairs[0]!;
    const k = topN(mask & ~(1 << p), 3);
    return pack(CATEGORY.PAIR, p, k[0], k[1], k[2]);
  }

  const h = topN(mask, 5);
  return pack(CATEGORY.HIGH, h[0], h[1], h[2], h[3], h[4]);
}

export function categoryOf(score: number): number {
  return Math.floor(score / P5);
}

/** Ранги счёта k1..k5 (старший — первый). */
function kickers(score: number): number[] {
  const rest = score - categoryOf(score) * P5;
  return [
    Math.floor(rest / P4) % 13,
    Math.floor(rest / P3) % 13,
    Math.floor(rest / P2) % 13,
    Math.floor(rest / P1) % 13,
    rest % 13,
  ];
}

// Названия рангов в нужных падежах: «пара тузов», «три дамы», «стрит до пятёрки», «тузы и семёрки».
const NOM = [
  'двойка',
  'тройка',
  'четвёрка',
  'пятёрка',
  'шестёрка',
  'семёрка',
  'восьмёрка',
  'девятка',
  'десятка',
  'валет',
  'дама',
  'король',
  'туз',
];
const GEN = [
  'двойки',
  'тройки',
  'четвёрки',
  'пятёрки',
  'шестёрки',
  'семёрки',
  'восьмёрки',
  'девятки',
  'десятки',
  'валета',
  'дамы',
  'короля',
  'туза',
];
const GEN_PL = [
  'двоек',
  'троек',
  'четвёрок',
  'пятёрок',
  'шестёрок',
  'семёрок',
  'восьмёрок',
  'девяток',
  'десяток',
  'валетов',
  'дам',
  'королей',
  'тузов',
];
const NOM_PL = [
  'двойки',
  'тройки',
  'четвёрки',
  'пятёрки',
  'шестёрки',
  'семёрки',
  'восьмёрки',
  'девятки',
  'десятки',
  'валеты',
  'дамы',
  'короли',
  'тузы',
];

/** Рука словами для табло: «Пара тузов», «Две пары: короли и семёрки», «Стрит до пятёрки». */
export function describeHand(score: number): string {
  const k = kickers(score);
  const a = k[0] ?? 0;
  const b = k[1] ?? 0;
  switch (categoryOf(score)) {
    case CATEGORY.STRAIGHT_FLUSH:
      return a === 12 ? 'Роял-флеш' : `Стрит-флеш до ${GEN[a]}`;
    case CATEGORY.QUADS:
      return `Каре ${GEN_PL[a]}`;
    case CATEGORY.FULL_HOUSE:
      return `Фулл-хаус: ${NOM_PL[a]} и ${NOM_PL[b]}`;
    case CATEGORY.FLUSH:
      return `Флеш до ${GEN[a]}`;
    case CATEGORY.STRAIGHT:
      return `Стрит до ${GEN[a]}`;
    case CATEGORY.TRIPS:
      return `Три ${GEN[a]}`;
    case CATEGORY.TWO_PAIR:
      return `Две пары: ${NOM_PL[a]} и ${NOM_PL[b]}`;
    case CATEGORY.PAIR:
      return `Пара ${GEN_PL[a]}`;
    default:
      return `Старшая карта: ${NOM[a]}`;
  }
}
