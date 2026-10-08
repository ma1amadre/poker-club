// «Гонка сезона»: моё место в текущем сезоне и сколько очков до соседей выше и ниже, до лидера, сколько
// вечеров в зачёте из «лучших N» и сколько игровых дней по расписанию до конца квартала. Таблица —
// доменная seasonStandings (лучшие N вечеров, без гостей), гонка — seasonRace домена (места с дележом,
// как в рейтинге), игровые дни — gameDaysLeft (пока вечер сезона объявлен или идёт, «игр больше нет» не
// пишем — seasonEveningPending). Вся карточка ведёт в рейтинг.
import { bestNForSeason, seasonChampions, seasonStandings } from '@domain/season.ts';
import { gameDaysLeft } from '@domain/seasonCalendar.ts';
import { seasonRace } from '@domain/seasonRace.ts';
import { useMemo } from 'react';
import type { ClubHistory, Player, Settings } from '../../shared/api';
import {
  cn,
  formatPoints,
  formatSeason,
  paths,
  pluralWithNumber,
  raceCountedNote,
  raceFullHint,
  raceLeaderLine,
  raceLines,
  SEASON_COUNTDOWN_DAYS,
  type RaceLine,
  seasonDaysLeftText,
} from '../../shared/lib';
import { Card, Icon, Section, Stat, Stats, type IconName } from '../../shared/ui';

/** Значки строк гонки: первое место — корона, делёж — люди, кто выше — рост, кто ниже — щит отрыва. */
const RACE_ICON: Record<RaceLine['kind'], IconName> = {
  top: 'crown',
  tie: 'users',
  above: 'trending-up',
  leader: 'trophy',
  below: 'shield',
};

export interface SeasonSectionProps {
  history: ClubHistory;
  me: Player;
  /** Расписание клуба — для счёта игровых дней до конца сезона; нет — без него. */
  settings: Pick<Settings, 'game_weekday' | 'game_time'> | null;
  /** В сезоне ещё есть объявленный или идущий вечер (seasonEveningPending). */
  eveningPending: boolean;
  nowMs: number;
}

export function SeasonSection({
  history,
  me,
  settings,
  eveningPending,
  nowMs,
}: SeasonSectionProps) {
  const key = history.currentSeasonKey;
  const rows = useMemo(
    () =>
      seasonStandings(history.summaries, {
        bestN: history.bestN,
        excluded: history.excluded,
        seasonKey: key,
        bestNBySeason: history.bestNBySeason,
      }),
    [history, key],
  );
  const bestN = bestNForSeason(key, history.bestN, history.bestNBySeason);
  const race = useMemo(() => seasonRace(rows, me.id, bestN), [rows, me.id, bestN]);
  const nameOf = (id: string) =>
    history.players.find((p) => p.id === id)?.display_name ?? 'Игрок не найден';

  const daysLeft = settings
    ? gameDaysLeft({ weekday: settings.game_weekday, time: settings.game_time }, nowMs)
    : null;
  const daysLeftText =
    daysLeft !== null && settings
      ? seasonDaysLeftText(daysLeft, settings.game_weekday, key, eveningPending)
      : null;
  // Кого нет в таблице (без игр в сезоне) — видит хотя бы лидера: те же, кто делит первую строку.
  const leaders = seasonChampions(rows);

  const facts: { icon: IconName; text: string }[] = [];
  if (race) {
    for (const line of raceLines(race, nameOf))
      facts.push({ icon: RACE_ICON[line.kind], text: line.text });
    const full = raceFullHint(race);
    if (full) facts.push({ icon: 'layers', text: full });
  } else if (leaders.length > 0) {
    facts.push({ icon: 'flag', text: raceLeaderLine(leaders, rows[0]?.total ?? 0, nameOf) });
  }

  return (
    <Section title="Гонка сезона" aside={formatSeason(key)}>
      <Card to={paths.rating} variant="raised" className="home-race">
        {race ? (
          <Stats className="home-stats">
            <Stat label="Место" value={String(race.place)} unit={`из ${race.of}`} />
            <Stat label="Очки" value={formatPoints(race.total)} note={raceCountedNote(race)} />
          </Stats>
        ) : (
          <div className="home-season-empty">
            <p className="m-h3">В этом сезоне у тебя ещё нет игр</p>
            <p className="m-small">
              {rows.length > 0
                ? `В таблице ${pluralWithNumber(rows.length, ['игрок', 'игрока', 'игроков'])}. Место появится после первого вечера.`
                : 'Таблица сезона появится после первого вечера.'}
            </p>
          </div>
        )}
        {(facts.length > 0 || daysLeftText !== null) && (
          <ul className="home-facts" aria-label="Гонка сезона">
            {facts.map((fact) => (
              <li key={fact.text}>
                <Icon name={fact.icon} size={16} />
                {fact.text}
              </li>
            ))}
            {daysLeft !== null && daysLeftText !== null && (
              <li className={cn(daysLeft <= SEASON_COUNTDOWN_DAYS && 'home-race__final')}>
                <Icon name="calendar" size={16} />
                {daysLeftText}
              </li>
            )}
          </ul>
        )}
        <span className="home-card-link">
          Рейтинг сезона
          <Icon name="chevron-right" size={16} />
        </span>
      </Card>
    </Section>
  );
}
