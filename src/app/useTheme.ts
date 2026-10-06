import { useEffect } from 'react';
import { getColorScheme, onTelegramEvent } from '../shared/telegram';

/** data-theme на <html>: по нему tokens.css выбирает фолбэки светлой или тёмной темы. */
export function applyColorScheme(): void {
  document.documentElement.dataset.theme = getColorScheme();
}

/**
 * Держит data-theme в синхроне со схемой: в Telegram — по событию themeChanged (переменные
 * --tg-theme-* SDK обновляет сам), в браузере — по смене системной темы.
 */
export function useColorSchemeSync(): void {
  useEffect(() => {
    applyColorScheme();
    const offTelegram = onTelegramEvent('themeChanged', applyColorScheme);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', applyColorScheme);
    return () => {
      offTelegram();
      media?.removeEventListener?.('change', applyColorScheme);
    };
  }, []);
}
