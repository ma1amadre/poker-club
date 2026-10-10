import { Link } from 'react-router-dom';
import {
  cn,
  formatDate,
  formatPointsWithUnit,
  formatShortDate,
  gameSuffix,
  paths,
  placeLabel,
} from '../../shared/lib';
import { Icon, Section } from '../../shared/ui';
import type { PlayerEvening } from './stats';

/**
 * Форма — последние вечера игрока (recentForm), свежий справа; каждая ячейка ведёт на вечер. gameNos —
 * номера игр (gameNosById): у второй игры дня в подписи для скринридера «· игра 2».
 */
export function FormStrip({
  evenings,
  gameNos,
}: {
  evenings: readonly PlayerEvening[];
  gameNos?: ReadonlyMap<string, number>;
}) {
  return (
    <Section title="Последние вечера" footer="Место и число участников, свежий вечер — справа.">
      <ol className="pl-form" aria-label="Последние вечера игрока">
        {evenings.map((e) => {
          const win = e.place === 1;
          return (
            <li key={e.eveningId} className="pl-form__item">
              <Link
                to={paths.evening(e.eveningId)}
                className={cn('pl-form__cell', win && 'pl-form__cell--win')}
                aria-label={`${formatDate(e.date)}${gameSuffix(gameNos?.get(e.eveningId))}: ${placeLabel(e.place, e.entrants)}, ${formatPointsWithUnit(e.points)}${win ? ', победа' : ''}`}
              >
                <span className="pl-form__place m-mono">
                  {win && <Icon name="trophy" size={14} />}
                  {e.place ?? '—'}
                </span>
                <span className="pl-form__of">из {e.entrants}</span>
                <span className="pl-form__date">{formatShortDate(e.date)}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
