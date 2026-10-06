import { TITLE_META, titles } from '@domain/achievements.ts';
import { hallOfFame } from '@domain/season.ts';
import type { PlayerId } from '@domain/types.ts';
import { useMemo } from 'react';
import { useClubHistory, type ClubHistory } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { formatSeason, paths, plural, seasonMonths } from '../../shared/lib';
import {
  Avatar,
  ButtonLink,
  Card,
  Empty,
  ErrorView,
  Notice,
  Page,
  PageSkeleton,
  Tabs,
  type TabItem,
} from '../../shared/ui';
import { AllTimeTab } from './AllTimeTab';
import { playerName, type RatingContext } from './context';
import { FameTab } from './FameTab';
import { MoneyTab } from './MoneyTab';
import { OracleTab } from './OracleTab';
import './rating.css';
import { SeasonTab } from './SeasonTab';
import { reigningChampions, seasonOptions } from './stats';
import { useRatingParams, type RatingTab } from './useRatingParams';

/** /rating — сезон, деньги, всё время, оракул, зал славы. Всё считает домен по истории клуба. */
export default function RatingPage() {
  const query = useClubHistory();

  if (query.isPending) return <PageSkeleton label="Загружаем рейтинг" />;
  if (query.isError) {
    return (
      <Page title="Рейтинг">
        <ErrorView
          error={query.error}
          title="Рейтинг не загрузился"
          onRetry={() => void query.refetch()}
        />
      </Page>
    );
  }
  return <Rating history={query.data} />;
}

function Rating({ history }: { history: ClubHistory }) {
  const { isAdmin } = useAuth();
  const seasons = useMemo(
    () => seasonOptions(history.summaries, history.currentSeasonKey),
    [history.summaries, history.currentSeasonKey],
  );
  const params = useRatingParams(seasons, history.currentSeasonKey);

  const ctx = useMemo<RatingContext>(() => {
    const hall = hallOfFame(history.summaries, {
      bestN: history.bestN,
      excluded: history.excluded,
      currentSeasonKey: history.currentSeasonKey,
      bestNBySeason: history.bestNBySeason,
    });
    const reigning = reigningChampions(hall, history.currentSeasonKey);
    return {
      history,
      playersById: new Map(history.players.map((p) => [p.id, p])),
      champions: new Set(reigning?.champions ?? []),
      championSeason: reigning?.seasonKey ?? null,
    };
  }, [history]);

  const formHolder = useMemo(() => titles(history.achievementInput).form, [history]);

  const subtitle = `Сезон — ${formatSeason(history.currentSeasonKey)}, ${seasonMonths(history.currentSeasonKey)}`;

  if (history.summaries.length === 0) {
    return (
      <Page title="Рейтинг" subtitle={subtitle}>
        <FailedNotice history={history} isAdmin={isAdmin} />
        <Empty
          icon="calendar"
          title="Рейтинг появится после первого вечера"
          description="Очки, деньги и прогнозы считаются, когда банкир завершает вечер."
          action={
            isAdmin ? (
              <ButtonLink to={paths.adminEveningNew} icon="plus">
                Назначить вечер
              </ButtonLink>
            ) : undefined
          }
        />
      </Page>
    );
  }

  const onSeason = (season: string) => params.set({ season });
  const tabs: TabItem<RatingTab>[] = [
    {
      id: 'season',
      label: 'Сезон',
      content: <SeasonTab ctx={ctx} seasons={seasons} season={params.season} onSeason={onSeason} />,
    },
    {
      id: 'money',
      label: 'Деньги',
      content: (
        <MoneyTab
          ctx={ctx}
          seasons={seasons}
          season={params.season}
          onSeason={onSeason}
          period={params.period}
          onPeriod={(period) => params.set({ period })}
        />
      ),
    },
    { id: 'alltime', label: 'Всё время', content: <AllTimeTab ctx={ctx} /> },
    {
      id: 'oracle',
      label: 'Оракул',
      content: <OracleTab ctx={ctx} seasons={seasons} season={params.season} onSeason={onSeason} />,
    },
    { id: 'fame', label: 'Зал славы', content: <FameTab ctx={ctx} /> },
  ];

  return (
    <Page title="Рейтинг" subtitle={subtitle}>
      <FailedNotice history={history} isAdmin={isAdmin} />
      {formHolder && <FormCard ctx={ctx} playerId={formHolder} />}
      <Tabs
        label="Таблицы рейтинга"
        tabs={tabs}
        value={params.tab}
        onChange={(tab) => params.set({ tab })}
      />
    </Page>
  );
}

/** Держатель переходящего звания «Форма» — вверху экрана, ссылка на его карточку. */
function FormCard({ ctx, playerId }: { ctx: RatingContext; playerId: PlayerId }) {
  const player = ctx.playersById.get(playerId);
  return (
    <Card variant="raised" to={paths.player(playerId)} className="rt-form">
      <div className="rt-form__row">
        <Avatar name={player?.display_name ?? '?'} photoUrl={player?.photo_url} size="lg" />
        <div className="rt-form__text">
          <p className="m-eyebrow">Звание «{TITLE_META.form.title}»</p>
          <p className="rt-form__name">{playerName(ctx, playerId)}</p>
          <p className="m-small">{TITLE_META.form.description}</p>
        </div>
      </div>
    </Card>
  );
}

/** Вечера, журнал которых домен не свёл: рейтинг посчитан без них — сказать об этом прямо. */
function FailedNotice({ history, isAdmin }: { history: ClubHistory; isAdmin: boolean }) {
  const failed = history.failed;
  if (failed.length === 0) return null;
  const only = failed.length === 1 ? failed[0] : undefined;
  return (
    <Notice
      tone="caution"
      title={`Рейтинг посчитан без ${failed.length === 1 ? 'одного вечера' : `${failed.length} ${plural(failed.length, ['вечера', 'вечеров', 'вечеров'])}`}`}
      action={
        isAdmin && only ? (
          <ButtonLink to={paths.evening(only.eveningId)} size="sm">
            Открыть
          </ButtonLink>
        ) : undefined
      }
    >
      Журнал событий не сходится со статусом вечера: игра отмечена завершённой, а по событиям — нет.
      {isAdmin
        ? ` Открой ${only ? 'вечер' : 'эти вечера в истории'} и проверь последние события.`
        : ' Админ клуба может это исправить.'}
    </Notice>
  );
}
