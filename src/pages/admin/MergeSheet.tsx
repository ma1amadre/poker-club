// Шторка «Привязать к Telegram» (вкладка «Игроки»): игрок без Telegram (гость или сделанный
// постоянным) начал входить сам — его вечера, голоса и прогнозы переносятся на Telegram-профиль,
// а сам он удаляется (RPC merge_players, миграция 008). Сначала предпросмотр merge_players_preview:
// что перенесётся и что мешает; само слияние необратимо — через подтверждение с перечнем.
import { useState } from 'react';
import { useMergePlayers, useMergePreview, type Player } from '../../shared/api';
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
import { adminErrorText, mergeSummary, mergeTargets } from './lib';

export interface MergeSheetProps {
  /** Игрок без Telegram, которого привязываем. */
  guest: Player;
  players: readonly Player[];
  onClose: () => void;
  /** Слияние прошло: гостя больше нет — закрыть и его карточку. */
  onMerged: () => void;
}

export function MergeSheet({ guest, players, onClose, onMerged }: MergeSheetProps) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const merge = useMergePlayers();
  // После слияния гостя нет — предпросмотр больше не запрашиваем (ответил бы «гость не найден»).
  const preview = useMergePreview(guest.id, merge.isSuccess ? null : targetId);
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();

  const targets = mergeTargets(players, guest.id);
  const target = targets.find((p) => p.id === targetId) ?? null;
  const report = targetId !== null && preview.data ? preview.data : null;
  const lines = report ? mergeSummary(report) : [];
  const blocked = (report?.blockers.length ?? 0) > 0;

  const hints = Object.fromEntries(
    targets.map((p) => [
      p.id,
      [p.username ? `@${p.username}` : null, p.is_active ? null : 'отключён']
        .filter(Boolean)
        .join(' · ') || undefined,
    ]),
  );

  const submit = async () => {
    if (!report || !target || blocked) return;
    const ok = await confirm({
      title: `Привязать профиль «${guest.display_name}» к профилю «${target.display_name}»?`,
      message: (
        <>
          {lines.length > 0
            ? `К профилю «${target.display_name}» перейдут: ${joinNames(lines)}.`
            : `За профилем «${guest.display_name}» ничего не числится.`}{' '}
          Профиль «{guest.display_name}» удалится, отменить привязку нельзя.
        </>
      ),
      confirmText: 'Привязать профиль',
      cancelText: 'Не привязывать',
      danger: true,
    });
    if (!ok) return;
    merge.mutate(
      { guestId: guest.id, targetId: target.id },
      {
        onSuccess: (done) => {
          toast.success(`Профиль «${done.guest.name}» привязан к профилю «${done.target.name}»`, {
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
      title="Привязать к Telegram"
      description="Когда игрок без Telegram начинает входить сам, у него появляется второй профиль. Выбери его: вечера, голоса и прогнозы переедут туда, а этот профиль удалится, чтобы не висел дублем."
      className="adm-sheet"
      actions={
        <Button
          variant="primary"
          block
          icon="send"
          loading={merge.isPending}
          disabled={!report || blocked || preview.isFetching}
          onClick={() => void submit()}
        >
          Привязать профиль
        </Button>
      }
    >
      {targets.length === 0 ? (
        <p className="m-small adm-muted">
          В клубе пока нет профилей с Telegram. Профиль появится, когда человек впервые откроет
          приложение из группы.
        </p>
      ) : (
        <FieldGroup label="Telegram-профиль" hint="Повторный тап снимает выбор.">
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
          title="Не удалось проверить привязку"
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
        <Notice tone="caution" title="Привязать нельзя">
          <ul className="adm-merge-list">
            {report.blockers.map((text) => (
              <li key={text}>{text}</li>
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
              За профилем «{guest.display_name}» ничего не числится{NBSP}— после привязки он
              удалится.
            </p>
          )}
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
