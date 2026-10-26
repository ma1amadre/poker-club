// Часы и анимации табло ТВ (Motion) для компонентов экрана: один экземпляр на табло, его создаёт
// MotionProvider. Здесь — контекст и хуки (без компонентов: файл компонентов — MotionProvider.tsx).
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { Riffle } from './flapLogic';
import type { Motion } from './motion';

export interface MotionValue {
  motion: Motion;
  riffle: Riffle;
}

export const MotionCtx = createContext<MotionValue | null>(null);

export function useMotion(): MotionValue {
  const value = useContext(MotionCtx);
  if (!value) throw new Error('useMotion вне MotionProvider');
  return value;
}

/** Последнее значение в ref — для тактов, которые срабатывают позже рендера (после коммита). */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
