// Шторка слияния профилей (вкладка «Игроки»), два вида:
// - «Привязать к Telegram» (kind = 'telegram'): игрок без Telegram (гость или сделанный постоянным)
//   начал входить сам — его вечера, голоса и прогнозы переносятся на Telegram-профиль, а сам он
//   удаляется (RPC merge_players, миграция 008);
// - «Объединить дубли» (kind = 'guest'): одного человека вписали гостем дважды — всё дубля переходит
//   к профилю без Telegram, который оставляют, дубль удаляется (merge_guests, миграция 024).
// Сначала предпросмотр (что перенесётся и что мешает); само слияние необратимо — через подтверждение
// с перечнем.
import { useMemo, useState } from 'react';
import {
  useClubHistory,
  useMergePlayers,
  useMergePreview,
  type MergeKind,
  type Player,
} from '../../shared/api';
import { joinNames, NBSP } from '../../shared/lib';
import {
  Button,
  FieldGroup,
  Notice,
  PlayerPicker,
  Sheet,
  Skeleton,
  useConfirm,
  useToast,
} from '../../shared/ui';
import {
  adminErrorText,
  guestMergeFlagNotes,
  guestMergeHint,
  guestMergeTargets,
  mergeSummary,
  mergeTargets,
} from './lib';

export interface MergeSheetProps {
  /** Профиль без Telegram, который переносим (после слияния его не будет). */
  guest: Player;
  players: readonly Player[];
  /** Вид слияния: с Telegram-профилем (по умолчанию) или с другим профилем без Telegram. */
  kind?: MergeKind;
  onClose: () => void;
  /** Слияние прошло: гостя больше нет — закрыть и его карточку. */
  onMerged: () => void;
}

interface Texts {
  title: string;
  description: string;
  picker: string;
  empty: string;
  submit: string;
  icon: 'send' | 'users';
  confirmTitle: (guest: string, target: string) => string;
  confirmCancel: string;
  irreversible: (guest: string) => string;
  done: (guest: string, target: string) => string;
  blocked: string;
}

const TEXTS: Record<MergeKind, Texts> = {
  telegram: {
    title: 'Привязать к Telegram',
    description:
      'Когда игрок без Telegram начинает входить сам, у него появляется второй профиль. Выбери его: вечера, голоса и прогнозы переедут туда, а этот профиль удалится, чтобы не висел дублем.',
    picker: 'Telegram-профиль',
    empty:
      'В клубе пока нет профилей с Telegram. Профиль появится, когда человек впервые откроет приложение из группы.',
    submit: 'Привязать профиль',
    icon: 'send',
    confirmTitle: (g, t) => `Привязать профиль «${g}» к профилю «${t}»?`,
    confirmCancel: 'Не привязывать',
    irreversible: (g) => `Профиль «${g}» удалится, отменить привязку нельзя.`,
    done: (g, t) => `Профиль «${g}» привязан к профилю «${t}»`,
    blocked: 'Привязать нельзя',
  },
  guest: {
    title: 'Объединить дубли',
    description:
      'Если одного человека вписали гостем дважды, у него два профиля без Telegram. Выбери, какой оставить: вечера, голоса и прогнозы этого профиля переедут туда, а этот удалится.',
    picker: 'Оставить профиль',
    empty:
      'Других профилей без Telegram в клубе нет — объединять не с кем. Гостя с Telegram-профилем связывает «Привязать к Telegram».',
    submit: 'Объединить профили',
    icon: 'users',
    confirmTitle: (g, t) => `Объединить профиль «${g}» с профилем «${t}»?`,
    confirmCancel: 'Не объединять',
    irreversible: (g) => `Профиль «${g}» удалится, отменить объединение нельзя.`,
    done: (g, t) => `Профиль «${g}» объединён с профилем «${t}»`,
    blocked: 'Объединить нельзя',
  },
};

