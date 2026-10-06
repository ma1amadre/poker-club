import { hallOfFame, type HallOfFameEntry } from '@domain/season.ts';
import { useMemo } from 'react';
import { formatPointsWithUnit, formatSeason, formatSeasonGenitive, paths } from '../../shared/lib';
import { Avatar, Card, Empty, Icon, List, ListItem } from '../../shared/ui';
import { playerName, type RatingContext } from './context';
import { Score } from './parts';

/**
 * Зал славы (hallOfFame домена): чемпионы завершённых сезонов, новые сверху. Переходящий
 * трофей — у чемпиона последнего завершённого сезона.
 */
export function FameTab({ ctx }: { ctx: RatingContext }) {
  const { history } = ctx;
  const hall = useMemo(
    () =>
      hallOfFame(history.summaries, {
        bestN: history.bestN,
        excluded: history.excluded,
        currentSeasonKey: history.currentSeasonKey,
      }),
    [history.summaries, history.bestN, history.excluded, history.currentSeasonKey],
  );

  if (hall.length === 0) {
    return (
      <div className="rt-panel">
        <Empty
          icon="calendar"
          title="Первого чемпиона ещё нет"
          description={`Чемпион определится, когда закончится ${formatSeason(history.currentSeasonKey)}: в зал славы попадает 1-е место сезона.`}
        />
      </div>
    );
  }

  const [holder, ...rest] = hall;
  return (
    <div className="rt-panel">
      {holder && <TrophyCard ctx={ctx} entry={holder} />}
      {rest.length > 0 && (
        <List aria-label="Чемпионы прошлых сезонов">
          {rest.map((entry) => (
            <ListItem
              key={entry.seasonKey}
              to={entry.champions.length === 1 ? paths.player(entry.champions[0] ?? '') : undefined}
              before={<Icon name="crown" size={20} className="rt-fame__icon" />}
              title={entry.champions.map((id) => playerName(ctx, id)).join(', ')}
              subtitle={`Чемпион ${formatSeasonGenitive(entry.seasonKey)}`}
              after={<Score value={entry.total} />}
            />
          ))}
        </List>
      )}
      <p className="m-small">
        Чемпион сезона — 1-е место таблицы сезона. Значок чемпиона держится до конца следующего
        сезона, трофей переходит к новому чемпиону.
      </p>
    </div>
  );
}

function TrophyCard({ ctx, entry }: { ctx: RatingContext; entry: HallOfFameEntry }) {
  const single = entry.champions.length === 1 ? entry.champions[0] : undefined;
  const names = entry.champions.map((id) => playerName(ctx, id)).join(', ');
  return (
    <Card variant={single ? 'raised' : 'outline'} to={single ? paths.player(single) : undefined}>
      <div className="rt-trophy">
        <span className="rt-trophy__avatars">
          {entry.champions.slice(0, 3).map((id) => {
            const player = ctx.playersById.get(id);
            return (
              <Avatar
                key={id}
                name={player?.display_name ?? '?'}
                photoUrl={player?.photo_url}
                size="xl"
              />
            );
          })}
        </span>
        <div className="rt-trophy__text">
          <p className="m-eyebrow rt-trophy__eyebrow">
            <Icon name="trophy" size={16} />
            Переходящий трофей
          </p>
          <p className="m-h3 rt-trophy__name">{names}</p>
          <p className="m-small">
            Чемпион {formatSeasonGenitive(entry.seasonKey)} · {formatPointsWithUnit(entry.total)}
          </p>
        </div>
      </div>
    </Card>
  );
}
