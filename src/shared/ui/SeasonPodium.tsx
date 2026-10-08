import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { Avatar } from './Avatar';
import './season.css';

/** Игрок на ступени: имя, фото, ссылка (нет — без ссылки: подиум внутри карточки-ссылки). */
export interface PodiumPerson {
  id: string;
  name: string;
  photoUrl?: string | null;
  to?: string;
  /** Это ты — «(ты)» после имени. */
  me?: boolean;
}

/** Ступень подиума: место 1–3, кто её делит, значение («42,5 очка»). */
export interface PodiumStepView {
  place: number;
  people: readonly PodiumPerson[];
  value: string;
}

export interface SeasonPodiumProps {
  steps: readonly PodiumStepView[];
  /** Подпись списка для скринридера: «Подиум сезона 4-й квартал 2026». */
  label: string;
  /** Плотнее — для главной и зала славы. */
  compact?: boolean;
  className?: string;
}

/**
 * Подиум сезона (итоги сезона, главная, зал славы): ступени 2 — 1 — 3 слева направо, первая выше.
 * В разметке — по порядку мест (скринридер читает 1, 2, 3), на экране колонку задаёт место. Делёж —
 * несколько аватаров и имён на одной ступени; места без игроков (делёж второго — третьего нет) пустые.
 * Цвет не единственный носитель: номер места на ступени всегда есть.
 */
export function SeasonPodium({ steps, label, compact, className }: SeasonPodiumProps) {
  return (
    <ol className={cn('ui-podium', compact && 'ui-podium--compact', className)} aria-label={label}>
      {steps
        .filter((s) => s.place >= 1 && s.place <= 3 && s.people.length > 0)
        .map((step) => (
          <li key={step.place} className={`ui-podium__step ui-podium__step--${step.place}`}>
            <span className="ui-podium__avatars" aria-hidden="true">
              {step.people.slice(0, 3).map((p) => (
                <Avatar
                  key={p.id}
                  name={p.name}
                  photoUrl={p.photoUrl}
                  size={compact ? 'md' : step.place === 1 ? 'xl' : 'lg'}
                />
              ))}
            </span>
            <span className="ui-podium__names">
              {step.people.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && (i === step.people.length - 1 ? ' и ' : ', ')}
                  {p.to ? (
                    <Link to={p.to} className="ui-podium__name">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="ui-podium__name">{p.name}</span>
                  )}
                  {p.me && <span className="ui-podium__me"> (ты)</span>}
                </span>
              ))}
            </span>
            <span className="ui-podium__value">{step.value}</span>
            <span className="ui-podium__block">
              <span className="sr-only">Место </span>
              {step.place}
            </span>
          </li>
        ))}
    </ol>
  );
}
