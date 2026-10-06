import { describe, expect, it } from 'vitest';
import { chartLayout, linePath, nearestIndex, type ChartBox } from './chart';

const box: ChartBox = {
  width: 300,
  height: 200,
  padLeft: 50,
  padRight: 10,
  padTop: 10,
  padBottom: 30,
};

describe('раскладка графика', () => {
  it('ноль всегда в шкале и внутри поля графика', () => {
    const layout = chartLayout([500, 1200, 900], box);
    expect(layout.ticks[0]?.value).toBe(0);
    expect(layout.zeroY).toBe(layout.bottom);
    for (const p of layout.points) {
      expect(p.y).toBeGreaterThanOrEqual(layout.top);
      expect(p.y).toBeLessThanOrEqual(layout.bottom);
    }
  });

  it('минус ниже нуля, плюс выше', () => {
    const layout = chartLayout([-500, 1000], box);
    const [minus, plus] = layout.points;
    if (!minus || !plus) throw new Error('нет точек');
    expect(minus.y).toBeGreaterThan(layout.zeroY);
    expect(plus.y).toBeLessThan(layout.zeroY);
  });

  it('точки равномерно от левого до правого края', () => {
    const layout = chartLayout([1, 2, 3], box);
    expect(layout.points.map((p) => p.x)).toEqual([50, 170, 290]);
  });

  it('одна точка — по центру', () => {
    const layout = chartLayout([300], box);
    expect(layout.points[0]?.x).toBe(170);
  });

  it('все нули — линия посередине, без деления на ноль', () => {
    const layout = chartLayout([0, 0], box);
    expect(layout.ticks).toEqual([{ value: 0, y: 90 }]);
    expect(layout.points.every((p) => p.y === 90)).toBe(true);
  });

  it('деления сверху вниз совпадают с шкалой', () => {
    const layout = chartLayout([-300, 1250], box);
    expect(layout.ticks.map((t) => t.value)).toEqual([-500, 0, 500, 1000, 1500]);
    expect(layout.ticks[0]?.y).toBe(layout.bottom);
    expect(layout.ticks.at(-1)?.y).toBe(layout.top);
  });
});

describe('касание и путь', () => {
  it('ближайшая точка по горизонтали', () => {
    const points = [{ x: 10 }, { x: 50 }, { x: 90 }];
    expect(nearestIndex(points, 0)).toBe(0);
    expect(nearestIndex(points, 69)).toBe(1);
    expect(nearestIndex(points, 71)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });

  it('путь линии', () => {
    expect(
      linePath([
        { x: 1, y: 2 },
        { x: 3.333, y: 4 },
      ]),
    ).toBe('M1 2 L3.3 4');
    expect(linePath([])).toBe('');
  });
});
