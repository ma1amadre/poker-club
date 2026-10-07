// Оценщик рук: те же проверки, что в курсе (tests/engines.test.js, раздел 1–2), плюс полный перебор
// всех 2 598 960 пятикарточных рук против табличных частот — точное совпадение.
import { CARD_RANKS, CARD_SUITS, isCardCode } from '@domain/showdown.ts';
import { describe, expect, it } from 'vitest';
import { cardCode, cardLabel, cardName, deckWithout, parseCard, parseCards } from './cards';
import { CATEGORY, categoryOf, describeHand, evaluate } from './evaluator';
import { mulberry32 } from './equity';

/** 'AhKd2c…' → счёт. */
const E = (s: string) => evaluate(parseCards(s.match(/../g) ?? []));

describe('карты', () => {
  it('нотация движка совпадает с нотацией журнала', () => {
    const all = Array.from({ length: 52 }, (_, i) => cardCode(i));
    expect(new Set(all).size).toBe(52);
    expect(all.every(isCardCode)).toBe(true);
    for (const r of CARD_RANKS)
      for (const s of CARD_SUITS) expect(cardCode(parseCard(r + s))).toBe(r + s);
  });

  it('индексы как в курсе: ранг·4 + масть, трефы 0 … пики 3', () => {
    expect(parseCard('2c')).toBe(0);
    expect(parseCard('As')).toBe(51);
    expect(parseCard('Ah')).toBe(50);
    expect(parseCard('Td')).toBe(8 * 4 + 1);
  });

  it('не карты — ошибка', () => {
    for (const bad of ['as', 'AS', '10s', 'A', 'Ax', '']) expect(() => parseCard(bad)).toThrow();
  });

  it('подписи: десятка — «10», масть — символом и словом', () => {
    expect(cardLabel('Td')).toBe('10♦');
    expect(cardLabel('As')).toBe('A♠');
    expect(cardName('Td')).toBe('десятка бубён');
    expect(cardName('Qh')).toBe('дама червей');
    expect(cardName('Kc')).toBe('король треф');
  });

  it('колода без карт', () => {
    expect(deckWithout(parseCards(['As', 'Kd']))).toHaveLength(50);
    expect(deckWithout([])).toEqual(Array.from({ length: 52 }, (_, i) => i));
  });
});

