// Telegram: проверка initData Mini App и Bot API (посты в группу клуба, проверка членства).
//
// Модуль не трогает Deno на уровне импорта: его же гоняет vitest в Node (telegram.test.ts),
// поэтому окружение читается через readEnv(), а криптография — только WebCrypto (есть и там, и там).

// ---------------------------------------------------------------------------
// Окружение
// ---------------------------------------------------------------------------

interface EnvSource {
  Deno?: { env: { get(name: string): string | undefined } };
  process?: { env: Record<string, string | undefined> };
}

/** Переменная окружения: в Edge Function — Deno.env, в тестах под Node — process.env. */
export function readEnv(name: string): string | undefined {
  const g = globalThis as EnvSource;
  const value = g.Deno ? g.Deno.env.get(name) : g.process?.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** TELEGRAM_DRY_RUN=1 — локальный режим: ничего не отправляем в Telegram, только пишем в лог. */
export function isDryRun(): boolean {
  return readEnv('TELEGRAM_DRY_RUN') === '1';
}

// ---------------------------------------------------------------------------
// initData
// ---------------------------------------------------------------------------
// Алгоритм сверен с https://core.telegram.org/bots/webapps
// («Validating data received via the Mini App», проверено 06.10.2026):
//   data_check_string = все полученные поля, кроме hash, по алфавиту, «key=value» через \n;
//   secret_key        = HMAC_SHA256(key = "WebAppData", msg = bot_token);
//   hash              = hex(HMAC_SHA256(key = secret_key, msg = data_check_string)).
// Поле signature (Ed25519 для проверки третьими сторонами) в этой схеме — обычное поле и входит
// в data_check_string: исключать его нужно только в схеме для третьих сторон, где документация
// явно пишет «except hash and signature».
// Свежесть: документация советует дополнительно проверять auth_date — без этого перехваченный
// initData работал бы вечно.

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export interface InitData {
  authDate: number; // секунды Unix
  user: TelegramUser;
  startParam: string | null;
  queryId: string | null;
  /** Все поля как пришли (уже раскодированные), включая hash. */
  fields: Record<string, string>;
}

export type InitDataError =
  | 'malformed' // не разбирается, пустой или повторяющиеся ключи
  | 'missing_hash'
  | 'bad_hash' // подпись не сошлась: подделка или чужой бот
  | 'bad_auth_date'
  | 'expired'
  | 'bad_user';

export type InitDataResult = { ok: true; data: InitData } | { ok: false; error: InitDataError };

/** Допуск на расхождение часов: auth_date «из будущего» больше этого — не принимаем. */
const MAX_CLOCK_SKEW_SEC = 300;
/** Защита от мусора: настоящий initData — пара килобайт. */
const MAX_INIT_DATA_LENGTH = 16_384;

const encoder = new TextEncoder();

async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

/**
 * Сравнение за постоянное время: проходим все байты и копим различия, не выходя на первом
 * несовпадении, — иначе по времени ответа можно подбирать подпись байт за байтом.
 * Разная длина — сразу false: длина хеша не секрет (всегда 32 байта).
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Строка проверки по алгоритму Telegram: поля без hash, по алфавиту ключей, через \n. */
export function dataCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
}

/** Подпись initData ключом бота — та же формула, что у Telegram; нужна для проверки и тестов. */
export async function signInitDataFields(
  fields: Record<string, string>,
  botToken: string,
): Promise<Uint8Array> {
  const secret = await hmacSha256(encoder.encode('WebAppData'), botToken);
  return hmacSha256(secret, dataCheckString(fields));
}

