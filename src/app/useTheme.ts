// Регистр на <html data-theme>. Всё приложение и ТВ-табло — «Терминал» (styles/terminal-theme.css,
// DESIGN.md): только тёмный, схема Telegram и системы регистр больше не переключает. Кобальт и Янтарь
// остаются только в dev-витринах (/dev/kit, /dev/kit-yantar — useThemeOverride и ThemeScope). Один
// экран — один регистр: регистр ставится на весь документ, а не на контейнер.
//
// Цвета приложения берутся ТОЛЬКО из токенов регистра; тема Telegram (--tg-theme-*) не
// используется. Наоборот, шапку, фон и нижнюю панель Telegram красим в токен ground, чтобы при
// оттягивании и на стыках не мелькал чужой цвет.
import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { getWebApp, isInTelegram, onTelegramEvent, supports } from '../shared/telegram';

export type AppTheme = 'kobalt' | 'kobalt-dark' | 'yantar' | 'terminal';

// Стек принудительных регистров: витрины в dev (и табло — явно «Терминал»). Верхний побеждает.
const overrides: { theme: AppTheme }[] = [];

/** Регистр обычных экранов — всегда «Терминал», от схемы Telegram и системы не зависит. */
export function baseTheme(): AppTheme {
  return 'terminal';
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

/** Поставить регистр на <html>: верхний принудительный (витрины dev, табло) или базовый. */
export function applyTheme(): void {
  const theme = overrides.at(-1)?.theme ?? baseTheme();
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  syncTelegramChrome();
}

/**
 * Ставит регистр при запуске и по событию themeChanged Telegram заново красит его шапку, фон и
 * нижнюю панель в ground: регистр от схемы не зависит, а цвета шапки Telegram при смене темы может
 * вернуть к своим. Вызывается один раз в App.
 */
export function useThemeSync(): void {
  useEffect(() => {
    applyTheme();
    return onTelegramEvent('themeChanged', () => applyTheme());
  }, []);
}

/**
 * Принудительный регистр, пока смонтирован экран (витрины dev). При уходе с экрана регистр
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

/** Обёртка маршрута с принудительным регистром: <ThemeScope theme="yantar"><KitYantarPage /></ThemeScope>. */
export function ThemeScope({ theme, children }: { theme: AppTheme; children: ReactNode }) {
  useThemeOverride(theme);
  return children;
}
