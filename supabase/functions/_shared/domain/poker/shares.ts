// Целые проценты для экрана: доли банка олл-ина на табло, в приложении и в историях вечера (allins.ts)
// округляются одним правилом — одни карты дают одни цифры везде.

/**
 * Проценты для экрана — целые, в сумме 100 (метод наибольших остатков): 81,95 / 18,05 → 82 / 18.
 * Равные доли получают равные цифры: прибавку получает вся группа одинаковых долей или никто, и
 * если последнего процента на группу не хватает, раздача прибавок на этом заканчивается
 * (33,3 ×3 → 33 / 33 / 33, сумма 99) — одинаковые руки на табло не должны выглядеть разными, а
 * меньшая доля не должна показаться больше. При равных остатках первой идёт бо́льшая доля.
 */
export function roundShares(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const scaled = values.map((v) => (v / total) * 100);
  const out = scaled.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);

  // Группы одинаковых долей.
  const groups: { value: number; frac: number; members: number[] }[] = [];
  scaled.forEach((v, i) => {
    const g = groups.find((x) => Math.abs(x.value - v) < 1e-9);
    if (g) g.members.push(i);
    else groups.push({ value: v, frac: v - Math.floor(v), members: [i] });
  });
  groups.sort((a, b) => b.frac - a.frac || b.value - a.value);

  for (const g of groups) {
    if (rest <= 0 || g.frac <= 1e-9 || g.members.length > rest) break;
    for (const i of g.members) out[i] = (out[i] ?? 0) + 1;
    rest -= g.members.length;
  }
  return out;
}
