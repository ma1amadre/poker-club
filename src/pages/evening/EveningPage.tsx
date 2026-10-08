// Экран вечера /evening/:id — одна страница, режим по статусу и роли: анонс (сбор стола и старт),
// живая игра (у банкира и админа — пульт), итог (у админа — правка закрытого вечера).
// Realtime подключён в useEveningEvents: экран обновляется у всех без перезагрузки.
// Тренировочный вечер (миграция 023) — «Тренировка 8 октября» в шапке и пометка под ней: в историю,
// рейтинг и посты бота он не попадает. «Вывести на ТВ» — табло клуба (постоянная ссылка) или только
// этого вечера; кнопка видна и 6 ч после финала — столько живёт ссылка вечера.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { EVENING_STATUS_META, isTrainingEvening, useSettings } from '../../shared/api';
import { formatDate, formatWeekdayDate, formatTime, paths } from '../../shared/lib';
import {
  ButtonLink,
  Empty,
  ErrorView,
  IconButton,
  Notice,
  Page,
  PageSkeleton,
} from '../../shared/ui';
import { AnnouncedView } from './AnnouncedView';
import './evening.css';
import { FinishedView } from './FinishedView';
import { LiveView } from './LiveView';
import { FormatSummary, StaleNotice } from './parts';
import { usePultView } from './pultView';
import { TvSheet } from './TvSheet';
import { useEveningActions } from './useEveningActions';
import { useEveningModel, type EveningModel } from './useEveningModel';

/** Сколько после финала табло ещё показывает итог (private.board_evening_id, миграция 016). */
const BOARD_AFTER_FINISH_MS = 6 * 60 * 60 * 1000;

export default function EveningPage() {
  const { id } = useParams<{ id: string }>();
  const result = useEveningModel(id);

  if (result.status === 'loading') return <PageSkeleton label="Загрузка вечера" />;
  if (result.status === 'error') {
    return (
      <Page title="Вечер" back>
        <ErrorView error={result.error} title="Вечер не загрузился" onRetry={result.retry} />
      </Page>
    );
  }
  if (result.status === 'not_found') {
    return (
      <Page title="Вечер" back>
        <Empty
          kind="no-results"
          title="Такого вечера нет"
          description="Ссылка устарела или вечер удалили. Открой вечер из списка на главной."
          action={<ButtonLink to={paths.home}>Открыть главную</ButtonLink>}
        />
      </Page>
    );
  }
  return <EveningScreen model={result.model} />;
}

function EveningScreen({ model }: { model: EveningModel }) {
  const { evening, playersById } = model;
  const actions = useEveningActions(model);
  const [tvOpen, setTvOpen] = useState(false);
  const [pultView, setPultView] = usePultView();
  const clubCode = useSettings().data?.club_board_token ?? null;
  const training = isTrainingEvening(evening);
  // «Режим стола» у банкира: шапка без подписи и заметки, отступы плотнее — пульт без прокрутки.
  const tableMode = model.canControl && evening.status === 'live' && pultView === 'table';

  const banker = evening.banker_id ? playersById.get(evening.banker_id) : undefined;
  const subtitle = [
    `${formatWeekdayDate(evening.scheduled_at)}, ${formatTime(evening.scheduled_at)}`,
    evening.location,
    banker ? `банкир ${banker.display_name}` : 'банкир не назначен',
  ]
    .filter(Boolean)
    .join(' · ');

  // Итог табло показывает ещё 6 ч после финала (board_state, 016) — столько видна и кнопка.
  const finishedMs = evening.finished_at ? Date.parse(evening.finished_at) : Number.NaN;
  const recentlyFinished =
    (evening.status === 'finished' || evening.status === 'settled') &&
    Number.isFinite(finishedMs) &&
    model.nowMs - finishedMs < BOARD_AFTER_FINISH_MS;
  const showTv =
    Boolean(evening.board_token) &&
    (evening.status === 'announced' || evening.status === 'live' || recentlyFinished);
  const statusTitle = EVENING_STATUS_META[evening.status].title;

  return (
    <Page
      back
      eyebrow={statusTitle}
      title={`${training ? 'Тренировка' : 'Вечер'} ${formatDate(evening.scheduled_at, model.nowMs)}`}
      subtitle={tableMode ? undefined : subtitle}
      className={tableMode ? 'ev-page--table' : undefined}
      actions={
        showTv ? (
          <IconButton icon="tv" label="Вывести на ТВ" onClick={() => setTvOpen(true)} />
        ) : undefined
      }
    >
      {model.stale && <StaleNotice updatedAt={model.updatedAt} onRetry={model.retry} />}
      {training && !tableMode && (
        <Notice tone="info" title="Тренировочный вечер">
          Его не будет в истории, рейтинге, сезоне, ачивках и постах бота. Когда прогон закончен,
          админ удаляет его целиком: «Админ» → «Вечера».
        </Notice>
      )}
      {evening.note && !tableMode && <p className="m-body">{evening.note}</p>}

      {evening.status === 'announced' && (
        <AnnouncedView model={model} actions={actions} onTv={() => setTvOpen(true)} />
      )}
      {evening.status === 'live' && (
        <LiveView
          model={model}
          actions={actions}
          view={pultView}
          onViewChange={setPultView}
          onTv={() => setTvOpen(true)}
        />
      )}
      {(evening.status === 'finished' || evening.status === 'settled') && (
        <FinishedView model={model} actions={actions} />
      )}
      {evening.status === 'cancelled' && (
        <>
          <Notice tone="info" title="Вечер отменён">
            {evening.cancel_reason ? `Причина: «${evening.cancel_reason}». ` : ''}
            Игры в этот день не будет. Следующий вечер появится на главной, как только его назначат.
          </Notice>
          <FormatSummary format={evening.format} />
        </>
      )}

      {model.canControl && !evening.banker_id && evening.status !== 'cancelled' && (
        <Notice tone="caution" title="Банкир не назначен">
          Журнал ведёт админ. Назначить банкира можно в разделе «Админ».
        </Notice>
      )}

      {evening.board_token && (
        <TvSheet
          open={tvOpen}
          onClose={() => setTvOpen(false)}
          boardToken={evening.board_token}
          clubCode={clubCode}
          training={training}
        />
      )}
      {actions.confirmElement}
    </Page>
  );
}
