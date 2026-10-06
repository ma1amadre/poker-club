import { allTimeStandings } from '@domain/season.ts';
import { useMemo } from 'react';
import { scoringFromSettings } from '../../shared/api';
import { formatDate, paths, scoringRule, standingMeta } from '../../shared/lib';
import { List, ListItem } from '../../shared/ui';
import type { RatingContext } from './context';
import { PlayerName, Rank, Score } from './parts';
import { standingPlaces } from './stats';

/** Зачёт за всё время (allTimeStandings домена): все вечера, без ограничения лучших N. */
export function AllTimeTab({ ctx }: { ctx: RatingContext }) {
  const { history } = ctx;
  const rows = useMemo(
    () => allTimeStandings(history.summaries, { excluded: history.excluded }),
    [history.summaries, history.excluded],
  );
  const places = useMemo(() => standingPlaces(rows), [rows]);
  const firstDate = useMemo(
    () =>
      history.summaries.reduce<string | null>(
        (min, s) => (min === null || Date.parse(s.date) < Date.parse(min) ? s.date : min),
        null,
      ),
    [history.summaries],
  );

  return (
    <div className="rt-panel">
      <List aria-label="Зачёт за всё время">
        {rows.map((row, index) => (
          <ListItem
            key={row.playerId}
            to={paths.player(row.playerId)}
            before={
              <Rank place={places[index] ?? index + 1} player={ctx.playersById.get(row.playerId)} />
            }
            title={<PlayerName ctx={ctx} id={row.playerId} />}
            subtitle={<span className="rt-meta">{standingMeta(row)}</span>}
            after={<Score value={row.total} />}
          />
        ))}
      </List>
      <p className="m-small">
        Все вечера клуба{firstDate ? ` с ${formatDate(firstDate)}` : ''}, без ограничения лучших
        вечеров. {scoringRule(scoringFromSettings(history.settings))}.
      </p>
    </div>
  );
}
