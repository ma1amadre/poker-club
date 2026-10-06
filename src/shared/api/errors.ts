// Ошибки для показа человеку. RPC бросают исключения с русским текстом (raise exception в 003_rpc.sql) —
// их показываем как есть; сетевые и служебные ошибки переводим.

interface MaybeError {
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

/** Текст ошибки для тоста или экрана ошибки. */
export function errorMessage(
  error: unknown,
  fallback = 'Что-то пошло не так. Попробуйте ещё раз.',
): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  const e = error as MaybeError;
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  if (message && NETWORK_RE.test(message)) return 'Нет связи с сервером. Проверьте интернет.';
  // 42501 — нет прав (RLS или проверка в RPC), PGRST301 — истёкший JWT.
  if (e.code === '42501' && !/[а-яё]/i.test(message))
    return 'Недостаточно прав для этого действия.';
  if (e.code === 'PGRST301') return 'Сессия истекла. Перезапустите приложение.';
  if (message) return message;
  return fallback;
}

/** Ошибка supabase-js (PostgrestError и т. п.) — в Error с понятным текстом для TanStack Query. */
export function toError(error: unknown): Error {
  if (error instanceof Error && !('code' in error)) return error;
  const wrapped = new Error(errorMessage(error));
  (wrapped as Error & { cause?: unknown }).cause = error;
  return wrapped;
}
