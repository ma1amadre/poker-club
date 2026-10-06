// Геометрия графика накопленного нетто: шкала с нулём, круглые деления, координаты точек.
// Чистые функции — рисует NetChart.tsx, проверяют тесты.
import { niceTicks } from './stats';

export interface ChartBox {
  width: number;
  height: number;
  /** Поля под подписи: слева — деления оси Y, снизу — даты. */
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface ChartPoint {
  x: number;
  y: number;
  value: number;
}

export interface ChartTick {
  value: number;
  y: number;
}

export interface ChartLayout {
  points: ChartPoint[];
  ticks: ChartTick[];
  /** Y нулевой линии (ноль всегда в шкале). */
  zeroY: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Раскладка ряда значений в прямоугольнике. Шкала всегда включает ноль: на графике денег важно,
 * в плюсе игрок или в минусе. Одна точка — по центру по горизонтали.
 */
export function chartLayout(values: readonly number[], box: ChartBox): ChartLayout {
  const left = box.padLeft;
  const right = Math.max(left, box.width - box.padRight);
  const top = box.padTop;
  const bottom = Math.max(top, box.height - box.padBottom);

  const finite = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  const tickValues = niceTicks(lo, hi, 5);
  const min = tickValues[0] ?? 0;
  const max = tickValues.at(-1) ?? 0;
  const span = max - min;

  const yOf = (v: number): number =>
    span === 0 ? (top + bottom) / 2 : top + ((max - v) / span) * (bottom - top);

  const n = values.length;
  const xOf = (i: number): number =>
    n <= 1 ? (left + right) / 2 : left + (i * (right - left)) / (n - 1);

  return {
    points: values.map((value, i) => ({
      x: xOf(i),
      y: yOf(Number.isFinite(value) ? value : 0),
      value,
    })),
    ticks: tickValues.map((value) => ({ value, y: yOf(value) })),
    zeroY: yOf(0),
    left,
    right,
    top,
    bottom,
  };
}

/** Индекс ближайшей по горизонтали точки — для перекрестия по касанию; -1, если точек нет. */
export function nearestIndex(points: readonly Pick<ChartPoint, 'x'>[], x: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((p, i) => {
    const d = Math.abs(p.x - x);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** Путь линии SVG: «M x y L x y …». */
export function linePath(points: readonly Pick<ChartPoint, 'x' | 'y'>[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ');
}

const round = (v: number) => Math.round(v * 10) / 10;
