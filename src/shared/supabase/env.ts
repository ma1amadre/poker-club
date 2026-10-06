// Переменные окружения фронта. Не бросаем исключение при импорте: без URL/ключа приложение
// должно показать понятный экран ошибки, а не белый экран.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

/** Проблемы конфигурации — показываются на экране ошибки входа. */
export const envProblems: string[] = [
  ...(supabaseUrl ? [] : ['VITE_SUPABASE_URL не задан']),
  ...(supabasePublishableKey ? [] : ['VITE_SUPABASE_PUBLISHABLE_KEY не задан']),
];

export const env = {
  // Заглушка вместо пустого URL: createClient бросает на пустой строке ещё при импорте модуля.
  supabaseUrl: supabaseUrl || 'http://invalid.localhost',
  supabasePublishableKey: supabasePublishableKey || 'missing-key',
  /**
   * Фейковый токен бота для dev-входа вне Telegram. Под import.meta.env.DEV: в прод-сборке
   * выражение сворачивается в пустую строку, и значение не попадает в бандл.
   */
  devBotToken: import.meta.env.DEV ? (import.meta.env.VITE_DEV_BOT_TOKEN?.trim() ?? '') : '',
} as const;
