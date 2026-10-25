// Админка «Клуб» → «Приглашения» (миграция 029): личная ссылка на Mini App клуба для того, кого не
// получается добавить в группу. «Пригласить игрока» создаёт код (create_player_invite) и показывает
// ссылку один раз — в шторке со «Скопировать» и «Поделиться»; ниже — действующие (с «Отозвать»),
// использованные (кто и когда) и закрытые (истекли, отозваны). Ссылку строим из сохранённого имени бота:
// без него Telegram не откроет приложение.
// Ошибки «создать» и «отозвать» показывает общий тост мутаций (app/queryClient.ts): свой onError дал
// бы второй такой же тост.
import { useRef, useState, type ReactNode } from 'react';
import {
  isMissingRpc,
  useCreatedPlayerInvite,
  useCreatePlayerInvite,
  usePlayerInvites,
  useRevokePlayerInvite,
  type PlayerInvite,
  type Settings,
} from '../../shared/api';
import { copyText, inviteLink, useNow } from '../../shared/lib';
import { openTelegramLink } from '../../shared/telegram';
import {
  Button,
  List,
  ListItem,
  Notice,
  Section,
  Sheet,
  Skeleton,
  useConfirm,
  useToast,
} from '../../shared/ui';
import { groupInvites, inviteRow, inviteShareUrl, inviteTermNote } from './invites';
import { adminErrorText } from './lib';

const NO_BOT_TITLE = 'Сначала подключи бота';
const NO_BOT_TEXT =
  'Ссылка-приглашение открывает приложение через бота клуба. Впиши имя бота в «Группа и бот» или нажми «Подтянуть из бота» — и сохрани.';

export function InviteSection({ settings }: { settings: Settings }) {
  const invites = usePlayerInvites();
  const create = useCreatePlayerInvite();
  // Ссылка, которую админ видит один раз, — в кеше запросов: дождётся и ухода с вкладки до ответа.
  const [created, forgetCreated] = useCreatedPlayerInvite();
  const toast = useToast();
  const now = useNow(60_000);
  const bot = settings.bot_username?.trim() || null;

  // RPC ещё нет — фронт выложен раньше миграции 029: раздел появится после неё.
  if (invites.isError && isMissingRpc(invites.error)) return null;

  const invite = () => {
    if (!bot) {
      toast.show(NO_BOT_TITLE, { tone: 'caution', detail: NO_BOT_TEXT });
      return;
    }
    create.mutate();
  };

  return (
    <Section
      title="Приглашения"
      footer="Для того, кого не получается добавить в группу: личная ссылка на приложение клуба. Кто войдёт по ней, станет постоянным игроком с пометкой «по приглашению» и дальше будет входить сам, без группы, пока профиль активен. Закрыть вход — переключатель «Активен» во вкладке «Игроки»."
    >
      {!bot && (
        <Notice tone="caution" title={NO_BOT_TITLE}>
          {NO_BOT_TEXT}
        </Notice>
      )}
      {/* Без имени бота ссылку не собрать: кнопка недоступна, почему — в плашке над ней. */}
      <Button block icon="user-plus" loading={create.isPending} disabled={!bot} onClick={invite}>
        Пригласить игрока
      </Button>
      {invites.isPending ? (
        <div
          className="adm-invites__loading"
          role="status"
          aria-busy="true"
          aria-label="Загрузка приглашений"
        >
          <Skeleton width="45%" height={12} />
          <Skeleton width="70%" height={12} />
        </div>
      ) : invites.isError ? (
        <Notice
          tone="critical"
          title="Не удалось загрузить приглашения"
          action={
            <Button size="sm" icon="refresh-cw" onClick={() => void invites.refetch()}>
              Повторить
            </Button>
          }
        >
          {adminErrorText(invites.error)}
        </Notice>
      ) : (
        <InviteList invites={invites.data} now={now} />
      )}
      {created && bot && (
        <InviteSheet
          link={inviteLink(bot, created.code)}
          expiresAt={created.expiresAt}
          now={now}
          onClose={forgetCreated}
        />
      )}
    </Section>
  );
}