describe('оценка комбинаций: разбор конкретных рук (курс, раздел 1)', () => {
  it('порядок категорий', () => {
    expect(E('9h8h7h6h5h2c2d')).toBeGreaterThan(E('9c9d9s9h5h2c3d'));
    expect(E('9c9d9s9h5h2c3d')).toBeGreaterThan(E('9c9d9sKcKd2c3d'));
    expect(E('9c9d9sKcKd2c3d')).toBeGreaterThan(E('Ah9h7h4h2h3c5d'));
    expect(E('Ah9h7h4h2h3c5d')).toBeGreaterThan(E('9c8d7h6s5c2d3h'));
    expect(E('9c8d7h6s5c2d3h')).toBeGreaterThan(E('9c9d9h2s5cKdQh'));
    expect(E('9c9d9h2s5cKdQh')).toBeGreaterThan(E('9c9dKhKs5c2d3h'));
    expect(E('9c9dKhKs5c2d3h')).toBeGreaterThan(E('9c9dKhQs5c2d3h'));
    expect(E('9c9dKhQs5c2d3h')).toBeGreaterThan(E('Ac9dKhQs5c2d3h'));
  });

  it('колесо A-2-3-4-5 — стрит до пятёрки, слабее стрита до туза', () => {
    expect(categoryOf(E('Ah2c3d4s5hKdQc'))).toBe(CATEGORY.STRAIGHT);
    expect(describeHand(E('Ah2c3d4s5hKdQc'))).toBe('Стрит до пятёрки');
    expect(E('AhKcQdJsTh2c3d')).toBeGreaterThan(E('Ah2c3d4s5hKdQc'));
  });

  it('флеш: пять старших из шести, сравнение до пятой карты', () => {
    expect(describeHand(E('AhKh9h7h5h3h2c'))).toBe('Флеш до туза');
    expect(E('AhKhQhJh9h2c3d')).toBeGreaterThan(E('AhKhQhJh8h2c3d'));
  });

  it('каре с кикером, фулл-хаусы, три пары', () => {
    expect(E('7c7d7h7sAd2c3h')).toBeGreaterThan(E('7c7d7h7sKd2c3h'));
    expect(describeHand(E('9c9d9hKcKdKh2s'))).toBe('Фулл-хаус: короли и девятки');
    expect(describeHand(E('9c9d9hKcKd4s4h'))).toBe('Фулл-хаус: девятки и короли');
    expect(describeHand(E('AcAd9h9sKcKd2h'))).toBe('Две пары: тузы и короли');
  });

  it('одинаковые руки — одинаковый счёт (делёж)', () => {
    expect(E('AhKh2c3d4s5h9c')).toBe(E('AsKs2c3d4s5h9c'));
    expect(E('AhKhQhJhTh2c3d')).toBe(E('AsKsQsJsTs2c3d'));
  });

  it('руки словами', () => {
    expect(describeHand(E('AhKhQhJhTh2c3d'))).toBe('Роял-флеш');
    expect(describeHand(E('9h8h7h6h5h2c2d'))).toBe('Стрит-флеш до девятки');
    expect(describeHand(E('7c7d7h7sAd2c3h'))).toBe('Каре семёрок');
    expect(describeHand(E('QcQdQh2s5cKd8h'))).toBe('Три дамы');
    expect(describeHand(E('JcJd2s5cKd8h3c'))).toBe('Пара валетов');
    expect(describeHand(E('Ac9dKhQs5c2d3h'))).toBe('Старшая карта: туз');
    expect(describeHand(E('Tc9d8h7s6c2d2h'))).toBe('Стрит до десятки');
    // Пять карт тоже оцениваются (флоп).
    expect(describeHand(E('AsKdQh2c2d'))).toBe('Пара двоек');
  });
});

describe('оценка комбинаций: частоты против табличных (курс, раздел 2)', () => {
  it('все 2 598 960 пятикарточных рук — точные табличные частоты', () => {
    const counts = new Array<number>(9).fill(0);
    const h = new Int32Array(5);
    for (let a = 0; a < 48; a += 1) {
      h[0] = a;
      for (let b = a + 1; b < 49; b += 1) {
        h[1] = b;
        for (let c = b + 1; c < 50; c += 1) {
          h[2] = c;
          for (let d = c + 1; d < 51; d += 1) {
            h[3] = d;
            for (let e = d + 1; e < 52; e += 1) {
              h[4] = e;
              const cat = categoryOf(evaluate(h, 5));
              counts[cat] = (counts[cat] ?? 0) + 1;
            }
          }
        }
      }
    }
    // Стрит-флеш, каре, фулл-хаус, флеш, стрит, тройка, две пары, пара, старшая — снизу вверх.
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
  }, 60_000);

  it('семь карт: выборка 400 тыс. с seed курса — в пределах 4 стандартных ошибок', () => {
    // Табличные частоты 133 784 560 наборов (курс проверил их полным перебором).
    const REF = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584];
    const TOTAL = 133784560;
    expect(REF.reduce((a, b) => a + b, 0)).toBe(TOTAL);
    const N = 400_000;
    const rng = mulberry32(20260805);
    const counts = new Array<number>(9).fill(0);
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const hand = new Int32Array(7);
    for (let i = 0; i < N; i += 1) {
      for (let j = 51; j > 44; j -= 1) {
        const k = (rng() * (j + 1)) | 0;
        const tmp = deck[j]!;
        deck[j] = deck[k]!;
        deck[k] = tmp;
      }
      for (let j = 0; j < 7; j += 1) hand[j] = deck[51 - j]!;
      const cat = categoryOf(evaluate(hand, 7));
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    REF.forEach((ref, cat) => {
      const exp = ref / TOTAL;
      const got = (counts[cat] ?? 0) / N;
      const se = Math.sqrt((exp * (1 - exp)) / N);
      expect(Math.abs(got - exp)).toBeLessThanOrEqual(Math.max(4 * se, 0.00005));
    });
  }, 60_000);
});
