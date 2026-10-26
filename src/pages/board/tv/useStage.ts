// Раскладка ТВ и масштаб кадра 1920×1080: табло на ТВ (от 1024 px в горизонтали) — кадр макета,
// вписанный в экран целиком; на телефоне — прежняя колонка.
import { useSyncExternalStore } from 'react';
import { TV_QUERY } from '../fitToScreen';

function subscribeTv(onChange: () => void): () => void {
  const media = window.matchMedia?.(TV_QUERY);
  media?.addEventListener?.('change', onChange);
  return () => media?.removeEventListener?.('change', onChange);
}

/** Раскладка ТВ: кадр 1920×1080 со столом; иначе — колонка телефона. */
export function useTvLayout(): boolean {
  return useSyncExternalStore(
    subscribeTv,
    () => Boolean(window.matchMedia?.(TV_QUERY).matches),
    () => false,
  );
}

function stageScale(): number {
  if (typeof window === 'undefined') return 1;
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  return s > 0 && Number.isFinite(s) ? s : 1;
}

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/** Масштаб кадра: пикселей экрана на пиксель кадра 1920×1080. */
export function useStageScale(): number {
  return useSyncExternalStore(subscribeResize, stageScale, () => 1);
}

let fontsVersion = 0;
const fontListeners = new Set<() => void>();
let fontsHooked = false;

function bumpFonts(): void {
  fontsVersion += 1;
  for (const l of fontListeners) l();
}

function subscribeFonts(onChange: () => void): () => void {
  fontListeners.add(onChange);
  if (!fontsHooked && typeof document !== 'undefined' && document.fonts) {
    fontsHooked = true;
    document.fonts.addEventListener?.('loadingdone', bumpFonts);
    void document.fonts.ready.then(bumpFonts);
  }
  return () => fontListeners.delete(onChange);
}

/**
 * Растёт, когда догрузился шрифт: подгонку кегля по ширине (имена мест, карточка нокаута) надо
 * повторить — до загрузки Inter ширину мерили запасным шрифтом.
 */
export function useFontsVersion(): number {
  return useSyncExternalStore(
    subscribeFonts,
    () => fontsVersion,
    () => 0,
  );
}
