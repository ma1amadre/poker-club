// tg-auth — вход в Mini App без паролей.
// POST {initData} → подпись Telegram → право доступа (админ / вошедший по приглашению / участник группы
// клуба / ссылка-приглашение i_<код>) → игрок по tg_id → auth-пользователь tg<id>@users.poker-club.invalid
// → одноразовый tokenHash.
// Клиент обменивает tokenHash на сессию через auth.verifyOtp({type: 'email', token_hash}).
// verify_jwt = false (config.toml): до входа у клиента нет JWT; доступ решает подпись initData.
import {
  adminClient,
  describeError,
  errorResponse,
  json,
  preflight,
  readJsonBody,
  readEnv,
  requireEnv,
} from '../_shared/admin.ts';
import { ACCESS_DENIALS, decideAccess, type Membership } from '../_shared/access.ts';
import { INVITE_DENIALS, parseRedeemResult } from '../_shared/invites.ts';
import {
  getChatMember,
  isChatMember,
  isDryRun,
  isDryRunOutsider,
  telegramDisplayName,
  TelegramApiError,
  TelegramNetworkError,
  validateInitData,
  type InitDataError,
  type TelegramUser,
} from '../_shared/telegram.ts';

/** initData живёт сутки: Mini App держат открытым весь вечер, а сессия в памяти обновляется входом. */
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

const INIT_DATA_ERRORS: Record<InitDataError, string> = {
  malformed: 'Данные входа повреждены',
  missing_hash: 'Нет подписи Telegram',
  bad_hash: 'Подпись Telegram не сошлась',
  bad_auth_date: 'Некорректное время входа',
  expired: 'Данные входа устарели, открой приложение заново',
  bad_user: 'В данных входа нет пользователя Telegram',
};

interface PlayerRow {
  id: string;
  auth_user_id: string | null;
  tg_id: number | null;
  display_name: string;
  username: string | null;
  photo_url: string | null;
  is_guest: boolean;
  is_admin: boolean;
  is_active: boolean;
  /** Вошёл по ссылке-приглашению (миграция 029): дальше входит без группы, пока is_active. */
  joined_by_invite: boolean;
  created_at: string;
}

const PLAYER_COLUMNS =
  'id, auth_user_id, tg_id, display_name, username, photo_url, is_guest, is_admin, is_active, joined_by_invite, created_at';

const INACTIVE_TEXT = ACCESS_DENIALS.inactive;

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const db = () => adminClient();

/** Адрес auth-пользователя. Домен .invalid зарезервирован (RFC 2606) — письма туда не уйдут. */
const authEmail = (tgId: number): string => `tg${tgId}@users.poker-club.invalid`;

async function findPlayer(tgId: number): Promise<PlayerRow | null> {
  const { data, error } = await db()
    .from('players')
    .select(PLAYER_COLUMNS)
    .eq('tg_id', tgId)
    .maybeSingle<PlayerRow>();
  if (error) throw new Error(`players: ${describeError(error)}`);
  return data;
}

/**
 * Членство в группе клуба. Группа не задана — no_group, кроме локального dry-run: там в seed группы
 * нет, а dev-вход фронта должен пускать всех тестовых игроков (кроме TELEGRAM_DRY_RUN_OUTSIDERS).
 * Сбой Telegram (не 400) — исключение: состоит человек в группе или нет, неизвестно.
 */
async function groupMembership(user: TelegramUser): Promise<Membership> {
  const { data, error } = await db().from('settings').select('group_chat_id').eq('id', 1).single();
  if (error) throw new Error(`settings: ${describeError(error)}`);
  const groupChatId = (data as { group_chat_id: number | string | null }).group_chat_id;
  if (groupChatId === null || groupChatId === '') {
    return isDryRun() && !isDryRunOutsider(user.id) ? 'member' : 'no_group';
  }
  try {
    return isChatMember(await getChatMember(groupChatId, user.id)) ? 'member' : 'not_member';
  } catch (error) {
    // 400 «user not found» / «member list is inaccessible» — пользователя в группе нет.
    if (error instanceof TelegramApiError && error.status === 400) return 'not_member';
    throw error;
  }
}

/**
 * Вход по ссылке-приглашению (миграция 029): RPC в одной транзакции сжигает код и создаёт игрока или
 * ставит пометку существующему. code — null, если параметр i_… не по форме. Код в лог не пишем.
 */
