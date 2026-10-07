// Эквити: эталоны курса (tests/engines.test.js, раздел 4; tests/equity-reference.js — агрегат по
// мастям, сверенный с cardfight.com до 0,01 п. п.) и детерминизм Монте-Карло.
import { describe, expect, it } from 'vitest';
import { roundShares } from './analysis';
import { parseCards, RANKS, SUITS, type Card } from './cards';
import {
  computeEquity,
  createMcJob,
  EXACT_BOARD_LIMIT,
  exactEquity,
  mcJobResult,
  MC_MIN_SAMPLES,
  monteCarloEquity,
  parseShowdownKey,
  planEquity,
  runMcJob,
  seedFor,
  showdownKey,
  suitSymmetryGroups,
} from './equity';
import { nCk, outsEquity } from './pokermath';

const H = (s: string) => parseCards(s.match(/../g) ?? []);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Все комбинации руки вида 'AA', 'AKs', 'AKo' (как Ranges.keyCombos курса). */
function keyCombos(key: string): Card[][] {
  const r1 = RANKS.indexOf(key.charAt(0));
  const r2 = RANKS.indexOf(key.charAt(1));
  const out: Card[][] = [];
  for (let s1 = 0; s1 < 4; s1 += 1) {
    for (let s2 = 0; s2 < 4; s2 += 1) {
      if (r1 === r2 && s2 <= s1) continue;
      if (key.endsWith('s') && s1 !== s2) continue;
      if (key.endsWith('o') && s1 === s2) continue;
      out.push([r1 * 4 + s1, r2 * 4 + s2]);
    }
  }
  return out;
}

/**
 * Агрегат «рука против руки» по всем сочетаниям мастей, точным перебором досок — так публикуют
 * справочники. Эквити не меняется от перестановки мастей, поэтому одинаковые с точностью до
 * перестановки расклады считаются один раз (у AA против KK — 3 разных из 36).
 */
function aggregate(keyA: string, keyB: string) {
  const cache = new Map<string, ReturnType<typeof exactEquity>>();
  let win = 0;
  let tie = 0;
  let eq = 0;
  let n = 0;
  for (const a of keyCombos(keyA)) {
    for (const b of keyCombos(keyB)) {
      if (a.some((c) => b.includes(c))) continue;
      const map = new Map<number, number>();
      const canon = [...a, ...b]
        .map((c) => {
          const s = c & 3;
          if (!map.has(s)) map.set(s, map.size);
          return `${c >> 2}:${map.get(s)}`;
        })
        .join(',');
      let r = cache.get(canon);
      if (!r) {
        r = exactEquity([a, b], []);
        cache.set(canon, r);
      }
      win += r.win[0] ?? 0;
      tie += r.tie[0] ?? 0;
      eq += r.equity[0] ?? 0;
      n += 1;
    }
  }
  return { win: win / n, tie: tie / n, equity: eq / n, configs: n, distinct: cache.size };
}

describe('эталоны cardfight.com (курс, equity-reference.js)', () => {
  it('AA против KK: 81,71 / 0,46 / 81,95', () => {
    const r = aggregate('AA', 'KK');
    expect(r.configs).toBe(36);
    expect(r.win).toBeCloseTo(81.71, 2);
    expect(r.tie).toBeCloseTo(0.46, 2);
    expect(r.equity).toBeCloseTo(81.95, 2);
  }, 60_000);

  it('AKs против QQ: 45,83 / 0,43 / 46,05', () => {
    const r = aggregate('AKs', 'QQ');
    expect(r.configs).toBe(24);
    expect(r.win).toBeCloseTo(45.83, 2);
    expect(r.tie).toBeCloseTo(0.43, 2);
    expect(r.equity).toBeCloseTo(46.05, 2);
  }, 60_000);
});

