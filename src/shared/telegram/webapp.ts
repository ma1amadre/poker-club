// Типизированная обёртка над window.Telegram.WebApp (telegram-web-app.js из index.html).
// SDK определяет объект и в обычном браузере (версия '6.0', initData пустой), поэтому
// «мы в Telegram» определяем по непустому initData, а не по наличию объекта.

export type ColorScheme = 'light' | 'dark';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export interface TelegramInitDataUnsafe {
  query_id?: string;
  user?: TelegramUser;
  auth_date?: number;
  hash?: string;
  start_param?: string;
  chat_type?: string;
  chat_instance?: string;
}

export interface TelegramBackButton {
  isVisible: boolean;
  onClick(cb: () => void): TelegramBackButton;
  offClick(cb: () => void): TelegramBackButton;
  show(): TelegramBackButton;
  hide(): TelegramBackButton;
}

export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type NotificationType = 'error' | 'success' | 'warning';

export interface TelegramHapticFeedback {
  impactOccurred(style: ImpactStyle): TelegramHapticFeedback;
  notificationOccurred(type: NotificationType): TelegramHapticFeedback;
  selectionChanged(): TelegramHapticFeedback;
}

export type TelegramEvent = 'themeChanged' | 'viewportChanged' | 'backButtonClicked' | 'activated';

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe;
  version: string;
  platform: string;
  colorScheme: ColorScheme;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  BackButton: TelegramBackButton;
  HapticFeedback: TelegramHapticFeedback;
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(version: string): boolean;
  /** '#RRGGBB' (с 6.1) или ключ темы Telegram. */
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  /** Цвет нижней панели Telegram, с 7.10. */
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  onEvent(event: TelegramEvent, cb: () => void): void;
  offEvent(event: TelegramEvent, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Сырой объект SDK или null, если скрипт не загрузился (офлайн, блокировка telegram.org). */
export function getWebApp(): TelegramWebApp | null {
  return typeof window === 'undefined' ? null : (window.Telegram?.WebApp ?? null);
}

/** Открыто внутри Telegram: только там клиент передаёт подписанный initData. */
export function isInTelegram(): boolean {
  return Boolean(getWebApp()?.initData);
}

/** Метод SDK есть в этой версии клиента (иначе SDK лишь пишет warning в консоль). */
export function supports(version: string): boolean {
  const app = getWebApp();
  return Boolean(app && isInTelegram() && app.isVersionAtLeast(version));
}

export function getInitData(): string {
  return getWebApp()?.initData ?? '';
}

export function getInitDataUnsafe(): TelegramInitDataUnsafe {
  return getWebApp()?.initDataUnsafe ?? {};
}

/** Параметр прямой ссылки t.me/<bot>?startapp=<param>. */
export function getStartParam(): string | null {
  const fromInitData = getInitDataUnsafe().start_param;
  if (fromInitData) return fromInitData;
  // Фолбэк: часть клиентов кладёт его ещё и в query-строку страницы.
  try {
    return new URLSearchParams(window.location.search).get('tgWebAppStartParam');
  } catch {
    return null;
  }
}

/** Цветовая схема: в Telegram — схема клиента (светлая/тёмная), в браузере — системная. */
export function getColorScheme(): ColorScheme {
  if (isInTelegram()) return getWebApp()?.colorScheme ?? 'light';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ready(): void {
  if (!isInTelegram()) return;
  const app = getWebApp();
  app?.ready();
  app?.expand();
  // Цвета шапки, фона и нижней панели Telegram выставляет src/app/useTheme.ts — из токена ground
  // «Материи», а не из темы Telegram.
  // Свайп вниз в списках иначе сворачивает Mini App посреди ввода события.
  if (supports('7.7')) app?.disableVerticalSwipes?.();
}

export function expand(): void {
  if (isInTelegram()) getWebApp()?.expand();
}

/** Закрыть Mini App (экран «нет доступа»); вне Telegram ничего не делает. */
export function closeApp(): void {
  if (isInTelegram()) getWebApp()?.close();
}

export function onTelegramEvent(event: TelegramEvent, cb: () => void): () => void {
  const app = getWebApp();
  if (!app || !isInTelegram()) return () => {};
  app.onEvent(event, cb);
  return () => app.offEvent(event, cb);
}

/** Тактильный отклик; вне Telegram и на старых клиентах молча ничего не делает. */
export const haptic = {
  impact(style: ImpactStyle = 'light'): void {
    if (supports('6.1')) getWebApp()?.HapticFeedback.impactOccurred(style);
  },
  notify(type: NotificationType): void {
    if (supports('6.1')) getWebApp()?.HapticFeedback.notificationOccurred(type);
  },
  selection(): void {
    if (supports('6.1')) getWebApp()?.HapticFeedback.selectionChanged();
  },
};

/** Ссылка t.me/... внутри Telegram открывается без выхода из клиента; в браузере — новой вкладкой. */
export function openTelegramLink(url: string): void {
  if (isInTelegram()) {
    getWebApp()?.openTelegramLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Внешняя ссылка: внутри Telegram — системный браузер, иначе новая вкладка. */
export function openLink(url: string): void {
  if (isInTelegram()) {
    getWebApp()?.openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Нативная кнопка «Назад» в шапке Telegram доступна с версии 6.1. */
export function getBackButton(): TelegramBackButton | null {
  return supports('6.1') ? (getWebApp()?.BackButton ?? null) : null;
}

/**
 * Telegram передаёт launch-параметры в hash (#tgWebAppData=...), а HashRouter принял бы это за
 * путь. SDK к этому моменту уже разобрал hash и сохранил параметры в sessionStorage (переживают
 * перезагрузку), поэтому hash можно заменить на корневой маршрут.
 */
export function cleanLaunchHash(): void {
  const hash = window.location.hash;
  if (!hash.includes('tgWebApp')) return;
  // Вариант «#/route?tgWebAppData=...» — сохраняем маршрут, отрезаем параметры.
  const path = hash.startsWith('#/') ? (hash.slice(1).split('?')[0] ?? '/') : '/';
  const url = `${window.location.pathname}${window.location.search}#${path}`;
  window.history.replaceState(window.history.state, '', url);
}
