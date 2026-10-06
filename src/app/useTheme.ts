// Регистр «Материи» на <html data-theme>. Всё приложение — Кобальт: kobalt или kobalt-dark по
// светлой/тёмной схеме Telegram (вне Telegram — по системной). Табло для ТВ (/board/:token) —
// Янтарь. Один экран — один регистр: регистр ставится на весь документ, а не на контейнер.
//
// Цвета приложения берутся ТОЛЬКО из токенов «Материи»; тема Telegram (--tg-theme-*) не
// используется. Наоборот, шапку, фон и нижнюю панель Telegram красим в токен ground, чтобы при
// оттягивании и на стыках не мелькал чужой цвет.
import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import {
  getColorScheme,
  getWebApp,
  isInTelegram,
  onTelegramEvent,
  supports,
} from '../shared/telegram';

export type AppTheme = 'kobalt' | 'kobalt-dark' | 'yantar';

// Стек принудительных регистров: табло (yantar) и витрина кита в dev. Верхний побеждает.
const overrides: { theme: AppTheme }[] = [];

/** Регистр по схеме Telegram/системы — то, что видно на обычных экранах приложения. */
export function baseTheme(): AppTheme {
  return getColorScheme() === 'dark' ? 'kobalt-dark' : 'kobalt';
}

/** Hash-адрес табло: регистр нужен до монтирования роутера, иначе первый кадр будет в Кобальте. */
export function isBoardHash(hash = window.location.hash): boolean {
  return hash.startsWith('#/board/');
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Шапка, фон и нижняя панель Telegram — цветом ground текущего регистра. */
function syncTelegramChrome(): void {
  const app = getWebApp();
  if (!app || !isInTelegram()) return;
  const ground = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
  if (!HEX.test(ground)) return;
  // setBackgroundColor принимает #RRGGBB с 6.1, setHeaderColor — с 6.9 (раньше только ключи
  // темы Telegram), setBottomBarColor появился в 7.10.
  if (supports('6.1')) app.setBackgroundColor(ground);
  if (supports('6.9')) app.setHeaderColor(ground);
  if (supports('7.10')) app.setBottomBarColor?.(ground);
}

/**
 * Поставить регистр на <html>. Без аргумента — верхний принудительный или базовый.
 * `initial` — подсказка до монтирования React (main.tsx: табло по hash).
 */
export function applyTheme(initial?: AppTheme): void {
  const theme = overrides.at(-1)?.theme ?? initial ?? baseTheme();
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  syncTelegramChrome();
}

/**
 * Держит регистр в синхроне со схемой: в Telegram — по событию themeChanged, в браузере — по смене
 * системной темы. Вызывается один раз в App.
 */
export function useThemeSync(): void {
  useEffect(() => {
    const onChange = () => applyTheme();
    applyTheme();
    const offTelegram = onTelegramEvent('themeChanged', onChange);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', onChange);
    return () => {
      offTelegram();
      media?.removeEventListener?.('change', onChange);
    };
  }, []);
}

/**
 * Принудительный регистр, пока смонтирован экран (табло — yantar). При уходе с экрана регистр
 * возвращается к базовому. useLayoutEffect — смена до отрисовки, без кадра в чужом регистре.
 */
export function useThemeOverride(theme: AppTheme | null): void {
  useLayoutEffect(() => {
    if (!theme) return;
    const entry = { theme };
    overrides.push(entry);
    applyTheme();
    return () => {
      const index = overrides.lastIndexOf(entry);
      if (index >= 0) overrides.splice(index, 1);
      applyTheme();
    };
  }, [theme]);
}

/** Обёртка маршрута с принудительным регистром: <ThemeScope theme="yantar"><BoardPage /></ThemeScope>. */
export function ThemeScope({ theme, children }: { theme: AppTheme; children: ReactNode }) {
  useThemeOverride(theme);
  return children;
}
