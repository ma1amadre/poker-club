import { useState } from 'react';
import { useEvenings, usePlayersById, useSettings, type Evening } from '../../shared/api';
import { formatDateTime, paths, pluralWithNumber, useNow } from '../../shared/lib';
import {
  Button,
  ButtonLink,
  Empty,
  ErrorView,
  EveningStatusBadge,
  List,
  ListItem,
  Section,
} from '../../shared/ui';
import { splitEvenings } from './lib';
import { ListSkeleton } from './parts';

const EVENINGS = ['вечер', 'вечера', 'вечеров'] as const;
const PAST_PAGE = 10;

/** Вкладка «Вечера»: ближайшие сверху со статусами, прошедшие ниже, «Создать вечер». */
export function EveningsTab() {
  const evenings = useEvenings();
  const players = usePlayersById();
  const settings = useSettings();
  const now = useNow(60_000);
  const [pastShown, setPastShown] = useState(PAST_PAGE);

  if (evenings.isPending) return <ListSkeleton label="Загрузка вечеров" />;
  if (evenings.isError)
    return (
      <ErrorView
        error={evenings.error}
        title="Не удалось загрузить вечера"
        onRetry={() => void evenings.refetch()}
      />
    );

  const { upcoming, past } = splitEvenings(evenings.data);
  const hours = settings.data?.announce_hours_before;

  const create = (
    <ButtonLink to={paths.adminEveningNew} variant="primary" icon="plus" block>
      Создать вечер
    </ButtonLink>
  );

  const row = (e: Evening, isUpcoming: boolean) => {
    const banker = e.banker_id ? players.get(e.banker_id)?.display_name : null;
    const stale = e.status === 'announced' && Date.parse(e.scheduled_at) < now;
    const subtitle = [
      e.location,
      banker ? `банкир ${banker}` : isUpcoming ? 'банкир не назначен' : null,
      stale ? 'дата прошла' : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <ListItem
        key={e.id}
        title={
          // Бейдж — в строке заголовка с переносом: справа он сжимал дату в три строки на 320 px.
          <span className="adm-title-badge">
            {formatDateTime(e.scheduled_at, now)}
            <EveningStatusBadge status={e.status} />
          </span>
        }
        subtitle={subtitle || undefined}
        to={paths.adminEvening(e.id)}
      />
    );
  };

  if (evenings.data.length === 0)
    return (
      <Empty
        icon="calendar"
        title="Создай первый вечер"
        description={
          hours
            ? `Бот создаёт вечер сам за ${hours} ч до игры по расписанию. Не хочешь ждать — создай его сейчас.`
            : 'Бот создаёт вечер сам по расписанию. Не хочешь ждать — создай его сейчас.'
        }
        action={create}
      />
    );

  return (
    <div className="adm-tab">
      {create}
      <Section
        title="Впереди"
        aside={upcoming.length > 0 ? pluralWithNumber(upcoming.length, EVENINGS) : undefined}
      >
        {upcoming.length > 0 ? (
          <List aria-label="Ближайшие вечера">{upcoming.map((e) => row(e, true))}</List>
        ) : (
          <p className="m-small adm-muted">
            Ближайших вечеров нет. Бот создаст следующий по расписанию
            {hours ? ` за ${hours} ч до игры` : ''}.
          </p>
        )}
      </Section>
      {past.length > 0 && (
        <Section title="Прошли" aside={pluralWithNumber(past.length, EVENINGS)}>
          <List aria-label="Прошедшие вечера">
            {past.slice(0, pastShown).map((e) => row(e, false))}
          </List>
          {past.length > pastShown && (
            <div>
              <Button
                variant="ghost"
                icon="chevron-down"
                onClick={() => setPastShown((n) => n + PAST_PAGE)}
              >
                Показать ещё {Math.min(PAST_PAGE, past.length - pastShown)}
              </Button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
