import { seasonStandings, type StandingRow } from '@domain/season.ts';
import type { EveningSummary } from '@domain/summary.ts';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { scoringFromSettings } from '../../shared/api';
import {
  bestNRule,
  cn,
  countedSummary,
  formatDate,
  formatPoints,
  formatSeason,
  paths,
  placeLabel,
  scoringRule,
  standingMeta,
} from '../../shared/lib';
import { ButtonLink, Empty, Icon, List } from '../../shared/ui';
import type { RatingContext } from './context';
import { PlayerName, Rank, Score, SeasonSelect } from './parts';
import { markCountedEvenings, standingPlaces } from './stats';

interface SeasonTabProps {
  ctx: RatingContext;
  seasons: readonly string[];
  season: string;
  onSeason: (season: string) => void;
}

/**
 * Таблица сезона: сумма лучших N вечеров (seasonStandings домена). Строка раскрывается —
 * видно, какие вечера игрока вошли в зачёт, и есть переход в карточку игрока.
 */
export function SeasonTab({ ctx, seasons, season, onSeason }: SeasonTabProps) {
  const { history } = ctx;
  const seasonSummaries = useMemo(
    () => history.summaries.filter((s) => s.seasonKey === season),
    [history.summaries, season],
  );
  const rows = useMemo(
    () => seasonStandings(seasonSummaries, { bestN: history.bestN, excluded: history.excluded }),
    [seasonSummaries, history.bestN, history.excluded],
  );
  const places = useMemo(() => standingPlaces(rows), [rows]);
  const [openId, setOpenId] = useState<string | null>(null);
  const scoring = scoringFromSettings(history.settings);

  return (
    <div className="rt-panel">
      <SeasonSelect
        seasons={seasons}
        current={history.currentSeasonKey}
        value={season}
        onChange={(next) => {
          setOpenId(null);
          onSeason(next);
        }}
      />

      {rows.length === 0 ? (
        <Empty
          icon="calendar"
          title={
            season === history.currentSeasonKey
              ? 'Сезон только начался'
              : `В сезоне «${formatSeason(season)}» вечеров не было`
          }
          description="Таблица заполнится после первого завершённого вечера сезона."
        />
      ) : (
        <List className="rt-rows" aria-label={`Таблица сезона «${formatSeason(season)}»`}>
          {rows.map((row, index) => (
            <SeasonRow
              key={row.playerId}
              ctx={ctx}
              row={row}
              place={places[index] ?? index + 1}
              summaries={seasonSummaries}
              open={openId === row.playerId}
              onToggle={() => setOpenId((id) => (id === row.playerId ? null : row.playerId))}
            />
          ))}
        </List>
      )}

      <p className="m-small">
        {scoringRule(scoring)}. {bestNRule(history.bestN)}. При равенстве выше тот, у кого больше
        побед, потом — нокаутов.
      </p>
    </div>
  );
}

interface SeasonRowProps {
  ctx: RatingContext;
  row: StandingRow;
  place: number;
  summaries: readonly EveningSummary[];
  open: boolean;
  onToggle: () => void;
}

function SeasonRow({ ctx, row, place, summaries, open, onToggle }: SeasonRowProps) {
  const detailId = useId();
  const marks = useMemo(
    () => (open ? markCountedEvenings(summaries, row.playerId, row.counted) : []),
    [open, summaries, row.playerId, row.counted],
  );

  return (
    <li className="rt-row">
      <button
        type="button"
        className="rt-row__btn"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <Rank place={place} player={ctx.playersById.get(row.playerId)} />
        <span className="rt-row__body">
          <PlayerName ctx={ctx} id={row.playerId} />
          <span className="rt-meta">{standingMeta(row)}</span>
        </span>
        <Score value={row.total} />
        <Icon name="chevron-down" size={20} className="rt-row__chevron" />
      </button>

      <div id={detailId} className="rt-detail" hidden={!open}>
        {open && (
          <>
            <p className="m-small">{countedSummary(row.counted.length, row.played)}</p>
            <ul className="rt-evenings" aria-label="Вечера игрока в сезоне">
              {marks.map((mark) => (
                <li key={mark.eveningId}>
                  <Link
                    to={paths.evening(mark.eveningId)}
                    className={cn('rt-ev', mark.counted ? 'rt-ev--in' : 'rt-ev--out')}
                  >
                    <span className="rt-ev__date">{formatDate(mark.date)}</span>
                    <span className="rt-ev__points m-mono">{formatPoints(mark.points)}</span>
                    <span className="rt-ev__place">{placeLabel(mark.place, mark.entrants)}</span>
                    <span className="rt-ev__mark">
                      {mark.counted ? (
                        <>
                          <Icon name="check" size={14} />в зачёте
                        </>
                      ) : (
                        'вне зачёта'
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <ButtonLink
              to={paths.player(row.playerId)}
              size="sm"
              variant="ghost"
              iconAfter="arrow-right"
              className="rt-detail__link"
            >
              Открыть карточку игрока
            </ButtonLink>
          </>
        )}
      </div>
    </li>
  );
}
