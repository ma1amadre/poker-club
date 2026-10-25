// Ссылка-приглашение в клуб (миграция 029): прямая ссылка Mini App https://t.me/<бот>?startapp=i_<код>.
// Код создаёт create_player_invite: 24 случайных байта в base64url — 32 знака, 192 бита; в базе лежит
// только его SHA-256, сам код админ видит один раз. Формат один на клиент (ссылка в админке, разбор
// start_param при старте) и tg-auth (вход по приглашению).
// Параметр startapp — A-Z, a-z, 0-9, _ и -, до 64 знаков (правило miniAppLink в _shared/telegram.ts; в
// документации Telegram предел не указан): «i_» + 32 = 34.

/** Префикс параметра запуска у приглашения: остальные параметры (e_, v_, r, s_) — маршруты. */
export const INVITE_PARAM_PREFIX = 'i_';

/** Код приглашения: base64url без «=», ровно 32 знака — как его собирает миграция 029. */
export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{32}$/;

/** Срок приглашения в днях — как interval в create_player_invite (сверяет _shared/invites.test.ts). */
export const INVITE_TTL_DAYS = 7;

/** Параметр запуска для ссылки-приглашения: 'i_<код>'. Код не по форме — ошибка. */
export function inviteStartParam(code: string): string {
  if (!INVITE_CODE_RE.test(code)) throw new Error('Код приглашения не по форме');
  return `${INVITE_PARAM_PREFIX}${code}`;
}

/** Параметр запуска — приглашение (любой формы): маршрута у него нет. */
export function isInviteParam(param: string | null | undefined): boolean {
  return typeof param === 'string' && param.startsWith(INVITE_PARAM_PREFIX);
}

/**
 * Код из параметра запуска: не приглашение — undefined; приглашение не по форме (обрезанная или
 * исправленная руками ссылка) — null; иначе код.
 */
export function inviteCodeOf(param: string | null | undefined): string | null | undefined {
  if (!isInviteParam(param)) return undefined;
  const code = (param as string).slice(INVITE_PARAM_PREFIX.length);
  return INVITE_CODE_RE.test(code) ? code : null;
}
