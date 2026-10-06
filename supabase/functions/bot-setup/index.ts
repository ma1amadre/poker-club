// bot-setup — настройка бота из админки «Клуб», чтобы не искать ID группы и имя бота руками.
// POST с JWT (verify_jwt = true), только админ клуба. Действия:
//   {action: 'me'}            → getMe: {bot: {username, name, canJoinGroups, canReadAllGroupMessages}};
//   {action: 'chats'}         → группы, где сейчас состоят и бот, и сам админ:
//                                {chats: [{id, title, type, status}], updates};
//   {action: 'test', chatId}  → проверочный пост в группу: {dryRun}.
// Поиск групп читает getUpdates БЕЗ offset: обновления не подтверждаются, повторный поиск видит
// их снова (пока Telegram их хранит — не дольше 24 часов). Каждого кандидата перепроверяем
// getChatMember(бот): из обновлений видно прошлое, а сохранить надо группу, где бот есть сейчас.
// И getChatMember(админ): добавить бота в свою группу может любой, кто знает его username, а выбор
// группы открывает вход в клуб всем её участникам. Поэтому в списке только группы, где состоит
// и тот админ, который ищет.
// TELEGRAM_DRY_RUN=1: Telegram не трогаем — бот, обновления и пост фейковые (botChats.ts).
// Ответы — как у notify: ошибки {error: текст на «ты», code}.
import {
  adminClient,
  describeError,
  errorResponse,
  json,
  preflight,
  readEnv,
  readJsonBody,
  resolveCaller,
} from '../_shared/admin.ts';
import { DRY_RUN_UPDATES, groupsFromUpdates, type FoundChat } from '../_shared/botChats.ts';
import { botConnectedPost } from '../_shared/messages.ts';
import {
  getChatMember,
  getMe,
  getUpdates,
  isChatMember,
  isDryRun,
  sendMessage,
  TelegramApiError,
  type ChatMemberStatus,
} from '../_shared/telegram.ts';

/** Сколько кандидатов перепроверяем getChatMember: у клуба одна группа, но бот мог побывать в разных. */
const MAX_CHECKS = 10;

interface ChatOut extends Omit<FoundChat, 'lastUpdateId'> {
  /** Статус бота в группе сейчас: administrator — можно не бояться ограничений на чтение участников. */
  status: ChatMemberStatus;
}

async function findChats(adminTgId: number): Promise<{ chats: ChatOut[]; updates: number }> {
  const me = await getMe();
  const updates = isDryRun() ? DRY_RUN_UPDATES : await getUpdates(['my_chat_member', 'message']);
  const chats: ChatOut[] = [];
  for (const c of groupsFromUpdates(updates).slice(0, MAX_CHECKS)) {
    try {
      const bot = await getChatMember(c.id, me.id);
      if (!isChatMember(bot)) continue;
      // Чужая группа: админа в ней нет (left/kicked или 400 «user not found») — не показываем.
      if (!isChatMember(await getChatMember(c.id, adminTgId))) continue;
      chats.push({ id: c.id, title: c.title, type: c.type, status: bot.status });
    } catch (err) {
      // Бота удалили, группа исчезла или превратилась в супергруппу — Telegram отвечает 400/403.
      if (err instanceof TelegramApiError && (err.status === 400 || err.status === 403)) continue;
      throw err;
    }
  }
  return { chats, updates: updates.length };
}

/** chatId из тела: целое отрицательное число (у групп id всегда < 0), числом или строкой. */
function parseChatId(value: unknown): number | null {
  const n = typeof value === 'string' && /^-\d{1,20}$/.test(value.trim()) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n < 0 ? n : null;
}

/**
 * Ошибка Telegram → понятный админу ответ. В TelegramApiError токена нет (только метод, код и
 * description); сетевые ошибки fetch callBotApi очищает от токена сам (redactBotToken).
 */
function telegramError(action: string, err: TelegramApiError): Response {
  console.error(`bot-setup ${action}: ${err.message}`);
  if (err.status === 401 || err.status === 404) {
    return errorResponse(
      502,
      'bad_token',
      'Telegram не принял токен бота. Проверь секрет TELEGRAM_BOT_TOKEN в GitHub и перезапусти деплой.',
    );
  }
  if (err.status === 409) {
    return errorResponse(
      409,
      'updates_conflict',
      'Telegram не отдаёт обновления: у бота включён webhook или его опрашивает другая программа. ' +
        'Отключи их и повтори поиск — или впиши ID группы вручную.',
    );
  }
  if (err.status === 429) {
    return errorResponse(429, 'rate_limited', 'Telegram просит подождать. Повтори через минуту.');
  }
  if (action === 'test' && (err.status === 400 || err.status === 403)) {
    return errorResponse(
      409,
      'cannot_post',
      'Бот не может написать в эту группу: его там нет или ему запрещено писать. ' +
        'Добавь бота в группу и повтори.',
    );
  }
  return errorResponse(502, 'telegram', 'Telegram не ответил как надо. Повтори через минуту.');
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse(405, 'method_not_allowed', 'Только POST');

  let action = '';
  try {
    const db = adminClient();
    const who = await resolveCaller(db, req);
    if ('response' in who) return who.response;
    if (!who.caller.is_admin) {
      return errorResponse(403, 'forbidden', 'Настраивать бота может только админ клуба');
    }

    const body = await readJsonBody(req);
    action = typeof body?.action === 'string' ? body.action : '';
    if (action !== 'me' && action !== 'chats' && action !== 'test') {
      return errorResponse(400, 'bad_action', 'Неизвестное действие');
    }
    if (!isDryRun() && !readEnv('TELEGRAM_BOT_TOKEN')) {
      return errorResponse(
        503,
        'no_token',
        'Токен бота не задан. Добавь секрет TELEGRAM_BOT_TOKEN в GitHub и перезапусти деплой.',
      );
    }

    if (action === 'me') {
      const me = await getMe();
      return json({
        ok: true,
        bot: {
          username: me.username,
          name: me.first_name,
          canJoinGroups: me.can_join_groups ?? null,
          canReadAllGroupMessages: me.can_read_all_group_messages ?? null,
        },
      });
    }

    if (action === 'chats') {
      const adminTgId = Number(who.caller.tg_id);
      if (!Number.isSafeInteger(adminTgId) || adminTgId <= 0) {
        return errorResponse(
          403,
          'no_tg_id',
          'У твоего профиля нет Telegram ID — искать группу не с чем. Впиши ID группы вручную.',
        );
      }
      return json({ ok: true, ...(await findChats(adminTgId)) });
    }

    const chatId = parseChatId(body?.chatId);
    if (chatId === null) {
      return errorResponse(
        400,
        'bad_chat',
        'ID группы — отрицательное число. Выбери группу заново.',
      );
    }
    const { data: settings, error } = await db
      .from('settings')
      .select('bot_username')
      .eq('id', 1)
      .maybeSingle<{ bot_username: string | null }>();
    if (error) throw new Error(describeError(error));
    const post = botConnectedPost(settings?.bot_username ?? null);
    const sent = await sendMessage(chatId, post.text, { buttons: post.buttons });
    return json({ ok: true, dryRun: sent.dryRun });
  } catch (err) {
    if (err instanceof TelegramApiError) return telegramError(action, err);
    console.error(`bot-setup ${action}: ${describeError(err)}`);
    return errorResponse(500, 'internal', 'Не удалось связаться с ботом. Повтори через минуту.');
  }
});
