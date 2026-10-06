import { useEffect } from 'react';
import { getWebApp, supports } from './webapp';

// Подтверждение закрытия у Telegram одно на всё приложение, а просить его могут несколько экранов
// сразу (редактор + форма) — считаем включения, выключаем, когда не осталось ни одного.
let active = 0;

function apply(): void {
  if (!supports('6.2')) return;
  const app = getWebApp();
  if (active > 0) app?.enableClosingConfirmation?.();
  else app?.disableClosingConfirmation?.();
}

/**
 * Пока active — Telegram спросит «закрыть?» при закрытии Mini App (свайп вниз, крестик). Для
 * несохранённых правок: beforeunload внутри Telegram не срабатывает.
 */
export function useClosingConfirmation(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    active += 1;
    apply();
    return () => {
      active -= 1;
      apply();
    };
  }, [enabled]);
}