function InviteList({ invites, now }: { invites: PlayerInvite[]; now: number }) {
  const revoke = useRevokePlayerInvite();
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  const { active, used, closed } = groupInvites(invites, now);

  if (invites.length === 0) {
    return <p className="m-small adm-muted">Приглашений пока нет.</p>;
  }

  const askRevoke = async (invite: PlayerInvite) => {
    const ok = await confirm({
      title: 'Отозвать ссылку-приглашение?',
      message:
        'Ссылка перестанет работать сразу: тот, кто её откроет, не войдёт и увидит, что её отозвали. Вернуть её нельзя — понадобится снова, создай новую.',
      confirmText: 'Отозвать ссылку',
      cancelText: 'Оставить',
      danger: true,
    });
    if (!ok) return;
    revoke.mutate(invite.id, { onSuccess: () => toast.success('Ссылка-приглашение отозвана') });
  };

  const row = (invite: PlayerInvite, after?: ReactNode) => {
    const { title, subtitle } = inviteRow(invite, now);
    return <ListItem key={invite.id} title={title} subtitle={subtitle} after={after} />;
  };

  return (
    <div className="adm-invites">
      <InviteGroup title="Действуют" label="Действующие приглашения" invites={active}>
        {(invite) =>
          row(
            invite,
            <Button
              size="sm"
              variant="ghost"
              loading={revoke.isPending && revoke.variables === invite.id}
              disabled={revoke.isPending && revoke.variables !== invite.id}
              onClick={() => void askRevoke(invite)}
            >
              Отозвать
            </Button>,
          )
        }
      </InviteGroup>
      <InviteGroup
        title="Вошли по ссылке"
        label="Использованные приглашения"
        invites={used}
        limit={5}
      >
        {(invite) => row(invite)}
      </InviteGroup>
      <InviteGroup
        title="Истекли и отозваны"
        label="Истёкшие и отозванные приглашения"
        invites={closed}
        limit={3}
      >
        {(invite) => row(invite)}
      </InviteGroup>
      {confirmElement}
    </div>
  );
}

/**
 * Группа списка: заголовок-надпись со счётчиком и строки. limit — сколько строк видно сразу (закрытые
 * и использованные копятся), остальные — по «Показать все».
 */
function InviteGroup({
  title,
  label,
  invites,
  limit,
  children,
}: {
  title: string;
  label: string;
  invites: PlayerInvite[];
  limit?: number;
  children: (invite: PlayerInvite) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  if (invites.length === 0) return null;
  const folded = limit !== undefined && invites.length > limit;
  const shown = folded && !all ? invites.slice(0, limit) : invites;
  return (
    <div className="adm-invites__group">
      <h3 className="m-eyebrow adm-invites__head">
        {title} · {invites.length}
      </h3>
      <List aria-label={label}>{shown.map(children)}</List>
      {folded && (
        <Button
          size="sm"
          variant="ghost"
          className="adm-invites__more"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Свернуть' : `Показать все · ${invites.length}`}
        </Button>
      )}
    </div>
  );
}

/**
 * Скопировать старым путём (execCommand) через скрытое поле внутри шторки: WebView без
 * navigator.clipboard его часто ещё понимает, а поле вне шторки не получило бы фокус (ловушка фокуса).
 */
function copyViaField(text: string, host: HTMLElement | null): boolean {
  if (!host) return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.className = 'adm-invite-clip';
  field.setAttribute('aria-hidden', 'true');
  field.tabIndex = -1;
  const back = document.activeElement;
  host.append(field);
  let ok = false;
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  field.remove();
  if (back instanceof HTMLElement) back.focus({ preventScroll: true });
  return ok;
}

function InviteSheet({
  link,
  expiresAt,
  now,
  onClose,
}: {
  link: string;
  expiresAt: string;
  now: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const hostRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLParagraphElement>(null);

  const copy = async () => {
    if ((await copyText(link)) || copyViaField(link, hostRef.current)) {
      toast.show('Ссылка-приглашение скопирована', {
        tone: 'positive',
        detail: 'Отправь её тому, кого зовёшь в клуб, — личным сообщением.',
      });
      return;
    }
    // Буфер недоступен совсем — выделяем ссылку: остаётся скопировать её жестом телефона.
    if (linkRef.current) window.getSelection()?.selectAllChildren(linkRef.current);
    toast.show('Буфер обмена недоступен в этом окне', {
      tone: 'caution',
      detail: 'Ссылка выделена — скопируй её жестом телефона.',
    });
  };

  const share = () => openTelegramLink(inviteShareUrl(link, expiresAt, now));

  return (
    <Sheet
      open
      onClose={onClose}
      title="Ссылка-приглашение"
      description={inviteTermNote(expiresAt, now)}
      className="adm-sheet"
      actions={
        <div className="adm-actions">
          <Button variant="primary" block icon="send" onClick={share}>
            Поделиться в Telegram
          </Button>
          <Button block icon="copy" onClick={() => void copy()}>
            Скопировать ссылку
          </Button>
        </div>
      }
    >
      <div ref={hostRef} className="adm-invite">
        <p ref={linkRef} className="adm-invite-link">
          {link}
        </p>
        <p className="m-small adm-muted">
          Ссылку видно только сейчас — в списке её не будет. Если она потеряется, создай новую, а
          эту отзови.
        </p>
        <p className="m-small adm-muted">
          Человек откроет её в Telegram — и сразу попадёт в приложение клуба, без группы.
        </p>
      </div>
    </Sheet>
  );
}
