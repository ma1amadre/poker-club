// «Вывести на ТВ»: QR и ссылка на табло. Главная — постоянная ссылка «Табло клуба» (/tv/<код>,
// миграция 023): её открывают на ТВ один раз, дальше табло само показывает идущий вечер, сегодняшний
// анонс или итог в пределах 6 ч. Ссылка только на этот вечер (/board/:token) — запасная: например,
// когда табло клуба занято другим вечером. Табло открывается без входа на любом экране.
import { useState } from 'react';
import { boardUrl, clubBoardUrl, copyText } from '../../shared/lib';
import { openLink } from '../../shared/telegram';
import { Button, LinkQr, Sheet, useToast } from '../../shared/ui';

export interface TvSheetProps {
  open: boolean;
  onClose: () => void;
  /** Токен табло вечера (evenings.board_token). */
  boardToken: string;
  /** Код табло клуба (settings.club_board_token); null — миграции 023 ещё нет, только ссылка вечера. */
  clubCode: string | null;
  /** Тренировочный вечер: табло клуба может быть занято настоящим вечером. */
  training?: boolean;
}

export function TvSheet({ open, ...rest }: TvSheetProps) {
  return open ? <TvSheetInner {...rest} /> : null;
}

function TvSheetInner({
  onClose,
  boardToken,
  clubCode,
  training = false,
}: Omit<TvSheetProps, 'open'>) {
  const toast = useToast();
  // Без кода клуба — только ссылка вечера (как до 023).
  const [eveningOnly, setEveningOnly] = useState(clubCode === null);
  const url = !eveningOnly && clubCode ? clubBoardUrl(clubCode) : boardUrl(boardToken);

  const copy = async () => {
    if (await copyText(url))
      toast.show(
        eveningOnly ? 'Ссылка на табло вечера скопирована' : 'Ссылка на табло клуба скопирована',
        {
          tone: 'positive',
        },
      );
    else
      toast.show('Ссылку не скопировать из этого окна', {
        tone: 'caution',
        detail: 'Выдели её в поле выше и скопируй вручную.',
      });
  };

  const description = eveningOnly
    ? 'Ссылка только на этот вечер: погаснет через 6 часов после финала. Наведи камеру телефона или ноутбука у телевизора на код — табло откроется без входа.'
    : 'Одна ссылка на все вечера: табло само показывает идущий вечер, сегодняшний анонс или итог — 6 часов после финала. Открой её на ТВ один раз и сохрани в закладки.';

  return (
    <Sheet
      open
      onClose={onClose}
      title={eveningOnly ? 'Табло этого вечера' : 'Табло клуба'}
      description={description}
      actions={
        <div className="ev-sheet-actions">
          <Button variant="primary" block icon="copy" onClick={() => void copy()}>
            Скопировать ссылку
          </Button>
          <Button variant="ghost" block icon="external-link" onClick={() => openLink(url)}>
            Открыть табло здесь
          </Button>
          {clubCode && (
            <Button variant="ghost" block icon="tv" onClick={() => setEveningOnly((v) => !v)}>
              {eveningOnly ? 'Показать табло клуба' : 'Ссылка только на этот вечер'}
            </Button>
          )}
        </div>
      }
    >
      <LinkQr
        url={url}
        alt={eveningOnly ? 'QR-код ссылки на табло вечера' : 'QR-код ссылки на табло клуба'}
      />
      {!eveningOnly && (
        <p className="m-small">
          ТВ без камеры: набери адрес в браузере ТВ или открой его на ноутбуке у телевизора.
          {training
            ? ' Если табло клуба занято настоящим вечером, открой ссылку только на эту тренировку.'
            : ''}
        </p>
      )}
    </Sheet>
  );
}
