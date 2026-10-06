// Поиск группы клуба по обновлениям бота (bot-setup).
import { describe, expect, it } from 'vitest';
import { DRY_RUN_UPDATES, groupsFromUpdates } from './botChats.ts';
import type { TgUpdate } from './telegram.ts';

const memberUpdate = (
  updateId: number,
  chatId: number,
  status: 'member' | 'administrator' | 'left' | 'kicked' | 'restricted',
  title = 'Клуб',
  isMember?: boolean,
): TgUpdate => ({
  update_id: updateId,
  my_chat_member: {
    chat: { id: chatId, type: 'supergroup', title },
    date: 0,
    old_chat_member: { status: 'left' },
    new_chat_member: { status, ...(isMember === undefined ? {} : { is_member: isMember }) },
  },
});

describe('groupsFromUpdates', () => {
  it('пусто — пусто', () => {
    expect(groupsFromUpdates([])).toEqual([]);
  });

  it('решает последнее my_chat_member по чату, порядок — по update_id', () => {
    const removedThenAdded = [
      memberUpdate(2, -100, 'administrator'),
      memberUpdate(1, -100, 'left'),
    ];
    expect(groupsFromUpdates(removedThenAdded).map((c) => c.id)).toEqual([-100]);
    const addedThenRemoved = [memberUpdate(1, -100, 'member'), memberUpdate(2, -100, 'kicked')];
    expect(groupsFromUpdates(addedThenRemoved)).toEqual([]);
  });

  it('restricted считается участником, только пока is_member', () => {
    expect(groupsFromUpdates([memberUpdate(1, -100, 'restricted', 'Клуб', true)])).toHaveLength(1);
    expect(groupsFromUpdates([memberUpdate(1, -100, 'restricted', 'Клуб', false)])).toEqual([]);
  });

  it('сообщение из группы без my_chat_member — бот в группе; после удаления — нет', () => {
    const msg = (updateId: number): TgUpdate => ({
      update_id: updateId,
      message: { message_id: updateId, date: 0, chat: { id: -5, type: 'group', title: 'Стол' } },
    });
    expect(groupsFromUpdates([msg(1)])).toEqual([
      { id: -5, title: 'Стол', type: 'group', lastUpdateId: 1 },
    ]);
    const kicked: TgUpdate = {
      update_id: 2,
      my_chat_member: {
        chat: { id: -5, type: 'group', title: 'Стол' },
        date: 0,
        old_chat_member: { status: 'member' },
        new_chat_member: { status: 'kicked' },
      },
    };
    // Сообщение раньше удаления не воскрешает группу, и позднее сообщение-эхо тоже.
    expect(groupsFromUpdates([msg(1), kicked, msg(3)])).toEqual([]);
  });

  it('группа, превращённая в супергруппу, — только под новым id', () => {
    const updates: TgUpdate[] = [
      memberUpdate(1, -42, 'member', 'Стол'),
      {
        update_id: 2,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: -42, type: 'group', title: 'Стол' },
          migrate_to_chat_id: -1004242,
        },
      },
      {
        update_id: 3,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: -1004242, type: 'supergroup', title: 'Стол' },
          migrate_from_chat_id: -42,
        },
      },
    ];
    expect(groupsFromUpdates(updates)).toEqual([
      { id: -1004242, title: 'Стол', type: 'supergroup', lastUpdateId: 3 },
    ]);
  });

  it('личка и каналы не группы', () => {
    const updates: TgUpdate[] = [
      { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 7, type: 'private' } } },
      {
        update_id: 2,
        my_chat_member: {
          chat: { id: -1009, type: 'channel', title: 'Канал' },
          date: 0,
          old_chat_member: { status: 'left' },
          new_chat_member: { status: 'administrator' },
        },
      },
    ];
    expect(groupsFromUpdates(updates)).toEqual([]);
  });

  it('свежие сверху; название — последнее известное', () => {
    const updates = [
      memberUpdate(1, -1, 'member', 'Первая'),
      memberUpdate(2, -2, 'member', 'Вторая'),
      memberUpdate(3, -1, 'administrator', 'Первая, новое имя'),
    ];
    expect(groupsFromUpdates(updates).map((c) => [c.id, c.title])).toEqual([
      [-1, 'Первая, новое имя'],
      [-2, 'Вторая'],
    ]);
  });

  it('обновления dry-run дают две группы', () => {
    expect(groupsFromUpdates(DRY_RUN_UPDATES).map((c) => c.id)).toEqual([
      -1001000000003, -1001000000001,
    ]);
  });
});