describe('эквити (курс, раздел 4)', () => {
  it('AhAs против KhKs: точный перебор C(48,5) = 1 712 304 досок, сумма 100 %', () => {
    const r = exactEquity([H('AhAs'), H('KhKs')], []);
    expect(r.samples).toBe(1712304);
    expect(r.exact).toBe(true);
    expect(sum(r.equity)).toBeCloseTo(100, 9);
    // Эквити = чистые победы + половина дележей; win + tie — частоты, не больше 100.
    expect(r.equity[0]).toBeCloseTo((r.win[0] ?? 0) + (r.tie[0] ?? 0) / 2, 9);
    expect((r.win[0] ?? 0) + (r.tie[0] ?? 0)).toBeLessThanOrEqual(100);
  }, 60_000);

  it('Монте-Карло 200 тыс. с seed 777 сходится к точному (±0,5 п. п.)', () => {
    const exact = exactEquity([H('AhAs'), H('KhKs')], []);
    const mc = monteCarloEquity([H('AhAs'), H('KhKs')], [], 200_000, 777);
    expect(mc.exact).toBe(false);
    expect(mc.samples).toBe(200_000);
    expect(Math.abs((mc.equity[0] ?? 0) - (exact.equity[0] ?? 0))).toBeLessThan(0.5);
  });

  it('ривер: один расклад; стрит до туза бьёт сет дам', () => {
    const r = exactEquity([H('AhKh'), H('QsQd')], H('Qc7d9hJdTc'));
    expect(r.samples).toBe(1);
    expect(r.equity).toEqual([100, 0]);
    expect(exactEquity([H('AhKh'), H('QsQd')], H('2h7d9cJdTc')).equity[0]).toBe(0);
  });

  it('одинаковые руки делят банк: 50 % и делёж в 100 % случаев', () => {
    const r = exactEquity([H('AhKh'), H('AsKs')], H('2c7d9hJdTc'));
    expect(r.equity).toEqual([50, 50]);
    expect(r.tie).toEqual([100, 100]);
    expect(r.win).toEqual([0, 0]);
  });

  it('флоп: точный перебор C(45,2) = 990', () => {
    expect(exactEquity([H('AhKh'), H('7c7d')], H('Ac7h2s')).samples).toBe(990);
  });

  it('трое: сумма 100 %, AA сильнее KK сильнее QQ', () => {
    const r = monteCarloEquity([H('AhAs'), H('KhKs'), H('QhQs')], [], 60_000, 9);
    expect(sum(r.equity)).toBeCloseTo(100, 9);
    expect(r.equity[0]).toBeGreaterThan(r.equity[1] ?? 0);
    expect(r.equity[1]).toBeGreaterThan(r.equity[2] ?? 0);
  });

  it('повтор карты, одна рука, лишние карты стола — ошибка', () => {
    expect(() => exactEquity([H('AhAs'), H('AhKs')], [])).toThrow('дважды');
    expect(() => exactEquity([H('AhAs')], [])).toThrow();
    expect(() => monteCarloEquity([H('AhAs'), H('KdKs')], H('2c3c4c5c6c7c'), 10, 1)).toThrow();
  });
});

describe('план расчёта и детерминизм', () => {
  it('до флопа — Монте-Карло, с флопа — точно при любом числе игроков', () => {
    for (let n = 2; n <= 9; n += 1) {
      expect(planEquity(n, 0, 'k').kind).toBe('mc');
      for (const b of [3, 4, 5]) expect(planEquity(n, b, 'k').kind).toBe('exact');
    }
    // Самый тяжёлый точный случай — флоп у двоих: 990 досок, далеко от предела.
    expect(nCk(45, 2)).toBeLessThan(EXACT_BOARD_LIMIT);
    expect(nCk(52 - 18, 5)).toBeGreaterThan(EXACT_BOARD_LIMIT);
  });

  it('раздач Монте-Карло — от числа игроков, не меньше MC_MIN_SAMPLES', () => {
    const two = planEquity(2, 0, 'k');
    const nine = planEquity(9, 0, 'k');
    expect(two).toMatchObject({ kind: 'mc', samples: 200_000 });
    expect(nine.kind === 'mc' && nine.samples >= MC_MIN_SAMPLES).toBe(true);
  });

  it('seed — из карт раздачи: те же карты — тот же seed, другие — другой', () => {
    const key = showdownKey(
      [
        ['As', 'Kd'],
        ['Qh', 'Qc'],
      ],
      [],
    );
    expect(key).toBe('AsKd|QhQc/');
    expect(seedFor(key)).toBe(seedFor('AsKd|QhQc/'));
    expect(seedFor(key)).not.toBe(seedFor('AsKd|QhQd/'));
    const plan = planEquity(2, 0, key);
    expect(plan.kind === 'mc' && plan.seed === seedFor(key)).toBe(true);
  });

  it('ключ раздачи разбирается обратно (воркеру уходит только ключ)', () => {
    const hands = [
      ['As', 'Kd'],
      ['Qh', 'Qc'],
      ['Td', '9d'],
    ];
    for (const board of [[], ['2c', '7d', '9h'], ['2c', '7d', '9h', 'Jd', 'Ah']]) {
      expect(parseShowdownKey(showdownKey(hands, board))).toEqual({ hands, board });
    }
  });

  it('computeEquity: один вход — один и тот же ответ до последнего знака', () => {
    const hands = [
      ['As', 'Kd'],
      ['Qh', 'Qc'],
      ['7s', '6s'],
    ];
    const a = computeEquity(hands, []);
    const b = computeEquity(
      hands.map((h) => [...h]),
      [],
    );
    expect(a.exact).toBe(false);
    expect(a).toEqual(b);
    expect(sum(a.equity)).toBeCloseTo(100, 9);
  });

  it('Монте-Карло кусками даёт ровно то же, что целиком', () => {
    const hands = [H('AsKd'), H('QhQc'), H('Jd9d')];
    const whole = monteCarloEquity(hands, [], 30_000, 4242);
    const job = createMcJob(hands, [], 30_000, 4242);
    let steps = 0;
    while (!runMcJob(job, 1777)) steps += 1;
    expect(steps).toBeGreaterThan(10);
    expect(mcJobResult(job)).toEqual(whole);
  });

  it('другой seed — чуть другие проценты, но рядом', () => {
    const hands = [H('AsKd'), H('QhQc')];
    const a = monteCarloEquity(hands, [], 100_000, 1);
    const b = monteCarloEquity(hands, [], 100_000, 2);
    expect(a.equity).not.toEqual(b.equity);
    expect(Math.abs((a.equity[0] ?? 0) - (b.equity[0] ?? 0))).toBeLessThan(1);
  });

  it('все масти и ранги разбираются', () => {
    const all = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
    expect(new Set(parseCards(all)).size).toBe(52);
  });
});

