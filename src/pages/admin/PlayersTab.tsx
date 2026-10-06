import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  queryKeys,
  upsertPlayer,
  usePlayers,
  useUpsertPlayer,
  type Player,
  type PlayerInput,
} from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { NAME_MAX, normalizeName, pluralWithNumber } from '../../shared/lib';
import {
  Avatar,
  Badge,
  Button,
  ErrorView,
  Field,
  List,
  ListItem,
  Section,
  Sheet,
  Switch,
  useToast,
} from '../../shared/ui';
import { adminErrorText, groupPlayers, nameError } from './lib';
import { ListSkeleton } from './parts';

const PLAYERS = ['игрок', 'игрока', 'игроков'] as const;

/** Вкладка «Игроки»: участники, гости и отключённые строками списка; правка — в шторке. */
export function PlayersTab() {
  const players = usePlayers();
  const { player: me } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);

  if (players.isPending) return <ListSkeleton label="Загрузка игроков" />;
  if (players.isError)
    return (
      <ErrorView
        error={players.error}
        title="Не удалось загрузить игроков"
        onRetry={() => void players.refetch()}
      />
    );

  const { members, guests, inactive } = groupPlayers(players.data);
  const open = players.data.find((p) => p.id === openId) ?? null;

  const row = (p: Player) => {
    const parts = [
      p.id === me?.id ? 'это вы' : null,
      p.username ? `@${p.username}` : p.tg_id === null ? 'без Telegram' : null,
    ].filter(Boolean);
    return (
      <ListItem
        key={p.id}
        before={<Avatar name={p.display_name} photoUrl={p.photo_url} />}
        title={p.display_name}
        subtitle={parts.join(' · ') || undefined}
        after={
          p.is_admin ? (
            <Badge>Админ</Badge>
          ) : p.is_guest && !p.is_active ? (
            <Badge>Гость</Badge>
          ) : undefined
        }
        onClick={() => setOpenId(p.id)}
        chevron
      />
    );
  };

  return (
    <div className="adm-tab">
      <Section title="Участники" aside={pluralWithNumber(members.length, PLAYERS)}>
        <List aria-label="Участники клуба">{members.map(row)}</List>
      </Section>
      {guests.length > 0 && (
        <Section
          title="Гости"
          aside={pluralWithNumber(guests.length, PLAYERS)}
          footer="Гостя вписывает банкир по имени прямо за столом. В рейтинг и ачивки он не попадает, пока его не сделают постоянным."
        >
          <List aria-label="Гости">{guests.map(row)}</List>
        </Section>
      )}
      {inactive.length > 0 && (
        <Section
          title="Отключены"
          aside={pluralWithNumber(inactive.length, PLAYERS)}
          footer="Отключённый игрок не может войти в приложение. Сыгранные вечера остаются в истории."
        >
          <List aria-label="Отключённые игроки">{inactive.map(row)}</List>
        </Section>
      )}
      {open && (
        <PlayerSheet
          key={open.id}
          player={open}
          isMe={open.id === me?.id}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

type Flag = 'is_admin' | 'is_active' | 'is_guest';

function PlayerSheet({
  player,
  isMe,
  onClose,
}: {
  player: Player;
  isMe: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(player.display_name);
  const [nameTouched, setNameTouched] = useState(false);
  const update = useUpsertPlayer();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { updatePlayer } = useAuth();

  const nameProblem = nameError(name);
  const nameChanged = normalizeName(name) !== player.display_name;

  // upsert, а не update: shared/api даёт только его. display_name передаём всегда — без него
  // строка вставки нарушила бы not null ещё до разрешения конфликта по id.
  const write = (patch: Partial<Pick<PlayerInput, Flag | 'display_name'>>) =>
    ({ id: player.id, display_name: player.display_name, ...patch }) satisfies PlayerInput;

  const applySaved = (saved: Player) => {
    queryClient.setQueryData<Player[]>(queryKeys.players, (old) =>
      old?.map((p) => (p.id === saved.id ? saved : p)),
    );
    if (isMe) updatePlayer(saved);
  };

  const pendingFlag = (flag: Flag): boolean | undefined =>
    update.isPending && update.variables && flag in update.variables
      ? Boolean(update.variables[flag])
      : undefined;

  const toggle = (flag: 'is_admin' | 'is_active', value: boolean) => {
    update.mutate(write({ [flag]: value }), {
      onSuccess: (saved) => {
        applySaved(saved);
        const who = saved.display_name;
        toast.success(
          flag === 'is_admin'
            ? value
              ? `${who} теперь админ клуба`
              : `${who} больше не админ`
            : value
              ? `${who} снова может входить`
              : `${who} отключён`,
        );
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  const makePermanent = () => {
    update.mutate(write({ is_guest: false }), {
      onSuccess: (saved) => {
        applySaved(saved);
        toast.show(`${saved.display_name} теперь постоянный игрок`, {
          tone: 'positive',
          durationMs: 8000,
          action: {
            label: 'Отменить',
            // Шторка к этому времени может быть закрыта — пишем напрямую и обновляем список.
            onClick: () =>
              void upsertPlayer({ id: saved.id, display_name: saved.display_name, is_guest: true })
                .then(() => {
                  void queryClient.invalidateQueries({ queryKey: queryKeys.players });
                  void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
                })
                .catch((error: unknown) => toast.error(adminErrorText(error))),
          },
        });
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    setNameTouched(true);
    if (nameProblem || !nameChanged) return;
    update.mutate(write({ display_name: normalizeName(name) }), {
      onSuccess: (saved) => {
        applySaved(saved);
        setName(saved.display_name);
        setNameTouched(false);
        toast.success('Имя сохранено');
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  const telegram = player.username
    ? `Telegram: @${player.username}`
    : player.tg_id !== null
      ? 'Telegram без имени пользователя'
      : 'Без Telegram: войти по этому профилю нельзя';

  const adminShown = pendingFlag('is_admin') ?? player.is_admin;
  const activeShown = pendingFlag('is_active') ?? player.is_active;

  return (
    <Sheet
      open
      onClose={onClose}
      title={player.display_name}
      description={telegram}
      className="adm-sheet"
    >
      <form className="adm-rename" onSubmit={rename} noValidate>
        <Field
          label="Имя в клубе"
          autoComplete="off"
          maxLength={NAME_MAX * 2}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setNameTouched(true)}
          error={nameTouched ? (nameProblem ?? undefined) : undefined}
          hint={`До ${NAME_MAX} символов. Его видят все участники.`}
        />
        <Button
          type="submit"
          variant="primary"
          block
          disabled={!nameChanged}
          loading={update.isPending && update.variables?.display_name !== player.display_name}
        >
          Сохранить имя
        </Button>
      </form>

      <div className="adm-switches">
        {player.tg_id !== null && (
          <Switch
            label="Админ клуба"
            description={
              isMe
                ? 'Свои права снять нельзя — так клуб может остаться без админа.'
                : 'Видит раздел «Админ»: настройки, форматы, игроки и вечера.'
            }
            checked={adminShown}
            disabled={isMe || update.isPending}
            onChange={(value) => toggle('is_admin', value)}
          />
        )}
        <Switch
          label="Активен"
          description={
            isMe
              ? 'Себя отключить нельзя.'
              : 'Выключенный игрок не может войти в приложение. Его вечера остаются в истории.'
          }
          checked={activeShown}
          disabled={isMe || update.isPending}
          onChange={(value) => toggle('is_active', value)}
        />
      </div>

      {player.is_guest && (
        <div className="adm-guest">
          <p className="m-small adm-muted">
            Гость не попадает в рейтинг и не получает ачивки. Сделайте его постоянным, если он ходит
            регулярно.
          </p>
          <Button
            icon="user-plus"
            block
            loading={pendingFlag('is_guest') !== undefined}
            onClick={makePermanent}
          >
            Сделать постоянным
          </Button>
        </div>
      )}
    </Sheet>
  );
}
