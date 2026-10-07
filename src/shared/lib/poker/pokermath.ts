// Покерная математика из курса (D:\personal\poker-course\js\pokermath.js) — то, что нужно олл-ину:
// число сочетаний (точный перебор или Монте-Карло) и шанс поймать аут. Шансы банка, MDF, EV и
// дисперсия табло не нужны и не перенесены.

/** Число сочетаний из n по k. */
export function nCk(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/**
 * Вероятность поймать хотя бы один из `outs` аутов за `cardsToCome` карт (1 или 2), %.
 * unseen — сколько карт не видно (в олл-ине — колода без всех открытых рук и стола).
 */
export function outsEquity(outs: number, cardsToCome: 1 | 2, unseen: number): number {
  if (unseen <= 0) return 0;
  if (cardsToCome === 1) return (outs / unseen) * 100;
  const miss = nCk(unseen - outs, 2) / nCk(unseen, 2);
  return (1 - miss) * 100;
}
