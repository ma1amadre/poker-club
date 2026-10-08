// Вид пульта банкира: «Стол» (режим стола — всё под рукой без прокрутки) или «Подробно» (прежний
// экран: часы, пульт кнопками, статы, список игроков). Выбор помнит localStorage — только удобство
// этого устройства: приватное окно, запрет хранилища или мусор в ключе — «Стол» по умолчанию.
// Хранилище — параметром: функции чистые, тесты подставляют своё; usePultView — для экрана.
import { useCallback, useState } from 'react';

export type PultView = 'table' | 'details';

export const PULT_VIEW_KEY = 'poker-club:pult-view';
export const DEFAULT_PULT_VIEW: PultView = 'table';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Хранилище браузера или null, если к нему нельзя даже обратиться. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPultView(storage: StorageLike | null): PultView {
  try {
    const value = storage?.getItem(PULT_VIEW_KEY);
    return value === 'table' || value === 'details' ? value : DEFAULT_PULT_VIEW;
  } catch {
    return DEFAULT_PULT_VIEW;
  }
}

export function writePultView(storage: StorageLike | null, view: PultView): void {
  try {
    storage?.setItem(PULT_VIEW_KEY, view);
  } catch {
    // Приватное окно или запрет хранилища — выбор живёт до перезагрузки.
  }
}

/** Вид пульта на экране вечера: из localStorage при открытии, смена — сразу туда же. */
export function usePultView(): [PultView, (view: PultView) => void] {
  const [view, setView] = useState<PultView>(() => readPultView(browserStorage()));
  const change = useCallback((next: PultView) => {
    setView(next);
    writePultView(browserStorage(), next);
  }, []);
  return [view, change];
}
