import { lastEveningMoves } from '@domain/placeMoves.ts';
import { allTimeStandings, sameRank } from '@domain/season.ts';
import type { EveningSummary } from '@domain/summary.ts';
import { useMemo } from 'react';
import { scoringFromSettings } from '../../shared/api';
import { formatDate, paths, scoringRuleOf, standingMeta } from '../../shared/lib';
import { List, ListItem } from '../../shared/ui';
import type { RatingContext } from './context';
import { MovesNote, PlayerName, Rank, Score } from './parts';
import { meRowClass, moveOf, standingPlaces } from './stats';

/** Зачёт за всё время (allTimeStandings домена): все вечера, без ограничения лучших N. */
export function AllTimeTab({ ctx }: { ctx: RatingContext }) {
  const { history } = ctx;
  const rows = useMemo(
    () => allTimeStandings(history.summaries, { excluded: history.excluded }),
    [history.summaries, history.excluded],
  );
  const places = useMemo(() => standingPlaces(rows), [rows]);
  const moves = useMemo(
    () =>
      lastEveningMoves(
        history.summaries,
        (s: readonly EveningSummary[]) => allTimeStandings(s, { excluded: history.excluded }),
        sameRank,
      ),
    [history.summaries, history.excluded],
  );
  const firstDate = useMemo(
    () =>
      history.summaries.reduce<string | null>(
        (min, s) => (min === null || Date.parse(s.date) < Date.parse(min) ? s.date : min),
        null,
      ),
    [history.summaries],
  );
  // У каждого вечера свои правила очков (снимок при завершении) — подпись по ним, а не по настройкам.
  const rule = useMemo(() => {
    const current = scoringFromSettings(history.settings);
    return scoringRuleOf(
      history.summaries.map((s) => s.scoring ?? current),
      current,
    );
  }, [history.summaries, history.settings]);

  return (
    <div className="rt-panel">
      <List aria-label="Зачёт за всё время">
        {rows.map((row, index) => (
          <ListItem
            key={row.playerId}
            to={paths.player(row.playerId)}
            className={meRowClass(ctx.meId, row.playerId)}
            before={
              <Rank
                place={places[index] ?? index + 1}
                player={ctx.playersById.get(row.playerId)}
                move={moveOf(moves, row.playerId)}
              />
            }
            title={<PlayerName ctx={ctx} id={row.playerId} />}
            subtitle={<span className="rt-meta">{standingMeta(row)}</span>}
            after={<Score value={row.total} />}
          />
        ))}
      </List>
      <MovesNote moves={moves} summaryById={history.summaryById} />
      <p className="m-small">
        Все вечера клуба{firstDate ? ` с ${formatDate(firstDate)}` : ''}, без ограничения лучших
        вечеров. {rule}.
      </p>
    </div>
  );
}