function parseUser(raw: string | undefined): TelegramUser | null {
  if (raw === undefined) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const u = value as Record<string, unknown>;
  // id до 52 бит — в double помещается точно (так и пишет документация WebAppUser).
  if (typeof u.id !== 'number' || !Number.isSafeInteger(u.id) || u.id <= 0) return null;
  if (typeof u.first_name !== 'string') return null;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v !== '' ? v : undefined;
  const user: TelegramUser = { id: u.id, first_name: u.first_name };
  const lastName = str(u.last_name);
  const username = str(u.username);
  const languageCode = str(u.language_code);
  const photoUrl = str(u.photo_url);
  if (lastName) user.last_name = lastName;
  if (username) user.username = username;
  if (languageCode) user.language_code = languageCode;
  // Фото принимаем только https: ссылку потом рисует фронт в <img>.
  if (photoUrl && photoUrl.startsWith('https://')) user.photo_url = photoUrl;
  if (typeof u.is_premium === 'boolean') user.is_premium = u.is_premium;
  if (typeof u.allows_write_to_pm === 'boolean') user.allows_write_to_pm = u.allows_write_to_pm;
  return user;
}

/**
 * Проверяет initData из Telegram.WebApp.initData: подпись ключом бота, свежесть auth_date
 * (не старше maxAgeSec) и наличие пользователя. nowSec — для тестов; по умолчанию текущее время.
 * Порядок проверок: сначала подпись, потом содержимое — неподписанным данным не доверяем вовсе.
 */
export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<InitDataResult> {
  if (typeof initData !== 'string' || initData === '' || initData.length > MAX_INIT_DATA_LENGTH) {
    return { ok: false, error: 'malformed' };
  }
  if (!botToken) throw new Error('Не задан токен бота для проверки initData');

  // Объект без прототипа: ключ «__proto__» из запроса станет обычным полем (и попадёт в строку
  // проверки), а не молча пропадёт при присваивании.
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  try {
    for (const [key, value] of new URLSearchParams(initData)) {
      // Повтор ключа — признак подделки: какой из двух подписан, неизвестно.
      if (Object.hasOwn(fields, key)) return { ok: false, error: 'malformed' };
      fields[key] = value;
    }
  } catch {
    return { ok: false, error: 'malformed' };
  }

  const hash = fields.hash;
  if (hash === undefined) return { ok: false, error: 'missing_hash' };
  const provided = hexToBytes(hash);
  if (!provided) return { ok: false, error: 'bad_hash' };
  const expected = await signInitDataFields(fields, botToken);
  if (!timingSafeEqual(provided, expected)) return { ok: false, error: 'bad_hash' };

  const authDateRaw = fields.auth_date;
  const authDate =
    authDateRaw !== undefined && /^\d{1,12}$/.test(authDateRaw) ? Number(authDateRaw) : NaN;
  if (!Number.isSafeInteger(authDate)) return { ok: false, error: 'bad_auth_date' };
  if (authDate > nowSec + MAX_CLOCK_SKEW_SEC) return { ok: false, error: 'bad_auth_date' };
  if (nowSec - authDate > maxAgeSec) return { ok: false, error: 'expired' };

  const user = parseUser(fields.user);
  if (!user) return { ok: false, error: 'bad_user' };

  return {
    ok: true,
    data: {
      authDate,
      user,
      startParam: fields.start_param ?? null,
      queryId: fields.query_id ?? null,
      fields,
    },
  };
}

/** Имя для клуба из профиля Telegram: «Имя Фамилия», без лишних пробелов. */
export function telegramDisplayName(user: TelegramUser, maxLength = 40): string {
  const full = [user.first_name, user.last_name ?? ''].join(' ').replace(/\s+/g, ' ').trim();
  const name = full || (user.username ? `@${user.username}` : `Игрок ${user.id}`);
  // Array.from — режем по символам, а не по UTF-16: эмодзи в имени не разваливаются пополам.
  return Array.from(name).slice(0, maxLength).join('').trim();
}

// ---------------------------------------------------------------------------
// Ссылки и HTML
// ---------------------------------------------------------------------------

