import { useCallback, useState } from 'react';

/**
 * Ширина элемента в пикселях (ResizeObserver): SVG графика рисуется в реальную ширину, а не
 * растягивается через viewBox — иначе подписи и толщина линий плывут вместе с масштабом.
 * Возвращает ref-колбэк (React 19: колбэк возвращает очистку) и текущую ширину, 0 — ещё не измерено.
 */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => () => void, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: T | null) => {
    if (!node) return () => {};
    setWidth(Math.round(node.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return () => {};
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
