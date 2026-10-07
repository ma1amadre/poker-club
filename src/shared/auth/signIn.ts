// Вход по контракту: initData → Edge Function tg-auth (проверка подписи и членства в группе)
// → {tokenHash, player} → auth.verifyOtp({type:'email', token_hash}) → сессия в памяти.
// Весь вход — не дольше SIGN_IN_TIMEOUT_MS: зависшее соединение иначе держало бы заставку вечно.
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { SIGN_IN_TIMEOUT_MS, withTimeout } from '../lib/timeout';
import { envProblems, supabase } from '../supabase';
import type { Player } from '../api/types';

export type AuthErrorKind =
  /** Открыто не из Telegram — initData нет. */
  | 'no_telegram'
  /** tg-auth: 401, подпись не сошлась или initData устарел. */
  | 'signature'
  /** tg-auth: 403, не участник группы клуба. */
  | 'not_member'
  /** tg-auth: 403 no_group — клуб ещё не подключил группу, войти может только админ. */
  | 'no_group'
  /** Вход прошёл, но RLS не видит игрока: он отключён админом (is_active = false). */
  | 'inactive'
  /** Не заданы VITE_SUPABASE_URL / ключ. */
  | 'config'
  | 'network'
  /** Сервер не ответил за SIGN_IN_TIMEOUT_MS. */
  | 'timeout'
  | 'server';

/** Отказ в доступе (экран «нет доступа») в отличие от сбоя (экран ошибки с повтором). */
export const DENIED_KINDS: ReadonlySet<AuthErrorKind> = new Set([
  'no_telegram',
  'signature',
  'not_member',
  'no_group',
  'inactive',
]);

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly details?: string;

  constructor(kind: AuthErrorKind, message: string, details?: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
    this.details = details;
  }
}

interface TgAuthResponse {
  tokenHash?: unknown;
  player?: unknown;
}

/**
 * Текст и код ошибки из тела ответа функции. tg-auth отвечает `{error: текст, code}`
 * (supabase/functions/_shared/admin.ts → errorResponse); на всякий случай понимаем и `message`.
 */
async function readFunctionError(response: unknown): Promise<{ message?: string; code?: string }> {
  if (!(response instanceof Response)) return {};
  try {
    const text = await response.clone().text();
    try {
      const json = JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown };
      const value = json.error ?? json.message;
      const code = typeof json.code === 'string' ? json.code : undefined;
      if (typeof value === 'string') return { message: value, code };
    } catch {
      // не JSON — вернём как есть
    }
    return { message: text.slice(0, 300) || undefined };
  } catch {
    return {};
  }
}

async function callTgAuth(initData: string, signal: AbortSignal): Promise<string> {
  const { data, error } = await supabase.functions.invoke<TgAuthResponse>('tg-auth', {
    body: { initData },
    signal,
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response | undefined;
      const status = response?.status;
      const { message: details, code } = await readFunctionError(response);
      if (status === 401) {
        throw new AuthError(
          'signature',
          'Telegram не подтвердил вход. Закрой приложение и открой его снова.',
          details,
        );
      }
      // 403 inactive — профиль отключён админом; no_group / not_member — нет доступа к группе.
      if (status === 403 && code === 'inactive') {
        throw new AuthError(
          'inactive',
          'Твой профиль в клубе отключён. Обратись к админу клуба.',
          details,
        );
      }
      if (status === 403 && code === 'no_group') {
        throw new AuthError(
          'no_group',
          'Клуб ещё не подключил группу — вход пока только у админа.',
          details,
        );
      }
      if (status === 403) {
        throw new AuthError(
          'not_member',
          'Приложение только для участников группы клуба. Попроси админа добавить тебя в группу.',
          details,
        );
      }
      throw new AuthError(
        'server',
        `Сервер входа ответил ошибкой${status ? ` ${status}` : ''}.`,
        details,
      );
    }
    if (error instanceof FunctionsFetchError) {
      throw new AuthError('network', 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.');
    }
    if (error instanceof FunctionsRelayError) {
      throw new AuthError('server', 'Сервер входа недоступен. Попробуй чуть позже.');
    }
    throw new AuthError('server', 'Не удалось войти.', String(error));
  }
  const tokenHash = data?.tokenHash;
  if (typeof tokenHash !== 'string' || !tokenHash) {
    throw new AuthError('server', 'Сервер входа вернул неожиданный ответ.');
  }
  return tokenHash;
}

/** Строка игрока текущей сессии — тем же путём, что видит RLS (auth_user_id = auth.uid()). */
export async function loadCurrentPlayer(
  userId: string,
  signal?: AbortSignal,
): Promise<Player | null> {
  const query = supabase.from('players').select('*').eq('auth_user_id', userId);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  if (error) throw new AuthError('server', 'Не удалось загрузить профиль игрока.', error.message);
  return data;
}

async function signIn(initData: string, signal: AbortSignal): Promise<Player> {
  if (envProblems.length > 0) {
    throw new AuthError(
      'config',
      'Приложение собрано без настроек сервера.',
      envProblems.join('; '),
    );
  }
  const tokenHash = await callTgAuth(initData, signal);
  // Тайм-аут или повтор вручную, пока шёл tg-auth: сессию этой попытки не открываем.
  if (signal.aborted) throw new AuthError('server', 'Вход начат заново.');
  const { data, error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (error || !data.session || !data.user) {
    throw new AuthError('server', 'Не удалось открыть сессию.', error?.message);
  }
  // Игрока берём из БД, а не из ответа функции: так заодно проверяется, что RLS видит нас
  // активным участником клуба (current_player_id() не null), — иначе все экраны были бы пустыми.
  const player = await loadCurrentPlayer(data.user.id, signal);
  if (!player || !player.is_active) {
    throw new AuthError('inactive', 'Твой профиль в клубе отключён. Обратись к админу клуба.');
  }
  return player;
}

export const SIGN_IN_TIMEOUT_TEXT =
  'Сервер не ответил за 12 секунд. Проверь интернет и повтори вход.';

// Один вход на один initData: StrictMode в dev дважды запускает эффекты, а повторный
// generateLink инвалидировал бы первый tokenHash. Провал из кеша убираем — чтобы работал повтор.
const inflight = new Map<string, { promise: Promise<Player>; cancel: AbortController }>();

export function signInOnce(initData: string): Promise<Player> {
  const existing = inflight.get(initData);
  if (existing) return existing.promise;
  const cancel = new AbortController();
  const promise: Promise<Player> = withTimeout(
    (signal) => signIn(initData, signal),
    SIGN_IN_TIMEOUT_MS,
    () => new AuthError('timeout', SIGN_IN_TIMEOUT_TEXT),
    cancel.signal,
  ).catch((error: unknown) => {
    // Убираем только свою запись: повтор мог уже положить на её место новую попытку.
    if (inflight.get(initData)?.promise === promise) inflight.delete(initData);
    throw error;
  });
  inflight.set(initData, { promise, cancel });
  return promise;
}

/**
 * Сбросить кеш входа (повтор после ошибки или вручную с заставки, смена тестового игрока,
 * истёкшая сессия). Незавершённая попытка отменяется: её запросы обрываются, сессию она не откроет.
 */
export function forgetSignIn(): void {
  for (const { cancel } of inflight.values()) {
    cancel.abort(new AuthError('server', 'Вход начат заново.'));
  }
  inflight.clear();
}

export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new AuthError('network', 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.');
  }
  return new AuthError('server', 'Не удалось войти.', message);
}
