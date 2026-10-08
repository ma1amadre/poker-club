// Админка «Клуб» → «Табло клуба» (миграция 023): постоянная ссылка табло для ТВ — QR, копирование,
// перевыпуск. Перевыпуск гасит старую ссылку сразу: табло, открытые по ней, покажут «Ссылка табло
// устарела» — поэтому через подтверждение.
import { useRotateClubBoardToken, type Settings } from '../../shared/api';
import { clubBoardUrl, copyText } from '../../shared/lib';
import { openLink } from '../../shared/telegram';
import { Button, LinkQr, Section, useConfirm, useToast } from '../../shared/ui';
import { adminErrorText } from './lib';

export function ClubBoardSection({ settings }: { settings: Settings }) {
  const toast = useToast();
  const rotate = useRotateClubBoardToken();
  const { confirm, confirmElement } = useConfirm();
  // Колонки нет — фронт выложен раньше миграции 023: раздел появится после неё.
  const code = (settings.club_board_token as string | undefined) ?? null;
  if (!code) return null;
  const url = clubBoardUrl(code);

  const copy = async () => {
    if (await copyText(url)) toast.show('Ссылка на табло клуба скопирована', { tone: 'positive' });
    else
      toast.show('Ссылку не скопировать из этого окна', {
        tone: 'caution',
        detail: 'Выдели её под кодом и скопируй вручную.',
      });
  };

  const reissue = async () => {
    const ok = await confirm({
      title: 'Перевыпустить ссылку табло?',
      message:
        'Старая ссылка перестанет работать сразу: табло, открытые по ней, покажут «Ссылка табло устарела». Новую придётся открыть на ТВ заново. Ссылки отдельных вечеров не изменятся.',
      confirmText: 'Перевыпустить ссылку',
      cancelText: 'Оставить прежнюю',
      danger: true,
    });
    if (!ok) return;
    rotate.mutate(undefined, {
      onSuccess: () =>
        toast.success('Новая ссылка табло готова', {
          detail: 'Открой её на ТВ и сохрани в закладки вместо прежней.',
        }),
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  return (
    <Section
      title="Табло клуба"
      footer="Одна ссылка на все вечера: табло само показывает идущий вечер, сегодняшний анонс или итог — 6 часов после финала. Её же даёт кнопка «Вывести на ТВ» на экране вечера."
    >
      <LinkQr url={url} alt="QR-код ссылки на табло клуба" />
      <div className="adm-actions">
        <Button variant="primary" block icon="copy" onClick={() => void copy()}>
          Скопировать ссылку
        </Button>
        <Button variant="ghost" block icon="external-link" onClick={() => openLink(url)}>
          Открыть табло здесь
        </Button>
        <Button
          variant="ghost"
          block
          icon="refresh-cw"
          loading={rotate.isPending}
          onClick={() => void reissue()}
        >
          Перевыпустить ссылку
        </Button>
        <p className="m-small adm-muted">
          Перевыпусти, если ссылка попала к тем, кому табло видеть не нужно: старая сразу погаснет.
        </p>
      </div>
      {confirmElement}
    </Section>
  );
}
