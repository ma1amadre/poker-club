import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  eveningsCount,
  formatNumber,
  formatRubSigned,
  formatShortDate,
  useElementWidth,
} from '../../shared/lib';
import { chartLayout, linePath, nearestIndex } from './chart';
import type { NetPoint } from './stats';

const HEIGHT = 200;
const PAD = { padLeft: 52, padRight: 12, padTop: 20, padBottom: 28 } as const;
/** Точки рисуем, только когда между ними есть воздух; иначе — одна линия (метка ≥ 8 px). */
const MIN_DOT_GAP = 14;

interface NetChartProps {
  points: readonly NetPoint[];
}

/**
 * Накопленный нетто по вечерам — линия одного ряда (chart-1 «Материи»), ноль отмечен пунктиром.
 * Касание или стрелки показывают вечер под перекрестием. Рядом на экране — список вечеров с теми
 * же суммами (правило «Материи»: у графика есть таблица с данными).
 */
export function NetChart({ points }: NetChartProps) {
  const [boxRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const liveId = useId();

  const layout = useMemo(
    () =>
      width > 0
        ? chartLayout(
            points.map((p) => p.cumulativeRub),
            { width, height: HEIGHT, ...PAD },
          )
        : null,
    [points, width],
  );

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;

  const values = points.map((p) => p.cumulativeRub);
  const summary =
    `Накопленный нетто за ${eveningsCount(points.length)}: ` +
    `от ${formatRubSigned(Math.min(...values))} до ${formatRubSigned(Math.max(...values))}, ` +
    `сейчас ${formatRubSigned(last.cumulativeRub)}.`;

  const pick = (event: PointerEvent<SVGRectElement>) => {
    if (!layout) return;
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    setActive(nearestIndex(layout.points, event.clientX - rect.left));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const lastIndex = points.length - 1;
    const current = active ?? lastIndex;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = Math.max(0, current - (active === null ? 0 : 1));
    else if (event.key === 'ArrowRight')
      next = Math.min(lastIndex, current + (active === null ? 0 : 1));
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = lastIndex;
    else if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const activePoint = active !== null ? layout?.points[active] : undefined;
  const activeData = active !== null ? points[active] : undefined;
  const showDots =
    layout !== null &&
    (points.length === 1 || (layout.right - layout.left) / (points.length - 1) >= MIN_DOT_GAP);
  return (
    <figure className="pl-chart">
      <div
        ref={boxRef}
        className="pl-chart__box"
        tabIndex={0}
        role="group"
        aria-label="График накопленного нетто. Стрелки влево и вправо — по вечерам"
        aria-describedby={liveId}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {layout && (
          <svg
            className="pl-chart__svg"
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={summary}
          >
            {layout.ticks.map((tick) => (
              <g key={tick.value}>
                {tick.value !== 0 && (
                  <line
                    className="pl-chart__grid"
                    x1={layout.left}
                    x2={layout.right}
                    y1={tick.y}
                    y2={tick.y}
                  />
                )}
                <text
                  className="pl-chart__tick"
                  x={layout.left - 8}
                  y={tick.y}
                  dy="0.32em"
                  textAnchor="end"
                >
                  {formatNumber(tick.value)}
                </text>
              </g>
            ))}
            <line
              className="pl-chart__zero"
              x1={layout.left}
              x2={layout.right}
              y1={layout.zeroY}
              y2={layout.zeroY}
            />

            <text
              className="pl-chart__tick"
              x={layout.left}
              y={HEIGHT - 6}
              textAnchor={points.length === 1 ? 'middle' : 'start'}
              dx={points.length === 1 ? (layout.right - layout.left) / 2 : 0}
            >
              {formatShortDate(first.date)}
            </text>
            {points.length > 1 && (
              <text className="pl-chart__tick" x={layout.right} y={HEIGHT - 6} textAnchor="end">
                {formatShortDate(last.date)}
              </text>
            )}

            {activePoint && (
              <line
                className="pl-chart__cross"
                x1={activePoint.x}
                x2={activePoint.x}
                y1={layout.top}
                y2={layout.bottom}
              />
            )}

            <path className="pl-chart__line" d={linePath(layout.points)} />

            {layout.points.map((p, i) =>
              showDots || i === layout.points.length - 1 ? (
                <circle key={i} className="pl-chart__dot" cx={p.x} cy={p.y} r={4} />
              ) : null,
            )}
            {activePoint && (
              <circle
                className="pl-chart__dot pl-chart__dot--active"
                cx={activePoint.x}
                cy={activePoint.y}
                r={6}
              />
            )}

            {/* Зона касания больше линии: весь прямоугольник графика. */}
            <rect
              className="pl-chart__hit"
              x={0}
              y={0}
              width={width}
              height={HEIGHT}
              onPointerDown={pick}
              onPointerMove={(event) => {
                if (event.pointerType === 'mouse' || event.buttons > 0) pick(event);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse') setActive(null);
              }}
            />
          </svg>
        )}

        {activePoint && activeData && layout && (
          <div
            className="pl-chart__tip"
            style={{
              left: Math.min(Math.max(activePoint.x, 80), width - 80),
              top: activePoint.y < HEIGHT / 2 ? activePoint.y + 14 : undefined,
              bottom: activePoint.y >= HEIGHT / 2 ? HEIGHT - activePoint.y + 14 : undefined,
            }}
            aria-hidden="true"
          >
            <span className="pl-chart__tip-date">{formatShortDate(activeData.date)}</span>
            <span className="m-mono">вечер {formatRubSigned(activeData.netRub)}</span>
            <span className="m-mono pl-chart__tip-total">
              итого {formatRubSigned(activeData.cumulativeRub)}
            </span>
          </div>
        )}
      </div>
      <p id={liveId} className="sr-only" aria-live="polite">
        {activeData
          ? `${formatShortDate(activeData.date)}: вечер ${formatRubSigned(activeData.netRub)}, итого ${formatRubSigned(activeData.cumulativeRub)}`
          : summary}
      </p>
      <figcaption className="m-small pl-chart__caption">
        Сумма в рублях после каждого вечера, пунктир — ноль. Коснитесь графика, чтобы увидеть вечер.
      </figcaption>
    </figure>
  );
}
