// Вход по ссылке-приглашению в tg-auth (миграция 029): ответ RPC redeem_player_invite и тексты отказов.
// Чистый модуль без Deno и сети — его гоняет vitest под Node (invites.test.ts).
// Формат ссылки и кода — domain/invite.ts (общий с клиентом).

/** Ответ redeem_player_invite: см. комментарий функции в 029_player_invites.sql. */
export type RedeemOutcome = 'ok' | 'inactive' | 'unknown' | 'used' | 'expired' | 'revoked';

export interface RedeemResult {
  outcome: RedeemOutcome;
  /** Игрок, который вошёл (только при ok). */
  playerId: string | null;
}

const OUTCOMES: ReadonlySet<string> = new Set([
  'ok',
  'inactive',
  'unknown',
  'used',
  'expired',
  'revoked',
]);

/** Разбор ответа RPC; неожиданная форма — ошибка (tg-auth ответит 500, а не пустит наугад). */
export function parseRedeemResult(data: unknown): RedeemResult {
  const row = (typeof data === 'object' && data !== null ? data : {}) as {
    outcome?: unknown;
    playerId?: unknown;
  };
  const outcome = typeof row.outcome === 'string' && OUTCOMES.has(row.outcome) ? row.outcome : null;
  if (!outcome) throw new Error('redeem_player_invite: неожиданный ответ');
  const playerId = typeof row.playerId === 'string' ? row.playerId : null;
  if (outcome === 'ok' && !playerId) throw new Error('redeem_player_invite: ok без игрока');
  return { outcome: outcome as RedeemOutcome, playerId };
}

export type InviteDenial = Exclude<RedeemOutcome, 'ok' | 'inactive'>;

/**
 * Отказ по приглашению: код ответа (403, клиент показывает текст как есть) и текст на «ты» без рода.
 * Кто вошёл по ссылке и когда она создана — не сообщаем.
 */
export const INVITE_DENIALS: Readonly<Record<InviteDenial, { code: string; message: string }>> = {
  unknown: {
    code: 'invite_unknown',
    message:
      'Ссылка-приглашение не подходит — возможно, она скопирована не целиком. Попроси у админа новую ссылку.',
  },
  used: {
    code: 'invite_used',
    message:
      'По этой ссылке-приглашению уже вошли: она работает один раз. Попроси у админа новую ссылку.',
  },
  expired: {
    code: 'invite_expired',
    message: 'Срок ссылки-приглашения вышел. Попроси у админа новую ссылку.',
  },
  revoked: {
    code: 'invite_revoked',
    message: 'Ссылку-приглашение отозвали. Попроси у админа новую ссылку.',
  },
};
