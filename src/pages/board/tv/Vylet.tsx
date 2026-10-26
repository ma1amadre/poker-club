// Красный флап «ВЫЛЕТ» (макет v3): ячейка 38 (буква «Ы» не зажата), без вырезов оси, шов — тоном.
// Буквы встают по одной (шаг 70 мс) через случайную букву; fold — флап складывается (ячейки уходят
// в пусто и гаснут), потом onFolded — на его месте встаёт тихое «6-е место». Сложить велели раньше,
// чем флап встал (игрок уже вернулся в игру ребаем или вылет отменили), — флап не встаёт вовсе.
import { useLayoutEffect, useRef } from 'react';
import { FlapRow, type FlapRowStyle } from './flap';
import { useLatest, useMotion } from './motionContext';

const VYLET_STYLE: FlapRowStyle = {
  w: 38,
  h: 50,
  fs: 40,
  wt: 800,
  ink: 'var(--on-accent)',
  bg: 'var(--critical)',
  bgb: 'var(--tv-critical-bottom)',
  s: 2,
  gap: 3,
  dy: 1,
  cellCls: 'tv-fp--notch',
  ax: false,
};

const WORD = 'ВЫЛЕТ';

export function Vylet({ fold = false, onFolded }: { fold?: boolean; onFolded?: () => void }) {
  const { motion, riffle } = useMotion();
  const host = useRef<HTMLSpanElement>(null);
  const row = useRef<FlapRow | null>(null);
  const folded = useRef(false);
  const done = useLatest(onFolded);
  const foldNow = useLatest(fold);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new FlapRow(motion, riffle, el, ' '.repeat(WORD.length), VYLET_STYLE);
    row.current = r;
    const ids: number[] = [];
    if (foldNow.current) {
      folded.current = true;
      ids.push(motion.after(0, () => done.current?.()));
      return () => {
        for (const id of ids) motion.cancel(id);
        r.el.remove();
        row.current = null;
      };
    }
    folded.current = false;
    r.flaps.forEach((cell, i) => {
      cell.el.style.opacity = '0';
      const ch = WORD[i] ?? ' ';
      ids.push(
        motion.after(i * 70, () => {
          cell.el.style.opacity = '1';
          if (motion.calm) {
            cell.set(ch);
            motion.A(cell.el, [{ opacity: 0 }, { opacity: 1 }], 200, { keep: true });
            return;
          }
          cell.flip(ch, { via: riffle.take(ch, 1) });
        }),
      );
    });
    return () => {
      for (const id of ids) motion.cancel(id);
      r.el.remove();
      row.current = null;
    };
  }, [motion, riffle, foldNow, done]);

  useLayoutEffect(() => {
    const r = row.current;
    if (!fold || !r || folded.current) return;
    folded.current = true;
    r.flaps.forEach((cell, i) =>
      motion.after(i * 40, () => {
        cell.flip(' ', { bounce: false });
        motion.fade(cell.el, 0, 160, { delay: cell.fall + 20 });
      }),
    );
    motion.after(WORD.length * 40 + 420, () => done.current?.());
  }, [fold, motion, done]);

  return <span ref={host} className="tv-vylet" role="img" aria-label="Вылет" />;
}
