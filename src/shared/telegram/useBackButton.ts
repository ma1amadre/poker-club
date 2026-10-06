import { useCallback, useEffect, useEffectEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getBackButton } from './webapp';

// У Telegram одна кнопка «Назад» на всё приложение, а подписчиков может быть несколько
// (экран + открытая поверх шторка). Срабатывать должен только верхний — держим стек.
type Entry = { run: () => void };
const stack: Entry[] = [];
let clickAttached = false;

function dispatch(): void {
  stack[stack.length - 1]?.run();
}

function sync(): void {
  const button = getBackButton();
  if (!button) return;
  if (!clickAttached) {
    button.onClick(dispatch);
    clickAttached = true;
  }
  if (stack.length > 0) button.show();
  else button.hide();
}

export interface UseBackButtonOptions {
  /** false — кнопку не показывать (например, шторка закрыта). По умолчанию true. */
  enabled?: boolean;
  /** Своё действие вместо навигации назад (закрыть шторку и т. п.). */
  onBack?: () => void;
  /** Куда идти, если экран открыт первым (по прямой ссылке) и истории нет. По умолчанию '/'. */
  fallback?: string;
}

/**
 * Нативная кнопка «Назад» Telegram для вложенных экранов. Возвращает ту же функцию «назад» —
 * её вешают на собственную кнопку в шапке, которая видна только вне Telegram.
 */
export function useBackButton(options: UseBackButtonOptions = {}): () => void {
  const { enabled = true, onBack, fallback = '/' } = options;
  const navigate = useNavigate();
  const location = useLocation();

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    // key 'default' — первая запись истории приложения: «назад» увёл бы из Mini App.
    if (location.key !== 'default') navigate(-1);
    else navigate(fallback, { replace: true });
  }, [onBack, location.key, navigate, fallback]);

  const onClick = useEffectEvent(() => goBack());

  useEffect(() => {
    if (!enabled) return;
    const entry: Entry = { run: () => onClick() };
    stack.push(entry);
    sync();
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      sync();
    };
  }, [enabled]);

  return goBack;
}