describe('симметрия мастей: равные по правилам руки — равные цифры', () => {
  const split = (s: string) => s.match(/../g) ?? [];

  it('группы рук: перестановка мастей держит стол и переставляет руки', () => {
    // Обмен червей и бубён: AhKd ↔ AdKh, 7c7s на месте.
    expect(suitSymmetryGroups([H('AhKd'), H('AdKh'), H('7c7s')], [])).toEqual([[0, 1], [2]]);
    expect(suitSymmetryGroups([H('7c7s'), H('AhKd'), H('AdKh')], [])).toEqual([[0], [1, 2]]);
    // Одномастные AK разных мастей против пары двоек: обмен пик и червей.
    expect(suitSymmetryGroups([H('AsKs'), H('AhKh'), H('2c2d')], [])).toEqual([[0, 1], [2]]);
    // Три пиковые карты на столе ломают симметрию: пиковый флеш есть только у AsKs.
    expect(suitSymmetryGroups([H('AsKs'), H('AhKh')], H('2s3s4s'))).toEqual([[0], [1]]);
    // Стол из червей и бубён, переходящий сам в себя, — симметрия остаётся.
    expect(suitSymmetryGroups([H('AsKc'), H('AcKs')], H('2h2d9h9d'))).toEqual([[0, 1]]);
    expect(suitSymmetryGroups([H('AsKd'), H('QhQc')], [])).toEqual([[0], [1]]);
  });

  it('до флопа (Монте-Карло): одинаковые AK получают одинаковые проценты', () => {
    for (const hands of [
      ['AhKd', 'AdKh', '7c7s'],
      ['7c7s', 'AhKd', 'AdKh'],
      ['AsKs', 'AhKh', '2c2d'],
    ].map((row) => row.map(split))) {
      const r = computeEquity(hands, []);
      expect(r.exact).toBe(false);
      const [a, b] = hands[0]?.[0] === '7c' ? [1, 2] : [0, 1];
      expect(r.equity[a]).toBe(r.equity[b]);
      expect(r.win[a]).toBe(r.win[b]);
      expect(r.tie[a]).toBe(r.tie[b]);
      expect(sum(r.equity)).toBeCloseTo(100, 9);
      const shares = roundShares(r.equity);
      expect(shares[a]).toBe(shares[b]);
    }
  });

  it('усреднение не меняет детерминизм и нарезку Монте-Карло', () => {
    const hands = [H('AhKd'), H('AdKh'), H('7c7s')];
    const whole = monteCarloEquity(hands, [], 20_000, 99);
    const job = createMcJob(hands, [], 20_000, 99);
    while (!runMcJob(job, 3001));
    expect(mcJobResult(job)).toEqual(whole);
    expect(whole.equity[0]).toBe(whole.equity[1]);
  });

  it('точный перебор: симметричные руки — те же числа до последнего знака', () => {
    const r = exactEquity([H('AhKd'), H('AdKh'), H('7c7s')], H('2c9s5c'));
    expect(r.equity[0]).toBe(r.equity[1]);
    expect(r.tie[0]).toBe(r.tie[1]);
    expect(sum(r.equity)).toBeCloseTo(100, 9);
  });
});

describe('ауты: формула курса (раздел 5)', () => {
  it('9 аутов: две карты — 34,97 %, одна — 19,57 %', () => {
    expect(outsEquity(9, 2, 47)).toBeCloseTo(34.97, 2);
    expect(outsEquity(9, 1, 46)).toBeCloseTo(19.565, 2);
  });
});
