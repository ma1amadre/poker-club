// Строка флапов как React-компонент: ряд создаётся один раз, при смене текста переворачиваются только
// изменившиеся позиции (FlapRow). flip — как переворачивать (барабан, перебор, шаг); null — поставить
// без движения (тик секунд, первый кадр). Плитка (style.w, style.fs) может смениться — пересобранные
// ячейки встанут с новой; остальной стиль — на время жизни ряда (другой — родитель меняет key).
// Для скринридера текст строки — в aria-label обёртки.
import { useLayoutEffect, useRef } from 'react';
import { FlapRow, type FlapRowStyle, type RowFlipOptions } from './flap';
import { useMotion } from './motionContext';

export interface FlapTextProps {
  text: string;
  style: FlapRowStyle;
  /** Как переворачивать при смене текста; null — сразу, без движения. */
  flip?: RowFlipOptions | null;
  /** Цвет знаков (меняется без переворота). */
  ink?: string;
  className?: string;
  label?: string;
}

export function FlapText({ text, style, flip = {}, ink, className, label }: FlapTextProps) {
  const { motion, riffle } = useMotion();
  const host = useRef<HTMLSpanElement>(null);
  const row = useRef<FlapRow | null>(null);
  // Ряд создаётся по первому тексту и стилю: стиль после монтирования не меняется (key у родителя).
  const initial = useRef({ text, style });

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const r = new FlapRow(motion, riffle, el, initial.current.text, initial.current.style);
    row.current = r;
    return () => {
      r.el.remove();
      row.current = null;
    };
  }, [motion, riffle]);

  useLayoutEffect(() => {
    const r = row.current;
    if (!r || r.text === text) return;
    // Плитка ряда могла смениться (блайнды ужимаются под шесть цифр): пересобранные ячейки — с ней.
    r.setTile(style.w, style.fs);
    if (flip === null) r.set(text);
    else r.flip(text, flip);
    // flip — описание движения, а не данные: переворот запускает только новый текст (проверка выше).
  }, [text, style.w, style.fs, flip]);

  useLayoutEffect(() => {
    if (ink) row.current?.setInk(ink);
  }, [ink]);

  return (
    <span
      ref={host}
      className={className ? `tv-flaptext ${className}` : 'tv-flaptext'}
      role={label ? 'img' : undefined}
      aria-label={label}
    />
  );
}