/**
 * Прямая ссылка на главный Mini App бота: https://t.me/<bot_username>?startapp=<param>.
 * Формат — https://core.telegram.org/bots/webapps («Main Mini App»); работает, только если
 * у бота настроен Main Mini App в BotFather, иначе клиент откроет просто чат с ботом
 * (https://core.telegram.org/api/links). web_app-кнопки в группах недоступны — поэтому URL-кнопка.
 * Параметр: A-Z, a-z, 0-9, _ и -, до 64 символов (core.telegram.org/bots/features, Deep linking);
 * e_<uuid> — 38 символов.
 */
export function miniAppLink(botUsername: string, startParam?: string): string {
  const bot = botUsername.replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{3,64}$/.test(bot)) throw new Error(`Некорректное имя бота: ${botUsername}`);
  if (startParam === undefined || startParam === '') return `https://t.me/${bot}?startapp`;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(startParam)) {
    throw new Error(`Некорректный параметр startapp: ${startParam}`);
  }
  return `https://t.me/${bot}?startapp=${startParam}`;
}

/**
 * Экранирование для parse_mode HTML. Любой текст от пользователей (имена игроков, место,
 * подписи) проходит через эту функцию: имя «<b>Вася</b>» иначе сломало бы разметку поста,
 * а Telegram отверг бы сообщение целиком.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Bot API
// ---------------------------------------------------------------------------

export class TelegramApiError extends Error {
  readonly method: string;
  readonly status: number;
  readonly retryAfterSec: number | null;

  constructor(method: string, status: number, description: string, retryAfterSec: number | null) {
    super(`Telegram ${method}: ${status} ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

function botToken(): string {
  const token = readEnv('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Не задан TELEGRAM_BOT_TOKEN');
  return token;
}

/**
 * Текст сетевой ошибки fetch без токена. В Deno сообщение о DNS/TCP/TLS-сбое содержит URL запроса
 * («error sending request for url (https://api.telegram.org/bot<токен>/getMe)»), а этот текст дальше
 * уходит в логи функций и в ответ cron-tick (его pg_net хранит в net._http_response). Вырезаем и
 * сам токен (как есть и percent-encoded), и любой сегмент /bot…/ на случай другой записи.
 */
export function redactBotToken(text: string, token: string): string {
  let out = text;
  if (token) {
    out = out.replaceAll(token, '<token>').replaceAll(encodeURIComponent(token), '<token>');
  }
  return out.replace(/\/bot[^/\s)]+\//g, '/bot<token>/');
}

async function callBotApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  // Токен — часть URL Bot API, поэтому URL целиком никогда не логируем.
  const token = botToken();
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Новая ошибка без cause: исходная (с URL и токеном) дальше не идёт.
    const e = err as { name?: unknown; message?: unknown } | null;
    const text = `${String(e?.name ?? 'Error')}: ${String(e?.message ?? err)}`;
    throw new Error(`Telegram ${method}: сеть: ${redactBotToken(text, token)}`);
  }
  let data: BotApiResponse<T> | null = null;
  try {
    data = (await res.json()) as BotApiResponse<T>;
  } catch {
    data = null;
  }
  if (!res.ok || !data?.ok || data.result === undefined) {
    throw new TelegramApiError(
      method,
      data?.error_code ?? res.status,
      data?.description ?? res.statusText,
      data?.parameters?.retry_after ?? null,
    );
  }
  return data.result;
}

export interface UrlButton {
  text: string;
  url: string;
}

export interface SendMessageOptions {
  /** URL-кнопки под постом, каждая в своей строке. */
  buttons?: UrlButton[];
}

export interface SentMessage {
  messageId: number;
  dryRun: boolean;
}

/**
 * Пост в чат с parse_mode HTML. text — уже готовая разметка: пользовательские значения в ней
 * должны быть экранированы escapeHtml (это делает messages.ts). Ошибка Telegram — исключение:
 * вызывающий не отмечает пост отправленным и повторит позже.
 */
