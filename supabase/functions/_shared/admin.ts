// Общее для Edge Functions: service-клиент Supabase, CORS и JSON-ответы.
// supabase-js — через npm-спецификатор (стиль Deno 2): без import map и deno.json.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { readEnv } from './telegram.ts';

export { readEnv };

/** Обязательная переменная окружения; её отсутствие — ошибка конфигурации, а не запроса. */
export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

/**
 * Секретный ключ проекта. Порядок:
 * 1) SUPABASE_SECRET_KEY — имя из контракта (задать его через secrets set нельзя: префикс
 *    SUPABASE_ зарезервирован платформой, но оставляем — вдруг платформа начнёт отдавать его так);
 * 2) SUPABASE_SECRET_KEYS — JSON-словарь новых ключей sb_secret_, который платформа кладёт
 *    в окружение функций сама (https://supabase.com/docs/guides/functions/secrets), ключ 'default';
 * 3) SUPABASE_SERVICE_ROLE_KEY — legacy-ключ, есть и в облаке, и в локальном стеке.
 */
function secretKey(): string {
  const direct = readEnv('SUPABASE_SECRET_KEY');
  if (direct) return direct;
  const dict = readEnv('SUPABASE_SECRET_KEYS');
  if (dict) {
    try {
      const parsed = JSON.parse(dict) as Record<string, unknown>;
      const key = parsed.default ?? Object.values(parsed)[0];
      if (typeof key === 'string' && key) return key;
    } catch {
      // битый JSON — пробуем legacy-ключ
    }
  }
  return requireEnv('SUPABASE_SERVICE_ROLE_KEY');
}

let client: SupabaseClient | null = null;

/**
 * Клиент с правами service_role: обходит RLS, поэтому права вызывающего каждая функция
 * проверяет сама. Сессии нет и быть не должно — клиент общий на все запросы воркера.
 */
export function adminClient(): SupabaseClient {
  if (!client) {
    client = createClient(requireEnv('SUPABASE_URL'), secretKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * CORS для вызовов из Mini App (GitHub Pages, dev-сервер, WebView Telegram). Origin любой:
 * ответы не содержат секретов, а доступ решают подпись initData и JWT, а не origin.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/** Ответ на preflight; для остальных запросов — null. */
export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS'
    ? new Response(null, { status: 204, headers: corsHeaders })
    : null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Ошибка для клиента: error — человекочитаемый текст по-русски (фронт показывает его в деталях),
 * code — машинный код для ветвления.
 */
export function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: message, code }, status);
}

/** JSON-тело запроса или null, если оно не объект. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Bearer-токен из Authorization. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m?.[1] ?? null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сообщение ошибки для логов: у PostgrestError/AuthError нет stack, но есть message и code. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: unknown; code?: unknown };
    return `${String(e.code ?? '')} ${String(e.message ?? JSON.stringify(error))}`.trim();
  }
  return String(error);
}
