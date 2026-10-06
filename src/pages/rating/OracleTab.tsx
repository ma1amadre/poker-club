import { PREDICTION_POINTS } from '@domain/predictions.ts';
import { oracleStandings } from '@domain/season.ts';
import { useMemo } from 'react';
import { formatPointsWithUnit, formatSeason, NBSP, paths, plural } from '../../shared/lib';
import { Empty, List, ListItem } from '../../shared/ui';
import type { RatingContext } from './context';
import { PlayerName, Rank, Score, SeasonSelect } from './parts';
import { oraclePlaces, seasonPredictionScores } from './stats';

interface OracleTabProps {
  ctx: RatingContext;
  seasons: readonly string[];
  season: string;
  onSeason: (season: string) => void;
}

function predictionsMeta(row: { predictions: number; winnerHits: number; firstOutHits: number }) {
  const count = `${row.predictions}${NBSP}${plural(row.predictions, ['прогноз', 'прогноза', 'прогнозов'])}`;
  return `${count} · угадано победителей: ${row.winnerHits}, первых вылетов: ${row.firstOutHits}`;
}

/** «Оракул сезона» (oracleStandings домена): очки прогнозов, участвуют и те, кто не играл. */
export function OracleTab({ ctx, seasons, season, onSeason }: OracleTabProps) {
  const { history } = ctx;
  const rows = useMemo(() => {
    const scores = seasonPredictionScores(
      history.predictionScores,
      (id) => history.summaryById.get(id)?.seasonKey,
      season,
      history.excluded,
    );
    return oracleStandings(scores);
  }, [history.predictionScores, history.summaryById, history.excluded, season]);
  const places = useMemo(() => oraclePlaces(rows), [rows]);

  return (
    <div className="rt-panel">
      <SeasonSelect
        seasons={seasons}
        current={history.currentSeasonKey}
        value={season}
        onChange={onSeason}
      />

      {rows.length === 0 ? (
        <Empty
          icon="eye"
          title="Прогнозов в этом сезоне ещё не было"
          description="Прогноз на победителя и первый вылет делают на главной, в карточке ближайшего вечера, до старта таймера."
        />
      ) : (
        <List aria-label={`Оракул сезона «${formatSeason(season)}»`}>
          {rows.map((row, index) => (
            <ListItem
              key={row.playerId}
              to={paths.player(row.playerId)}
              before={
                <Rank
                  place={places[index] ?? index + 1}
                  player={ctx.playersById.get(row.playerId)}
                />
              }
              title={<PlayerName ctx={ctx} id={row.playerId} />}
              subtitle={<span className="rt-meta">{predictionsMeta(row)}</span>}
              after={<Score value={row.total} />}
            />
          ))}
        </List>
      )}

      <p className="m-small">
        Угаданный победитель — {formatPointsWithUnit(PREDICTION_POINTS.winner)}, первый вылет —{' '}
        {formatPointsWithUnit(PREDICTION_POINTS.firstOut)}. Прогнозы закрываются при старте таймера,
        делать их могут и те, кто не играет.
      </p>
    </div>
  );
}
