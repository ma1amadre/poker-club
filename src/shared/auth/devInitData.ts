// ТОЛЬКО ДЛЯ РАЗРАБОТКИ. Подписывает initData так же, как клиент Telegram, чтобы локальная
// функция tg-auth приняла вход вне Telegram. Ключ — фейковый VITE_DEV_BOT_TOKEN, совпадающий
// с TELEGRAM_BOT_TOKEN в supabase/functions/.env локального стека. Модуль импортируется только
// из DevLoginPage, которую грузит ветка под import.meta.env.DEV, — в прод-бандл он не попадает.
//
// Алгоритм (core.telegram.org/bots/webapps, «Validating data received via the Mini App»):
//   data_check_string = поля без hash, отсортированные по ключу, «key=value» через \n
//   secret = HMAC_SHA256(key = "WebAppData", msg = bot_token)
//   hash   = hex(HMAC_SHA256(key = secret, msg = data_check_string))
// Тот же алгоритм для node — scripts/dev-initdata.mjs.

export interface DevTelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

/**
 * Тестовые игроки — те же, что в supabase/seed.sql (tg_id 1001–1006, 1001 — админ).
 * Имена совпадают с сидом: tg-auth обновляет имя игрока из initData, и иначе вход затёр бы сид.
 */
export const DEV_PLAYERS: readonly (DevTelegramUser & { note?: string })[] = [
  { id: 1001, first_name: 'Женя', username: 'zhenya_local', note: 'админ' },
  { id: 1002, first_name: 'Саша', username: 'sasha_local' },
  { id: 1003, first_name: 'Дима', username: 'dima_local' },
  { id: 1004, first_name: 'Лёша', username: 'lesha_local' },
  { id: 1005, first_name: 'Миша' },
  { id: 1006, first_name: 'Костя', username: 'kostya_local' },
];

const encoder = new TextEncoder();

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Строка проверки: все поля, кроме hash, по алфавиту ключей, «key=value» через перевод строки. */
export function dataCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
}

export interface DevInitDataOptions {
  user: DevTelegramUser;
  botToken: string;
  /** Время подписи, секунды Unix. По умолчанию — сейчас (tg-auth отвергает старше 24 ч). */
  authDate?: number;
  startParam?: string;
}

/** initData в том виде, в каком её отдаёт Telegram.WebApp.initData (URL-encoded query). */
export async function buildDevInitData(options: DevInitDataOptions): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error('WebCrypto недоступен: откройте dev-сервер по http://127.0.0.1 или https');
  }
  const { user, botToken, authDate = Math.floor(Date.now() / 1000), startParam } = options;
  // Поля перечислены явно: в user не должно попасть ничего лишнего (например, note из DEV_PLAYERS).
  const tgUser = {
    id: user.id,
    first_name: user.first_name,
    ...(user.last_name ? { last_name: user.last_name } : {}),
    ...(user.username ? { username: user.username } : {}),
    language_code: user.language_code ?? 'ru',
    ...(user.photo_url ? { photo_url: user.photo_url } : {}),
    allows_write_to_pm: true,
  };
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: `dev-${user.id}-${authDate}`,
    user: JSON.stringify(tgUser),
  };
  if (startParam) fields.start_param = startParam;

  const secret = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const hash = toHex(await hmacSha256(secret, dataCheckString(fields)));

  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
