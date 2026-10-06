// tg-auth — вход в Mini App без паролей.
// POST {initData} → подпись Telegram → право доступа (участник группы клуба / админ) →
// игрок по tg_id → auth-пользователь tg<id>@users.poker-club.invalid → одноразовый tokenHash.
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
import {
  getChatMember,
  isChatMember,
  isDryRun,
  telegramDisplayName,
  TelegramApiError,
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
  expired: 'Данные входа устарели, откройте приложение заново',
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
  created_at: string;
}

const PLAYER_COLUMNS =
  'id, auth_user_id, tg_id, display_name, username, photo_url, is_guest, is_admin, is_active, created_at';

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

/**
 * Право войти. Админ клуба (ADMIN_TG_ID) входит всегда — чтобы не запереть себя, если бот
 * выпал из группы. Остальные — только участники группы; пока группа не задана, вход только у админа
 * (кроме локального dry-run).
 */
async function checkAccess(user: TelegramUser, isAdminTg: boolean): Promise<void> {
  if (isAdminTg) return;
  const { data, error } = await db().from('settings').select('group_chat_id').eq('id', 1).single();
  if (error) throw new Error(`settings: ${describeError(error)}`);
  const groupChatId = (data as { group_chat_id: number | string | null }).group_chat_id;
  if (groupChatId === null || groupChatId === '') {
    // Локальный стек (TELEGRAM_DRY_RUN=1, в облаке не задаётся): в seed группы нет, а dev-вход
    // фронта должен пускать всех тестовых игроков — в dry-run считаем участником любого.
    if (isDryRun()) return;
    throw new HttpError(
      403,
      'no_group',
      'Клуб ещё не подключил группу — вход пока только у админа',
    );
  }
  let member;
  try {
    member = await getChatMember(groupChatId, user.id);
  } catch (error) {
    // 400 «user not found» / «member list is inaccessible» — пользователя в группе нет.
    if (error instanceof TelegramApiError && error.status === 400) {
      throw new HttpError(403, 'not_member', 'Вход только для участников группы клуба');
    }
    throw error;
  }
  if (!isChatMember(member)) {
    throw new HttpError(403, 'not_member', 'Вход только для участников группы клуба');
  }
}

/**
 * Игрок по tg_id: найденного обновляем, нового создаём.
 * Имя из Telegram берём только при создании: дальше display_name принадлежит клубу
 * (админ задаёт его в сиде/админке, игрок меняет через set_my_name), и вход его не затирает.
 * username — всегда из Telegram (его нет — значит, нет); фото — только если Telegram его прислал:
 * photo_url приходит не при каждом способе запуска Mini App, и его отсутствие не значит «фото нет».
 */
async function upsertPlayer(user: TelegramUser, isAdminTg: boolean): Promise<PlayerRow> {
  const { data: found, error } = await db()
    .from('players')
    .select(PLAYER_COLUMNS)
    .eq('tg_id', user.id)
    .maybeSingle<PlayerRow>();
  if (error) throw new Error(`players: ${describeError(error)}`);

  if (found) {
    if (!found.is_active) {
      throw new HttpError(403, 'inactive', 'Ваш профиль в клубе отключён. Обратитесь к админу');
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
 * есть (связь потерялась), generateLink всё равно вернёт его id, и мы восстановим связь.
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
      app_metadata: { provider: 'telegram' },
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

    await checkAccess(user, isAdminTg);
    const player = await upsertPlayer(user, isAdminTg);
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
    if (error instanceof TelegramApiError) {
      console.error(`tg-auth: ${error.message}`);
      return errorResponse(
        502,
        'telegram',
        'Telegram не ответил на проверку участия в группе, попробуйте ещё раз',
      );
    }
    console.error(`tg-auth: ${describeError(error)}`);
    return errorResponse(500, 'internal', 'Не удалось войти, попробуйте ещё раз');
  }
});
