// Моё место в текущем сезоне: таблица — доменная seasonStandings (лучшие N вечеров, без гостей),
// место с дележом — seasonPosition (sameRank домена). Вся карточка ведёт в рейтинг.
import { seasonStandings } from '@domain/season.ts';
import { useMemo } from 'react';
import type { ClubHistory, Player } from '../../shared/api';
import { formatPoints, formatSeason, paths, pluralWithNumber } from '../../shared/lib';
import { Card, Icon, Section, Stat, Stats } from '../../shared/ui';
import { seasonPosition } from './lib';

export interface SeasonSectionProps {
  history: ClubHistory;
  me: Player;
}

export function SeasonSection({ history, me }: SeasonSectionProps) {
  const rows = useMemo(
    () =>
      seasonStandings(history.summaries, {
        bestN: history.bestN,
        excluded: history.excluded,
        seasonKey: history.currentSeasonKey,
      }),
    [history],
  );
  const position = seasonPosition(rows, me.id);

  return (
    <Section title="Сезон" aside={formatSeason(history.currentSeasonKey)}>
      <Card to={paths.rating} variant="raised">
        {position ? (
          <Stats className="home-stats">
            <Stat label="Место" value={String(position.place)} unit={`из ${position.of}`} />
            <Stat
              label="Очки"
              value={formatPoints(position.row.total)}
              note={`${pluralWithNumber(position.row.played, ['вечер', 'вечера', 'вечеров'])}, в зачёт — лучшие ${history.bestN}`}
            />
          </Stats>
        ) : (
          <div className="home-season-empty">
            <p className="m-h3">В этом сезоне вы ещё не играли</p>
            <p className="m-small">
              {rows.length > 0
                ? `В таблице ${pluralWithNumber(rows.length, ['игрок', 'игрока', 'игроков'])}. Место появится после первого вечера.`
                : 'Таблица сезона появится после первого вечера.'}
            </p>
          </div>
        )}
        <span className="home-card-link">
          Рейтинг сезона
          <Icon name="chevron-right" size={16} />
        </span>
      </Card>
    </Section>
  );
}
