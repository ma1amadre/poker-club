// Настройка бота из админки «Клуб» без ручного поиска ID (Edge Function bot-setup):
// имя бота — из getMe, группа — из обновлений бота, проверочный пост — в выбранную группу.
// Найденное сохраняется сразу одним полем (как кнопка, а не как правка формы) и подставляется
// в черновик формы, если он открыт, — иначе форма показала бы старое значение как правку.
import { useState } from 'react';
import {
  useFetchBotChats,
  useFetchBotInfo,
  useSendBotTestMessage,
  useUpsertSettings,
  type BotChat,
  type Settings,
} from '../../shared/api';
import { NBSP } from '../../shared/lib';
import { Badge, Button, List, ListItem, Notice, Sheet, useToast } from '../../shared/ui';
import { adminErrorText } from './lib';
import type { SettingsDraft } from './settingsDraft';

interface BotSetupProps {
  settings: Settings;
  /** Черновик формы (null — правок нет): найденное значение подставляется и в него. */
  draft: SettingsDraft | null;
  onDraftChange: (draft: SettingsDraft | null) => void;
}

/** «Подтянуть из бота» под полем «Имя бота». */
export function BotUsernameAction({ settings, draft, onDraftChange }: BotSetupProps) {
  const info = useFetchBotInfo();
  const save = useUpsertSettings();
  const toast = useToast();

  const pull = async () => {
    try {
      const bot = await info.mutateAsync();
      if (bot.username === settings.bot_username) {
        toast.success(`Имя бота уже сохранено: @${bot.username}`);
      } else {
        await save.mutateAsync({ bot_username: bot.username });
        toast.success(`Имя бота сохранено: @${bot.username}`);
      }
      if (draft) onDraftChange({ ...draft, botUsername: bot.username });
    } catch (error) {
      toast.error(adminErrorText(error));
    }
  };

  return (
    <Button
      size="sm"
      icon="refresh-cw"
      loading={info.isPending || save.isPending}
      onClick={() => void pull()}
    >
      Подтянуть из бота
    </Button>
  );
}

/** «Найти группу» (шторка со списком) и «Отправить проверочное сообщение» под полем «ID группы». */
export function GroupActions({ settings, draft, onDraftChange }: BotSetupProps) {
  const chats = useFetchBotChats();
  const save = useUpsertSettings();
  const test = useSendBotTestMessage();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const find = () => {
    setOpen(true);
    chats.mutate();
  };

  const choose = async (chat: BotChat) => {
    try {
      if (String(settings.group_chat_id) !== String(chat.id)) {
        await save.mutateAsync({ group_chat_id: chat.id });
      }
      if (draft) onDraftChange({ ...draft, groupChatId: String(chat.id) });
      setOpen(false);
      toast.success(`Группа «${chat.title}» подключена`);
    } catch (error) {
      toast.error(adminErrorText(error));
    }
  };

  const sendTest = () => {
    if (settings.group_chat_id === null) return;
    test.mutate(Number(settings.group_chat_id), {
      onSuccess: ({ dryRun }) =>
        toast.success(
          dryRun
            ? 'Локальный режим: сообщение записано в лог функции, в Telegram оно не ушло'
            : 'Сообщение отправлено — проверь группу',
        ),
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  return (
    <>
      <div className="adm-actions__row adm-bot-actions">
        <Button size="sm" icon="search" onClick={find}>
          Найти группу
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="send"
          loading={test.isPending}
          disabled={settings.group_chat_id === null}
          onClick={sendTest}
        >
          Отправить проверочное сообщение
        </Button>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!save.isPending}
        title="Группа клуба"
        description="Группы, куда добавлен бот. Выбери группу клуба — она сохранится сразу."
        className="adm-sheet"
        actions={
          <Button block icon="refresh-cw" loading={chats.isPending} onClick={() => chats.mutate()}>
            Искать снова
          </Button>
        }
      >
        {chats.isError && (
          <Notice tone="critical" title="Не удалось спросить бота">
            {adminErrorText(chats.error)}
          </Notice>
        )}
        {chats.isSuccess && chats.data.length > 0 && (
          <List plain aria-label="Группы с ботом">
            {chats.data.map((chat) => {
              const current = String(settings.group_chat_id) === String(chat.id);
              return (
                <ListItem
                  key={chat.id}
                  title={chat.title}
                  subtitle={
                    <span className="m-mono">
                      {chat.id}
                      {NBSP}· {chat.status === 'administrator' ? 'бот — админ' : 'бот — участник'}
                    </span>
                  }
                  after={current ? <Badge tone="positive">Подключена</Badge> : undefined}
                  disabled={save.isPending}
                  onClick={() => void choose(chat)}
                />
              );
            })}
          </List>
        )}
        {chats.isSuccess && chats.data.length === 0 && (
          <Notice tone="caution" title="Подходящих групп нет">
            В списке только группы, где есть и бот, и ты. Проверь, что бот — администратор группы.
            Telegram хранит сообщение о добавлении бота не дольше суток: если бота добавили раньше,
            удали его из группы, добавь снова и нажми «Искать снова».
          </Notice>
        )}
        <GroupHelp />
      </Sheet>
    </>
  );
}

/** Подсказка: как сделать, чтобы бот увидел группу. */
export function GroupHelp() {
  return (
    <ol className="m-small adm-steps">
      <li>
        Добавь бота в группу клуба и сделай его администратором: иначе Telegram может не отвечать
        боту, кто состоит в группе, и участники не войдут.
      </li>
      <li>
        Сразу после этого нажми «Найти группу». Сообщение о добавлении Telegram хранит не дольше
        суток.
      </li>
      <li>
        В списке только группы, где состоишь и ты. Группы нет — удали бота из группы, добавь снова и
        повтори поиск.
      </li>
    </ol>
  );
}