async function redeemInvite(user: TelegramUser, code: string | null): Promise<void> {
  if (code === null) {
    const { code: errCode, message } = INVITE_DENIALS.unknown;
    throw new HttpError(403, errCode, message);
  }
  const { data, error } = await db().rpc('redeem_player_invite', {
    p_code: code,
    p_tg_id: user.id,
    p_display_name: telegramDisplayName(user),
    p_username: user.username ?? null,
    p_photo_url: user.photo_url ?? null,
  });
  if (error) throw new Error(`redeem_player_invite: ${describeError(error)}`);
  const result = parseRedeemResult(data);
  if (result.outcome === 'ok') {
    console.log(`tg-auth: вход по приглашению, tg ${user.id}, игрок ${result.playerId}`);
    return;
  }
  if (result.outcome === 'inactive') throw new HttpError(403, 'inactive', INACTIVE_TEXT);
  const { code: errCode, message } = INVITE_DENIALS[result.outcome];
  throw new HttpError(403, errCode, message);
}

/**
 * Право войти — порядок проверок в _shared/access.ts (decideAccess): админ, вошедший по приглашению,
 * участник группы (код из ссылки не тратится), иначе код i_<код> из start_param или отказ. Сбой
 * Telegram на проверке группы — исключение (502 «попробуй ещё раз»), код при этом цел.
 * Возвращает true, если вход прошёл по коду (игрок только что создан или помечен).
 */
async function checkAccess(
  user: TelegramUser,
  isAdminTg: boolean,
  existing: PlayerRow | null,
  startParam: string | null,
): Promise<boolean> {
  const access = await decideAccess({
    isAdminTg,
    player: existing,
    startParam,
    membership: () => groupMembership(user),
  });
  if (access.kind === 'allow') return false;
  if (access.kind === 'redeem') {
    await redeemInvite(user, access.code);
    return true;
  }
  throw new HttpError(403, access.code, ACCESS_DENIALS[access.code]);
}

/**
 * Игрок по tg_id: найденного обновляем, нового создаём. known — уже прочитанная строка (null — игрока
 * нет); не передана — читаем заново.
 * Имя из Telegram берём только при создании: дальше display_name принадлежит клубу
 * (админ задаёт его в сиде/админке, игрок меняет через set_my_name), и вход его не затирает.
 * username — всегда из Telegram (его нет — значит, нет); фото — только если Telegram его прислал:
 * photo_url приходит не при каждом способе запуска Mini App, и его отсутствие не значит «фото нет».
 */
async function upsertPlayer(
  user: TelegramUser,
  isAdminTg: boolean,
  known?: PlayerRow | null,
): Promise<PlayerRow> {
  const found = known === undefined ? await findPlayer(user.id) : known;

  if (found) {
    if (!found.is_active) {
      throw new HttpError(403, 'inactive', INACTIVE_TEXT);
    }
    const patch: Partial<PlayerRow> = { username: user.username ?? null };
    if (user.photo_url) patch.photo_url = user.photo_url;
    if (isAdminTg && !found.is_admin) patch.is_admin = true;
    const { data: updated, error: updError } = await db()
      .from('players')
      .update(patch)
      .eq('id', found.id)
      .select(PLAYER_COLUMNS)
      .single<PlayerRow>();
    if (updError) throw new Error(`players update: ${describeError(updError)}`);
    return updated;
  }

  const { data: created, error: insError } = await db()
    .from('players')
    .insert({
      tg_id: user.id,
      display_name: telegramDisplayName(user),
      username: user.username ?? null,
      photo_url: user.photo_url ?? null,
      is_admin: isAdminTg,
    })
    .select(PLAYER_COLUMNS)
    .single<PlayerRow>();
  if (insError) {
    // Два входа одновременно (двойной запуск эффекта, два устройства): второй упирается
    // в unique(tg_id) — берём строку, которую создал первый.
    if ((insError as { code?: string }).code === '23505') return upsertPlayer(user, isAdminTg);
    throw new Error(`players insert: ${describeError(insError)}`);
  }
  return created;
}

/**
 * auth-пользователь игрока и одноразовый токен входа.
 * createUser — только при первом входе (auth_user_id пуст); если пользователь с таким email уже
 * есть (связь потерялась), generateLink всё равно вернёт его id, и мы восстановим связь — но только
 * если этого пользователя создал tg-auth: в app_metadata лежит tg_id, а его пользователь сам
 * изменить не может. Иначе адрес tg<id>@… мог бы заранее занять посторонний (signup в облаке
 * включён по умолчанию) и получить чужой профиль при первом входе жертвы.
 * Регистрация в Auth закрыта (enable_signup = false), но admin-методы её не проверяют.
 */
