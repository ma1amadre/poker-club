// Общие куски вкладок рейтинга: место + аватар (со стрелкой сдвига после последнего вечера), имя со
// значком чемпиона и пометкой «ты», очки, выбор сезона, подпись к стрелкам.
import { placeDelta, type PlaceMove, type TableMoves } from '@domain/placeMoves.ts';
import type { EveningSummary } from '@domain/summary.ts';
import type { PlayerId } from '@domain/types.ts';
import type { Player } from '../../shared/api';
import {
  cn,
  formatDate,
  formatPoints,
  formatSeason,
  formatSeasonGenitive,
  plural,
  pointsWord,
  seasonMonths,
} from '../../shared/lib';
import { Avatar, Icon, Select } from '../../shared/ui';
import { playerName, type RatingContext } from './context';

/**
 * Место (табличные цифры, с подписью для скринридера) и аватар — начало строки таблицы. move — сдвиг
 * строки после последнего вечера (moveOf): если у таблицы сдвиги есть, под местом у каждой строки —
 * место под стрелку (пустое, если строка не сдвинулась), чтобы числа мест стояли ровно; undefined —
 * у таблицы сдвигов нет.
 */
export function Rank({
  place,
  player,
  move,
}: {
  place: number;
  player: Player | undefined;
  move?: PlaceMove | null;
}) {
  return (
    <span className="rt-rank">
      <span className="rt-place-col">
        <span className={cn('rt-place', 'm-mono', place <= 3 && 'rt-place--top')}>
          <span className="sr-only">Место {place}</span>
          {/* Номер места двумя знаками — «01», как строки таблиц «Терминала». */}
          <span aria-hidden="true">{String(place).padStart(2, '0')}</span>
        </span>
        {move !== undefined && <MoveMark move={move} />}
      </span>
      <Avatar name={player?.display_name ?? '?'} photoUrl={player?.photo_url} size="md" />
    </span>
  );
}

/**
 * Стрелка сдвига места после последнего вечера: шеврон и число мест; смысл — в подписи для
 * скринридера, а не в цвете. Не сдвинулся или новичок таблицы — пустое место той же высоты.
 */
export function MoveMark({ move }: { move: PlaceMove | null }) {
  const delta = move ? placeDelta(move) : null;
  if (delta === null || delta === 0) return <span className="rt-move" aria-hidden="true" />;
  const up = delta > 0;
  const n = Math.abs(delta);
  return (
    <span className={cn('rt-move', up ? 'rt-move--up' : 'rt-move--down')}>
      <Icon name={up ? 'chevron-up' : 'chevron-down'} size={12} />
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">
        , на {n} {plural(n, ['место', 'места', 'мест'])} {up ? 'выше' : 'ниже'}, чем до последнего
        вечера
      </span>
    </span>
  );
}

/** Подпись под таблицей со стрелками: после какого вечера считан сдвиг. */
export function MovesNote({
  moves,
  summaryById,
}: {
  moves: TableMoves | null;
  summaryById: ReadonlyMap<string, Pick<EveningSummary, 'date'>>;
}) {
  if (!moves || !Object.values(moves.moves).some((m) => (placeDelta(m) ?? 0) !== 0)) return null;
  const date = summaryById.get(moves.eveningId)?.date;
  return (
    <p className="m-small">
      Стрелки у места — как оно сдвинулось после последнего вечера
      {date ? ` (${formatDate(date)})` : ''}.
    </p>
  );
}

/** Имя игрока; у действующего чемпиона — корона с подписью (цвет не носит смысл); своя строка — «ты». */
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
      {ctx.meId === id && <span className="rt-name__me ui-me-tag">ты</span>}
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
