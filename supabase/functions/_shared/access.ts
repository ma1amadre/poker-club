// Право войти в tg-auth: порядок проверок и тексты отказов. Чистый модуль без Deno и сети — запрос
// в Telegram (проверку группы) передаёт tg-auth, а решение гоняет vitest под Node (access.test.ts).
// Вход по коду (redeem_player_invite) и его отказы — invites.ts.
import { inviteCodeOf } from './domain/invite.ts';

/** Членство в группе клуба; no_group — группа в настройках не задана. */
export type Membership = 'member' | 'not_member' | 'no_group';

/** Что решению нужно знать об уже существующем игроке с этим tg_id. */
export interface KnownPlayer {
  is_active: boolean;
  /** Вошёл по ссылке-приглашению (миграция 029): дальше входит без группы, пока is_active. */
  joined_by_invite: boolean;
}

export type AccessDenial = 'inactive' | 'no_group' | 'not_member';

export type AccessDecision =
  /** Входит без кода: админ, вошедший раньше по приглашению, участник группы. */
  | { kind: 'allow' }
  /** Входит по коду из ссылки: tg-auth сжигает его в redeem_player_invite; null — код не по форме. */
  | { kind: 'redeem'; code: string | null }
  | { kind: 'deny'; code: AccessDenial };

/**
 * Тексты отказов (403): экран входа показывает их как есть — под своим заголовком (в DeniedScreen:
 * «Вход только для участников клуба», «Клуб ещё не подключил группу», «Профиль отключён»), поэтому
 * заголовок здесь не повторяем, а говорим, что делать. На «ты», без рода.
 */
export const ACCESS_DENIALS: Readonly<Record<AccessDenial, string>> = {
  inactive: 'Твой профиль в клубе отключён. Обратись к админу.',
  no_group: 'Пока войти можно только по ссылке-приглашению от админа.',
  not_member: 'Попроси админа добавить тебя в группу клуба или прислать ссылку-приглашение.',
};

const ALLOW: AccessDecision = { kind: 'allow' };

/**
 * Право войти. Порядок:
 * 1) админ клуба (ADMIN_TG_ID) — всегда, чтобы не запереть себя, если бот выпал из группы;
 * 2) вошедший по приглашению — без группы и без запроса в Telegram, пока профиль включён;
 * 3) участник группы клуба — код приглашения, если он в ссылке, не тратится;
 * 4) не участник или группа не задана — ссылка-приглашение i_<код> из start_param, иначе отказ.
 * membership — проверка группы (запрос в Telegram), её зовут только на шаге 3. Сбой Telegram
 * пробрасываем как есть (tg-auth ответит 502 «попробуй ещё раз»): состоит ли человек в группе,
 * неизвестно, а сожжённый код и пометка «по приглашению» у участника группы — навсегда (чужая ссылка
 * пропала бы, а сам он входил бы и после удаления из группы). Код при этом цел — повтор войдёт.
 */
export async function decideAccess(input: {
  isAdminTg: boolean;
  player: KnownPlayer | null;
  startParam: string | null;
  membership: () => Promise<Membership>;
}): Promise<AccessDecision> {
  if (input.isAdminTg) return ALLOW;
  if (input.player?.joined_by_invite) {
    return input.player.is_active ? ALLOW : { kind: 'deny', code: 'inactive' };
  }
  const membership = await input.membership();
  if (membership === 'member') return ALLOW;
  const invite = inviteCodeOf(input.startParam);
  if (invite !== undefined) return { kind: 'redeem', code: invite };
  return { kind: 'deny', code: membership === 'no_group' ? 'no_group' : 'not_member' };
}