async function issueLoginToken(
  player: PlayerRow,
  tgId: number,
): Promise<{ tokenHash: string; player: PlayerRow }> {
  const email = authEmail(tgId);
  const auth = db().auth.admin;

  if (!player.auth_user_id) {
    const { error } = await auth.createUser({
      email,
      email_confirm: true,
      user_metadata: { tg_id: tgId },
      app_metadata: { provider: 'telegram', tg_id: tgId },
    });
    // email_exists — уже создан раньше (сбой между createUser и записью связи): не ошибка.
    const exists =
      (error as { code?: string } | null)?.code === 'email_exists' ||
      /already (been )?registered/i.test(error?.message ?? '');
    if (error && !exists) throw new Error(`auth createUser: ${describeError(error)}`);
  }

  const { data, error } = await auth.generateLink({ type: 'magiclink', email });
  if (error || !data.user || !data.properties?.hashed_token) {
    throw new Error(`auth generateLink: ${describeError(error ?? 'пустой ответ')}`);
  }

  const taggedTgId = (data.user.app_metadata as { tg_id?: unknown } | undefined)?.tg_id;
  if (player.auth_user_id === data.user.id) {
    // Пользователи, созданные до метки, — дописываем её (связь уже доверенная).
    if (taggedTgId !== tgId) {
      const { error: tagError } = await auth.updateUserById(data.user.id, {
        app_metadata: { ...data.user.app_metadata, tg_id: tgId },
      });
      if (tagError) console.error(`tg-auth: метка tg_id ${tgId}: ${describeError(tagError)}`);
    }
  } else if (taggedTgId !== tgId) {
    console.error(`tg-auth: auth-пользователь ${data.user.id} для tg ${tgId} создан не tg-auth`);
    throw new HttpError(
      409,
      'auth_conflict',
      'Учётная запись для этого Telegram уже занята — напиши админу клуба',
    );
  }

  let linked = player;
  if (player.auth_user_id !== data.user.id) {
    const { data: updated, error: linkError } = await db()
      .from('players')
      .update({ auth_user_id: data.user.id })
      .eq('id', player.id)
      .select(PLAYER_COLUMNS)
      .single<PlayerRow>();
    if (linkError) throw new Error(`players link: ${describeError(linkError)}`);
    linked = updated;
  }
  return { tokenHash: data.properties.hashed_token, player: linked };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Только POST');

  try {
    const body = await readJsonBody(req);
    const initData = body?.initData;
    if (typeof initData !== 'string' || initData === '') {
      return errorResponse(400, 'no_init_data', 'Нет данных входа Telegram');
    }

    const check = await validateInitData(
      initData,
      requireEnv('TELEGRAM_BOT_TOKEN'),
      INIT_DATA_MAX_AGE_SEC,
    );
    if (!check.ok) return errorResponse(401, check.error, INIT_DATA_ERRORS[check.error]);
    const user = check.data.user;

    const adminTgId = readEnv('ADMIN_TG_ID');
    const isAdminTg = adminTgId !== undefined && adminTgId.trim() === String(user.id);
    if (isDryRun())
      console.log(`tg-auth dry-run: вход tg ${user.id}${isAdminTg ? ' (админ)' : ''}`);

    const existing = await findPlayer(user.id);
    const redeemed = await checkAccess(user, isAdminTg, existing, check.data.startParam);
    // Вход по коду только что создал или пометил игрока — строку читаем заново.
    const player = await upsertPlayer(user, isAdminTg, redeemed ? undefined : existing);
    const result = await issueLoginToken(player, user.id);

    return json({
      tokenHash: result.tokenHash,
      player: {
        id: result.player.id,
        tg_id: result.player.tg_id,
        display_name: result.player.display_name,
        username: result.player.username,
        photo_url: result.player.photo_url,
        is_guest: result.player.is_guest,
        is_admin: result.player.is_admin,
        is_active: result.player.is_active,
        created_at: result.player.created_at,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message);
    // Проверка группы не прошла: Telegram ответил ошибкой (не 400) или не ответил вовсе (сеть,
    // таймаут). Сообщения обоих классов — без токена бота.
    if (error instanceof TelegramApiError || error instanceof TelegramNetworkError) {
      console.error(`tg-auth: ${error.message}`);
      return errorResponse(
        502,
        'telegram',
        'Telegram не ответил на проверку участия в группе, попробуй ещё раз',
      );
    }
    console.error(`tg-auth: ${describeError(error)}`);
    return errorResponse(500, 'internal', 'Не удалось войти, попробуй ещё раз');
  }
});