export async function sendMessage(
  chatId: number | string,
  text: string,
  options: SendMessageOptions = {},
): Promise<SentMessage> {
  const buttons = options.buttons ?? [];
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
  if (buttons.length > 0) {
    body.reply_markup = { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) };
  }
  if (isDryRun()) {
    console.log(
      `[telegram dry-run] sendMessage → ${chatId}\n${text}` +
        (buttons.length
          ? `\n[кнопки] ${buttons.map((b) => `${b.text} → ${b.url}`).join(' | ')}`
          : ''),
    );
    return { messageId: 0, dryRun: true };
  }
  const result = await callBotApi<{ message_id: number }>('sendMessage', body);
  return { messageId: result.message_id, dryRun: false };
}

export type ChatMemberStatus =
  'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';

export interface ChatMember {
  status: ChatMemberStatus;
  is_member?: boolean; // только у restricted
}

/**
 * Статус пользователя в чате. Бот должен быть участником группы (для супергрупп — админом
 * не обязательно). В dry-run Telegram не спрашиваем и считаем пользователя участником:
 * локально подпись делается фейковым токеном, настоящей группы нет. В проде dry-run не включать.
 */
export async function getChatMember(chatId: number | string, userId: number): Promise<ChatMember> {
  if (isDryRun()) {
    console.log(`[telegram dry-run] getChatMember ${chatId} / ${userId} → member`);
    return { status: 'member' };
  }
  return callBotApi<ChatMember>('getChatMember', { chat_id: chatId, user_id: userId });
}

/** Участник группы: member/administrator/creator или restricted, который всё ещё в чате. */
export function isChatMember(member: ChatMember): boolean {
  if (
    member.status === 'creator' ||
    member.status === 'administrator' ||
    member.status === 'member'
  ) {
    return true;
  }
  return member.status === 'restricted' && member.is_member === true;
}

// ---------------------------------------------------------------------------
// Настройка бота из админки (bot-setup)
// ---------------------------------------------------------------------------

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
}

/** Бот в dry-run: локально настоящего бота нет, имя — как в seed.sql. */
export const DRY_RUN_BOT: BotInfo = {
  id: 100500,
  username: 'poker_club_local_bot',
  first_name: 'Покерный клуб (локально)',
  can_join_groups: true,
  can_read_all_group_messages: false,
};

/** getMe — кто этот бот (имя для ссылок startapp). */
export async function getMe(): Promise<BotInfo> {
  if (isDryRun()) {
    console.log('[telegram dry-run] getMe → DRY_RUN_BOT');
    return DRY_RUN_BOT;
  }
  return callBotApi<BotInfo>('getMe', {});
}

export type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TgChat {
  id: number;
  type: ChatType;
  title?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  /** Группу превратили в супергруппу: её новый id (старый больше не работает). */
  migrate_to_chat_id?: number;
  /** Первое сообщение супергруппы после превращения: id прежней группы. */
  migrate_from_chat_id?: number;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  date: number;
  old_chat_member: ChatMember & { user?: { id: number } };
  new_chat_member: ChatMember & { user?: { id: number } };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
}

/**
 * getUpdates без offset: Telegram отдаёт неподтверждённые обновления, но не подтверждает их —
 * подтверждает только следующий вызов с offset больше update_id. Поэтому повторный поиск группы
 * видит те же обновления, пока Telegram их хранит (не дольше 24 часов, core.telegram.org/bots/api,
 * «Getting updates»). allowed_updates Telegram запоминает для следующих вызовов; других
 * потребителей обновлений у бота нет (webhook не ставим), так что это безопасно.
 * При включённом webhook метод не работает — Telegram отвечает 409.
 */
export async function getUpdates(allowedUpdates: string[]): Promise<TgUpdate[]> {
  return callBotApi<TgUpdate[]>('getUpdates', {
    limit: 100,
    timeout: 0,
    allowed_updates: allowedUpdates,
  });
}
