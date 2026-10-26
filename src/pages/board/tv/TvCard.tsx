// Игральная карта и масть табло ТВ (макет v3): лицо --card-face, ранг моно в левом верхнем углу,
// масть значком (SVG, не символом шрифта) в правом нижнем; рубашка — surface с внутренней рамкой.
// Вскрытие: рубашка уходит на ребро (200 мс), лицо встаёт (250 мс); спокойно — затухание; на
// слабом ТВ — scaleX вместо поворота.
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { rankLabel, suitOfCode, type SuitCode } from '../../../shared/lib/poker/cards';
import { EASE } from './motion';
import { useMotion } from './motionContext';

const SUIT_PATHS: Record<SuitCode, string[]> = {
  s: [
    'M50 4C62 22 93 38 93 61C93 75 83 84 71 84C62 84 56 80 53 74C54 83 58 90 66 96H34C42 90 46 83 47 74C44 80 38 84 29 84C17 84 7 75 7 61C7 38 38 22 50 4Z',
  ],
  h: [
    'M50 93C24 71 5 54 5 32C5 17 16 6 29 6C38 6 46 11 50 20C54 11 62 6 71 6C84 6 95 17 95 32C95 54 76 71 50 93Z',
  ],
  d: ['M50 2C58 22 72 38 90 50C72 62 58 78 50 98C42 78 28 62 10 50C28 38 42 22 50 2Z'],
  c: ['M45 54H55C55 74 59 87 67 96H33C41 87 45 74 45 54Z'],
};
const CLUB_CIRCLES: [number, number, number][] = [
  [50, 27, 20],
  [26, 58, 20],
  [74, 58, 20],
  [50, 52, 12],
];

const isRedSuit = (s: SuitCode): boolean => s === 'h' || s === 'd';

export function SuitIcon({
  suit,
  size,
  className,
}: {
  suit: SuitCode;
  size: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill={isRedSuit(suit) ? 'var(--suit-red)' : 'var(--card-ink)'}
      aria-hidden="true"
    >
      {suit === 'c' &&
        CLUB_CIRCLES.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
      {SUIT_PATHS[suit].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export interface TvCardProps {
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Открыта (лицом вверх). */
  open: boolean;
  /**
   * Вскрыть с движением через delay мс после того, как open стал true; карта, которая сразу
   * появилась открытой (карта стола в гнезде), до вскрытия лежит рубашкой. null — сразу лицом.
   */
  flipDelay?: number | null;
  className?: string;
  style?: CSSProperties;
}

/**
 * Карта на позиции (px кадра). Пока open false — рубашка; open стал true (или карта появилась
 * открытой) — вскрытие с движением, если задан flipDelay, иначе сразу лицом.
 */
export function TvCard({
  code,
  x,
  y,
  w,
  h,
  open,
  flipDelay = null,
  className,
  style,
}: TvCardProps) {
  const { motion } = useMotion();
  const back = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const shownOpen = useRef<boolean | null>(null);
  const suit = suitOfCode(code);

  useLayoutEffect(() => {
    const b = back.current;
    const f = face.current;
    if (!b || !f) return;
    const was = shownOpen.current;
    shownOpen.current = open;
    if (was === open) return;
    motion.cancelOn(b);
    motion.cancelOn(f);
    if (!open) {
      b.style.transform = 'none';
      b.style.opacity = '1';
      f.style.transform = motion.lite ? 'scaleX(0)' : 'rotateY(-90deg)';
      f.style.opacity = '1';
      return;
    }
    if (flipDelay === null) {
      b.style.transform = 'rotateY(90deg)';
      f.style.transform = 'none';
      f.style.opacity = '1';
      return;
    }
    if (was === null) {
      // Карта легла открытой с выдержкой (карта стола в гнезде): сначала рубашкой, лицо — после
      // выдержки, как у карты, которая лежала закрытой.
      b.style.transform = 'none';
      b.style.opacity = '1';
      f.style.transform = motion.lite ? 'scaleX(0)' : 'rotateY(-90deg)';
      f.style.opacity = '1';
    }
    if (motion.calm) {
      f.style.transform = 'none';
      f.style.opacity = '0';
      motion.A(b, [{ opacity: 1 }, { opacity: 0 }], 200, { delay: flipDelay, keep: true });
      motion.A(f, [{ opacity: 0 }, { opacity: 1 }], 200, { delay: flipDelay, keep: true });
      return;
    }
    const k = motion.lite
      ? (a: number) => `scaleX(${Math.cos((a * Math.PI) / 180).toFixed(3)})`
      : (a: number) => `rotateY(${a}deg)`;
    motion.A(b, [{ transform: k(0) }, { transform: motion.lite ? 'scaleX(0)' : k(90) }], 200, {
      delay: flipDelay,
      easing: EASE.turn,
      keep: true,
    });
    motion.A(f, [{ transform: motion.lite ? 'scaleX(0)' : k(-90) }, { transform: k(0) }], 250, {
      delay: flipDelay + 200,
      easing: EASE.enter,
      keep: true,
    });
  }, [open, flipDelay, motion]);

  return (
    <div
      className={`tv-card${className ? ` ${className}` : ''}`}
      style={{ left: x, top: y, width: w, height: h, ...style }}
      aria-hidden="true"
    >
      <div ref={back} className="tv-card__side tv-card__back" />
      <div
        ref={face}
        className={`tv-card__side tv-card__face${isRedSuit(suit) ? ' tv-card__face--red' : ''}`}
      >
        <span className="tv-card__rank" style={{ fontSize: Math.round(w * 0.5) }}>
          {rankLabel(code.charAt(0))}
        </span>
        <SuitIcon suit={suit} size={Math.round(w * 0.4)} className="tv-card__suit" />
      </div>
    </div>
  );
}
