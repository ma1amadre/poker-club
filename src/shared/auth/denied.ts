// Отказ во входе → экран «нет доступа». Чистый модуль без клиента Supabase — его гоняет
// denied.test.ts. Текст под заголовком — сообщение tg-auth (что делать), экран показывает его как
// есть; запасной текст здесь — на случай ответа без тела. Текст не повторяет заголовок: экран ставит
// их подряд (тексты функции — supabase/functions/_shared/access.ts и invites.ts).
import type { AuthErrorKind } from './signIn';

export type DeniedKind = Extract<
  AuthErrorKind,
  'no_telegram' | 'signature' | 'not_member' | 'no_group' | 'invite' | 'inactive'
>;

/** Заголовки экрана «нет доступа» (DeniedScreen). */
export const DENIED_TITLES: Readonly<Record<DeniedKind, string>> = {
  no_telegram: 'Открой приложение в Telegram',
  signature: 'Telegram не подтвердил вход',
  not_member: 'Вход только для участников клуба',
  no_group: 'Клуб ещё не подключил группу',
  invite: 'Ссылка-приглашение не сработала',
  inactive: 'Профиль отключён',
};

/** 401 tg-auth: подпись не сошлась или initData устарел. */
export const SIGNATURE_TEXT = 'Закрой приложение и открой его снова.';

/**
 * Вид отказа (403) по коду ответа tg-auth и запасной текст. inactive — профиль отключён админом;
 * invite_used / invite_expired / invite_revoked / invite_unknown — ссылка-приглашение не сработала
 * (миграция 029); no_group — группа не подключена; остальное — не участник группы.
 */
export function deniedOf(code: string | undefined): [AuthErrorKind, string] {
  if (code === 'inactive') {
    return ['inactive', 'Твой профиль в клубе отключён. Обратись к админу клуба.'];
  }
  if (code === 'no_group') {
    return ['no_group', 'Пока войти можно только по ссылке-приглашению от админа.'];
  }
  if (code?.startsWith('invite_')) {
    return ['invite', 'Попроси у админа новую ссылку.'];
  }
  return [
    'not_member',
    'Попроси админа добавить тебя в группу клуба или прислать ссылку-приглашение.',
  ];
}
