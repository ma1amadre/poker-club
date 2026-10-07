// Табло на ТВ не прокрутить: всё, что ниже экрана, не увидит никто. Панель олл-ина рассчитана так,
// чтобы помещаться сама (showdown.css: размеры в долях экрана, раскладка по числу рук), но её высота
// зависит и от содержания — длинный список аутов в узкой колонке, лишние строки в подвале табло,
// низкий экран. Тогда useFitToScreen уменьшает всё в панели через CSS-переменную --sd-fit (от 1 до
// FIT_MIN): масштаб подбирается двоичным поиском по настоящей раскладке — поставить, измерить, есть
// ли прокрутка. Только в раскладке ТВ (TV_QUERY): на телефоне табло листается, там масштаб — 1.
import { useLayoutEffect, type RefObject } from 'react';

/** Раскладка ТВ — та же граница, что в board.css и showdown.css. */
export const TV_QUERY = '(min-width: 1024px) and (orientation: landscape)';
/** Мельче не уменьшаем: дальше текст с дивана уже не прочитать. */
export const FIT_MIN = 0.6;
/** Шагов двоичного поиска: точность масштаба — (1 − FIT_MIN) / 2^6, меньше процента. */
const FIT_STEPS = 6;

/**
 * Наибольший масштаб из [min, 1], при котором fits(масштаб) — true. fits монотонна: что поместилось
 * крупнее, поместится и мельче. Не помещается и при min — min (лучше мелко, чем обрезано).
 * Последним fits вызывается с возвращаемым масштабом — раскладка остаётся в нём.
 */
export function bestFit(
  fits: (scale: number) => boolean,
  min = FIT_MIN,
  steps = FIT_STEPS,
): number {
  if (fits(1)) return 1;
  let lo = min;
  let hi = 1;
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  fits(lo);
  return lo;
}

/**
 * Держит содержимое `ref` в экране: при каждом `contentKey` (другая раздача или улица), смене
 * размера окна и изменении высоты страницы (пришли шансы, загрузился шрифт, появилась строка в
 * подвале) масштаб подбирается заново — с 1, чтобы панель снова стала крупной, когда место есть.
 */
export function useFitToScreen(ref: RefObject<HTMLElement | null>, contentKey: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia?.(TV_QUERY);
    const root = document.documentElement;
    let last = '';
    const set = (scale: number) => {
      const value = String(scale);
      if (value !== last) el.style.setProperty('--sd-fit', value);
      last = value;
    };
    const fit = () => {
      if (!media?.matches) {
        set(1);
        return;
      }
      bestFit((scale) => {
        set(scale);
        // Чтение scrollHeight — синхронная раскладка: масштаб уже применён.
        return root.scrollHeight <= window.innerHeight;
      });
    };
    fit();

    // Пересчёт — не чаще раза за кадр и не внутри колбэка ResizeObserver (иначе браузер ругается
    // на цикл: fit сам меняет размеры). Высота страницы (body) растёт, когда что-то вылезло за
    // экран: пришли шансы, загрузился шрифт, в подвале появилась строка. Повторный fit даёт тот же
    // масштаб — размеры не меняются, цикла нет.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(document.body);
    observer?.observe(el);
    window.addEventListener('resize', schedule);
    media?.addEventListener?.('change', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      media?.removeEventListener?.('change', schedule);
    };
  }, [ref, contentKey]);
}
