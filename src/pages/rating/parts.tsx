// Общие куски вкладок рейтинга: место + аватар, имя со значком чемпиона, очки, выбор сезона.
import type { PlayerId } from '@domain/types.ts';
import type { Player } from '../../shared/api';
import {
  cn,
  formatPoints,
  formatSeason,
  formatSeasonGenitive,
  pointsWord,
  seasonMonths,
} from '../../shared/lib';
import { Avatar, Icon, Select } from '../../shared/ui';
import { playerName, type RatingContext } from './context';

/** Место (табличные цифры, с подписью для скринридера) и аватар — начало строки таблицы. */
export function Rank({ place, player }: { place: number; player: Player | undefined }) {
  return (
    <span className="rt-rank">
      <span className={cn('rt-place', 'm-mono', place <= 3 && 'rt-place--top')}>
        <span className="sr-only">Место </span>
        {place}
      </span>
      <Avatar name={player?.display_name ?? '?'} photoUrl={player?.photo_url} size="md" />
    </span>
  );
}

/** Имя игрока; у действующего чемпиона — корона с подписью (цвет не носит смысл). */
export function PlayerName({ ctx, id }: { ctx: RatingContext; id: PlayerId }) {
  const champion = ctx.champions.has(id) && ctx.championSeason;
  return (
    <span className="rt-name">
      <span className="rt-name__text">{playerName(ctx, id)}</span>
      {champion && (
        <Icon
          name="crown"
          size={16}
          className="rt-name__crown"
          label={`Чемпион ${formatSeasonGenitive(champion)}`}
        />
      )}
    </span>
  );
}

/** Очки справа в строке: число табличными цифрами и слово под ним. */
export function Score({ value, word }: { value: number; word?: string }) {
  return (
    <span className="rt-score">
      <span className="rt-score__num m-mono">{formatPoints(value)}</span>
      <span className="rt-score__unit">{word ?? pointsWord(value)}</span>
    </span>
  );
}

/** Выбор сезона — нативный Select «Материи»; текущий подписан. */
export function SeasonSelect({
  seasons,
  current,
  value,
  onChange,
}: {
  seasons: readonly string[];
  current: string;
  value: string;
  onChange: (season: string) => void;
}) {
  return (
    <Select
      label="Сезон"
      hint={seasonMonths(value) || undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={seasons.map((key) => ({
        value: key,
        label: key === current ? `${formatSeason(key)} — текущий` : formatSeason(key),
      }))}
    />
  );
}
