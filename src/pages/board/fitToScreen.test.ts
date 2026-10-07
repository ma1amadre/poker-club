import { describe, expect, it } from 'vitest';
import { bestFit, FIT_MIN } from './fitToScreen';

/** «Раскладка», которая помещается при масштабе не больше limit; запоминает, что ставили. */
function layout(limit: number) {
  const calls: number[] = [];
  return {
    calls,
    fits: (scale: number) => {
      calls.push(scale);
      return scale <= limit;
    },
  };
}

describe('bestFit — масштаб панели олл-ина на ТВ', () => {
  it('помещается как есть — 1, без подбора', () => {
    const l = layout(1);
    expect(bestFit(l.fits)).toBe(1);
    expect(l.calls).toEqual([1]);
  });

  it('наибольший помещающийся масштаб с точностью до процента, раскладка остаётся в нём', () => {
    for (const limit of [0.97, 0.84, 0.61]) {
      const l = layout(limit);
      const scale = bestFit(l.fits);
      expect(scale).toBeLessThanOrEqual(limit);
      expect(limit - scale).toBeLessThan(0.01);
      expect(l.calls.at(-1)).toBe(scale);
    }
  });

  it('не помещается и при FIT_MIN — FIT_MIN: мелко, но целиком', () => {
    const l = layout(0.3);
    expect(bestFit(l.fits)).toBe(FIT_MIN);
    expect(l.calls.at(-1)).toBe(FIT_MIN);
  });
});