export function MergeSheet({
  guest,
  players,
  kind = 'telegram',
  onClose,
  onMerged,
}: MergeSheetProps) {
  const text = TEXTS[kind];
  const [targetId, setTargetId] = useState<string | null>(null);
  const merge = useMergePlayers(kind);
  // После слияния гостя нет — предпросмотр больше не запрашиваем (ответил бы «гость не найден»).
  const preview = useMergePreview(guest.id, merge.isSuccess ? null : targetId, kind);
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  // Сколько вечеров сыграл каждый — подсказка, какой из дублей оставить (история уже в кеше).
  const summaries = useClubHistory().data?.summaries;
  const played = useMemo(() => {
    const count = new Map<string, number>();
    for (const s of summaries ?? [])
      for (const id of s.entrants) count.set(id, (count.get(id) ?? 0) + 1);
    return count;
  }, [summaries]);

  const targets =
    kind === 'guest' ? guestMergeTargets(players, guest) : mergeTargets(players, guest.id);
  const target = targets.find((p) => p.id === targetId) ?? null;
  const report = targetId !== null && preview.data ? preview.data : null;
  const lines = report ? mergeSummary(report) : [];
  const flagNotes =
    report && target && kind === 'guest' ? guestMergeFlagNotes(report, target.display_name) : [];
  const blocked = (report?.blockers.length ?? 0) > 0;

  const hints = Object.fromEntries(
    targets.map((p) => [
      p.id,
      kind === 'guest'
        ? guestMergeHint(p, guest, played.get(p.id)) || undefined
        : [p.username ? `@${p.username}` : null, p.is_active ? null : 'отключён']
            .filter(Boolean)
            .join(' · ') || undefined,
    ]),
  );

  const submit = async () => {
    if (!report || !target || blocked) return;
    const ok = await confirm({
      title: text.confirmTitle(guest.display_name, target.display_name),
      message: (
        <>
          {lines.length > 0
            ? `К профилю «${target.display_name}» перейдут: ${joinNames(lines)}.`
            : `За профилем «${guest.display_name}» ничего не числится.`}{' '}
          {flagNotes.map((note) => `${note} `)}
          {text.irreversible(guest.display_name)}
        </>
      ),
      confirmText: text.submit,
      cancelText: text.confirmCancel,
      danger: true,
    });
    if (!ok) return;
    merge.mutate(
      { guestId: guest.id, targetId: target.id },
      {
        onSuccess: (done) => {
          toast.success(text.done(done.guest.name, done.target.name), {
            detail: lines.length > 0 ? `Перенесено: ${joinNames(lines)}.` : undefined,
          });
          onMerged();
        },
        onError: (error) => {
          toast.error(adminErrorText(error));
          // Препятствие могло появиться, пока открыта шторка, — показать его здесь же.
          void preview.refetch();
        },
      },
    );
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!merge.isPending}
      title={text.title}
      description={text.description}
      className="adm-sheet"
      actions={
        <Button
          variant="primary"
          block
          icon={text.icon}
          loading={merge.isPending}
          disabled={!report || blocked || preview.isFetching}
          onClick={() => void submit()}
        >
          {text.submit}
        </Button>
      }
    >
      {targets.length === 0 ? (
        <p className="m-small adm-muted">{text.empty}</p>
      ) : (
        <FieldGroup label={text.picker} hint="Повторный тап снимает выбор.">
          <PlayerPicker
            players={targets}
            value={targetId ? [targetId] : []}
            onChange={(ids) => setTargetId(ids[0] ?? null)}
            max={1}
            min={0}
            hints={hints}
          />
        </FieldGroup>
      )}

      {targetId !== null && preview.isPending && (
        <div aria-busy="true" aria-label="Проверяем, что перенесётся">
          <Skeleton height={72} />
        </div>
      )}

      {targetId !== null && preview.isError && (
        <Notice
          tone="critical"
          title="Не удалось проверить слияние"
          action={
            <Button size="sm" onClick={() => void preview.refetch()}>
              Проверить снова
            </Button>
          }
        >
          {adminErrorText(preview.error)}
        </Notice>
      )}

      {report && target && blocked && (
        <Notice tone="caution" title={text.blocked}>
          <ul className="adm-merge-list">
            {report.blockers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Notice>
      )}

      {report && target && !blocked && (
        <div className="adm-merge-summary">
          <p className="m-body adm-strong">К профилю «{target.display_name}» перейдут</p>
          {lines.length > 0 ? (
            <ul className="m-small adm-merge-list">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="m-small adm-muted">
              За профилем «{guest.display_name}» ничего не числится{NBSP}— после{' '}
              {kind === 'guest' ? 'объединения' : 'привязки'} он удалится.
            </p>
          )}
          {flagNotes.map((note) => (
            <p key={note} className="m-small">
              {note}
            </p>
          ))}
          {report.photosKept > 0 && (
            <p className="m-small adm-muted">
              Фото к голосам останутся в хранилище на прежнем месте и будут видны в голосовании как
              раньше.
            </p>
          )}
        </div>
      )}
      {confirmElement}
    </Sheet>
  );
}
