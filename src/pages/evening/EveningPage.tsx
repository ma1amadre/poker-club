// Экран вечера /evening/:id — одна страница, режим по статусу и роли: анонс (сбор стола и старт),
// живая игра (у банкира и админа — пульт), итог (у админа — правка закрытого вечера).
// Realtime подключён в useEveningEvents: экран обновляется у всех без перезагрузки.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { EVENING_STATUS_META } from '../../shared/api';
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
import { FormatSummary } from './parts';
import { TvSheet } from './TvSheet';
import { useEveningActions } from './useEveningActions';
import { useEveningModel, type EveningModel } from './useEveningModel';

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
          description="Ссылка устарела или вечер удалили. Откройте вечер из списка на главной."
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

  const banker = evening.banker_id ? playersById.get(evening.banker_id) : undefined;
  const subtitle = [
    `${formatWeekdayDate(evening.scheduled_at)}, ${formatTime(evening.scheduled_at)}`,
    evening.location,
    banker ? `банкир ${banker.display_name}` : 'банкир не назначен',
  ]
    .filter(Boolean)
    .join(' · ');

  const showTv =
    Boolean(evening.board_token) && (evening.status === 'announced' || evening.status === 'live');

  return (
    <Page
      back
      eyebrow={EVENING_STATUS_META[evening.status].title}
      title={`Вечер ${formatDate(evening.scheduled_at, model.nowMs)}`}
      subtitle={subtitle}
      actions={
        showTv ? (
          <IconButton icon="tv" label="Вывести на ТВ" onClick={() => setTvOpen(true)} />
        ) : undefined
      }
    >
      {evening.note && <p className="m-body">{evening.note}</p>}

      {evening.status === 'announced' && <AnnouncedView model={model} actions={actions} />}
      {evening.status === 'live' && <LiveView model={model} actions={actions} />}
      {(evening.status === 'finished' || evening.status === 'settled') && (
        <FinishedView model={model} actions={actions} />
      )}
      {evening.status === 'cancelled' && (
        <>
          <Notice tone="info" title="Вечер отменён">
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
        <TvSheet open={tvOpen} onClose={() => setTvOpen(false)} boardToken={evening.board_token} />
      )}
      {actions.confirmElement}
    </Page>
  );
}
