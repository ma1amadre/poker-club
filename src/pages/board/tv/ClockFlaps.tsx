// Часы табло ТВ флапами (макет v3): минуты — главные, перелистываются раз в минуту; секунды — на 0,6
// и тише, без движения. Последняя минута уровня — секунды выходят вперёд (растут до размера минут,
// красные, флапами), минуты «00» уходят на 0,6 и в серый: ширина часов та же, раскладка не прыгает.
// drum — смена текста перелистывается барабаном по всем цифрам (часы на полную длину уровня в
// заставке смены уровня).
import { useLayoutEffect, useRef, useState } from 'react';
import { Flap, type FlapStyle } from './flap';
import { clockParts, drumVia } from './flapLogic';
import { devMark, EASE } from './motion';
import { useMotion } from './motionContext';

export type ClockTone = 'run' | 'muted';

const HERO: FlapStyle = { w: 156, h: 224, fs: 216, wt: 800, s: 3, dy: 2 };
const SS_REST = 'scale(0.6)';
const SS_LAST = 'translateX(-128px) scale(1)';
/** Ширина минут при двух цифрах: секунды стоят от x 328. */
const MM_WIDTH = 320;

function minuteStyle(digits: number, ink: string): FlapStyle {
  if (digits <= 2) return { ...HERO, ink };
  // Три цифры минут (уровень дольше 99 минут) — плитки уже, часы той же ширины.
  const w = Math.floor((MM_WIDTH - 8 * (digits - 1)) / digits);
  return { ...HERO, w, fs: Math.round(w * 1.38), ink };
}

export interface ClockFlapsProps {
  text: string;
  /** Последняя минута уровня. */
  final: boolean;
  tone: ClockTone;
  /** Смена — барабаном по всем цифрам. */
  drum: boolean;
  /** Часы стоят на том, что показано (заставка уровня ещё не дошла до такта часов). */
  frozen: boolean;
}

export function ClockFlaps({ text, final: finalNow, tone, drum, frozen }: ClockFlapsProps) {
  const { motion, riffle } = useMotion();
  const mmRef = useRef<HTMLDivElement>(null);
  const ssRef = useRef<HTMLDivElement>(null);
  const colonRef = useRef<HTMLSpanElement>(null);
  const mm = useRef<Flap[]>([]);
  const ss = useRef<Flap[]>([]);
  const shown = useRef<string | null>(null);
  const lastMinute = useRef<boolean | null>(null);
  // Пока часы стоят, и «последняя минута» остаётся какой была: секунды не уходят назад раньше такта.
  const [heldFinal, setHeldFinal] = useState(finalNow);
  if (!frozen && heldFinal !== finalNow) setHeldFinal(finalNow);
  const final = frozen ? heldFinal : finalNow;

  const mmInk = final ? 'var(--neutral-9)' : tone === 'run' ? 'var(--accent)' : 'var(--ink-muted)';
  const ssInk = final ? 'var(--critical)' : 'var(--ink-muted)';

  // Цифры: первый кадр — сразу; минуты — переворот; секунды — без движения, флапами только в
  // последнюю минуту; drum — барабаном все. Другое число цифр минут — минуты пересобираются.
  useLayoutEffect(() => {
    const mmEl = mmRef.current;
    const ssEl = ssRef.current;
    if (!mmEl || !ssEl || (frozen && shown.current !== null)) return;
    const { minutes, seconds } = clockParts(text);
    let fresh = shown.current === null;
    if (mm.current.length !== minutes.length) {
      for (const f of mm.current) f.el.remove();
      mm.current = [...minutes].map(
        (c) => new Flap(motion, mmEl, minuteStyle(minutes.length, mmInk), c),
      );
      fresh = true;
    }
    if (ss.current.length !== seconds.length) {
      for (const f of ss.current) f.el.remove();
      ss.current = [...seconds].map((c) => new Flap(motion, ssEl, { ...HERO, ink: ssInk }, c));
    }
    const prev = shown.current;
    shown.current = text;
    if (fresh || prev === null) {
      [...minutes].forEach((c, i) => mm.current[i]?.set(c));
      [...seconds].forEach((c, i) => ss.current[i]?.set(c));
      return;
    }
    const digits: [Flap | undefined, string, boolean][] = [
      ...[...minutes].map(
        (c, i) => [mm.current[i], c, true] as [Flap | undefined, string, boolean],
      ),
      ...[...seconds].map(
        (c, i) => [ss.current[i], c, false] as [Flap | undefined, string, boolean],
      ),
    ];
    if (!drum && prev !== null && clockParts(prev).minutes !== minutes) devMark('minute');
    digits.forEach(([flap, c, isMinute], i) => {
      if (!flap || flap.want === c) return;
      if (drum) flap.flip(c, { via: drumVia(flap.ch, c, 'up', 2, riffle), delay: i * 80 });
      else if (isMinute || final) flap.flip(c);
      else flap.set(c);
    });
  }, [text, drum, final, frozen, mmInk, ssInk, motion, riffle]);

  // Цвет и последняя минута: секунды выходят вперёд, минуты уходят на 0,6.
  useLayoutEffect(() => {
    const mmEl = mmRef.current;
    const ssEl = ssRef.current;
    if (!mmEl || !ssEl) return;
    for (const f of mm.current) f.setInk(mmInk);
    for (const f of ss.current) f.setInk(ssInk);
    colonRef.current?.style.setProperty('--colon', final ? 'var(--critical)' : 'var(--ink-muted)');
    const was = lastMinute.current;
    lastMinute.current = final;
    if (was === final) return;
    const m1 = final ? 'scale(0.6)' : 'scale(1)';
    const s1 = final ? SS_LAST : SS_REST;
    if (was === null || motion.calm) {
      motion.cancelOn(mmEl);
      motion.cancelOn(ssEl);
      mmEl.style.transform = m1;
      ssEl.style.transform = s1;
      return;
    }
    motion.move(mmEl, final ? 'scale(1)' : 'scale(0.6)', m1, 520, { easing: EASE.move });
    motion.move(ssEl, final ? SS_REST : SS_LAST, s1, 520, { easing: EASE.move });
  }, [final, mmInk, ssInk, motion]);

  useLayoutEffect(
    () => () => {
      for (const f of [...mm.current, ...ss.current]) f.el.remove();
      mm.current = [];
      ss.current = [];
    },
    [],
  );

  return (
    <>
      <div ref={mmRef} className="tv-clock__mm" />
      <div ref={ssRef} className="tv-clock__ss">
        <span ref={colonRef} className="tv-clock__colon" aria-hidden="true">
          <i style={{ top: 66 }} />
          <i style={{ top: 138 }} />
        </span>
      </div>
    </>
  );
}
