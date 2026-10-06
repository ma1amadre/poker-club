// Поиск группы клуба по обновлениям бота (bot-setup, action 'chats') — чистая логика, vitest.
//
// Источник — getUpdates без подтверждения: в нём лежат обновления за последние сутки (дольше
// Telegram их не хранит). Главное — my_chat_member: Telegram присылает его, когда бота добавляют
// в чат, удаляют или меняют ему права. Сообщения из группы — запасной признак: раз бот видит
// сообщение, в этот момент он в группе. Кандидатов bot-setup потом перепроверяет getChatMember.
import { isChatMember, type TgChat, type TgUpdate } from './telegram.ts';

export interface FoundChat {
  id: number;
  title: string;
  type: 'group' | 'supergroup';
  /** update_id последнего обновления об этом чате — для сортировки «свежие сверху». */
  lastUpdateId: number;
}

const isGroup = (chat: TgChat): chat is TgChat & { type: 'group' | 'supergroup' } =>
  chat.type === 'group' || chat.type === 'supergroup';

/**
 * Группы и супергруппы, где бот, судя по обновлениям, сейчас состоит. Решает последнее
 * my_chat_member по чату (добавили → удалили → нет; удалили → добавили снова → да). Группа,
 * превращённая в супергруппу, остаётся только под новым id: старый id Telegram больше не принимает.
 */
export function groupsFromUpdates(updates: readonly TgUpdate[]): FoundChat[] {
  const chats = new Map<number, FoundChat & { inside: boolean }>();
  const migrated = new Set<number>();

  const touch = (chat: TgChat, updateId: number, inside: boolean | null) => {
    if (!isGroup(chat)) return;
    const prev = chats.get(chat.id);
    chats.set(chat.id, {
      id: chat.id,
      title: chat.title?.trim() || prev?.title || `Группа ${chat.id}`,
      type: chat.type,
      lastUpdateId: Math.max(updateId, prev?.lastUpdateId ?? updateId),
      // null — сообщение: о членстве говорит, только если про чат ещё ничего не известно.
      inside: inside ?? prev?.inside ?? true,
    });
  };

  for (const u of [...updates].sort((a, b) => a.update_id - b.update_id)) {
    const member = u.my_chat_member;
    if (member) touch(member.chat, u.update_id, isChatMember(member.new_chat_member));

    const msg = u.message;
    if (msg) {
      if (msg.migrate_to_chat_id !== undefined) {
        migrated.add(msg.chat.id);
        touch(
          { id: msg.migrate_to_chat_id, type: 'supergroup', title: msg.chat.title },
          u.update_id,
          true,
        );
      } else {
        if (msg.migrate_from_chat_id !== undefined) migrated.add(msg.migrate_from_chat_id);
        touch(msg.chat, u.update_id, null);
      }
    }
  }

  return [...chats.values()]
    .filter((c) => c.inside && !migrated.has(c.id))
    .sort((a, b) => b.lastUpdateId - a.lastUpdateId)
    .map(({ inside: _inside, ...chat }) => chat);
}

/**
 * Обновления для dry-run (локально настоящего бота нет): группу добавили и не удаляли, группу
 * добавили и удалили, группу превратили в супергруппу, сообщение из лички. Ожидаемый результат —
 * две группы: супергруппа после превращения и «Покерный клуб (локально)».
 */
export const DRY_RUN_UPDATES: TgUpdate[] = [
  {
    update_id: 1,
    my_chat_member: {
      chat: { id: -1001000000001, type: 'supergroup', title: 'Покерный клуб (локально)' },
      date: 1_791_000_000,
      old_chat_member: { status: 'left' },
      new_chat_member: { status: 'member' },
    },
  },
  {
    update_id: 2,
    my_chat_member: {
      chat: { id: -1001000000002, type: 'supergroup', title: 'Старая группа' },
      date: 1_791_000_010,
      old_chat_member: { status: 'left' },
      new_chat_member: { status: 'member' },
    },
  },
  {
    update_id: 3,
    my_chat_member: {
      chat: { id: -1001000000002, type: 'supergroup', title: 'Старая группа' },
      date: 1_791_000_020,
      old_chat_member: { status: 'member' },
      new_chat_member: { status: 'kicked' },
    },
  },
  {
    update_id: 4,
    message: {
      message_id: 10,
      date: 1_791_000_030,
      chat: { id: -4000000003, type: 'group', title: 'Пятничный стол' },
      migrate_to_chat_id: -1001000000003,
    },
  },
  {
    update_id: 5,
    message: {
      message_id: 11,
      date: 1_791_000_040,
      chat: { id: 1001, type: 'private' },
    },
  },
];
