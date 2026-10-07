// Табло во время олл-ина: раздача (ShowdownView, крупно) вместо таймера и стола. Часы уровня не
// пропадают — короткой строкой в шапке раздачи: уровень, время, блайнды. Табло возвращается к
// обычному экрану по «Закрыть раздачу» банкира или само (visibleShowdown домена).
import type { EveningState, ShowdownState, TournamentFormat } from '@domain/types.ts';
import { formatBlinds } from '../../shared/lib';
import { ShowdownView } from '../../shared/ui';
import { clockView, levelLabel, type NameOf } from '../evening/lib';
import './showdown-board.css';

export function ShowdownBoard({
  showdown,
  state,
  format,
  nameOf,
}: {
  showdown: ShowdownState;
  state: EveningState;
  format: TournamentFormat;
  nameOf: NameOf;
}) {
  const clock = clockView(state);
  const paused = state.timer.status === 'paused';
  const started = state.timer.status !== 'not_started';
  return (
    <ShowdownView
      variant="board"
      showdown={showdown}
      nameOf={nameOf}
      aside={
        started ? (
          <p className="bd-sd-clock">
            <span className="m-eyebrow">{levelLabel(format, state)}</span>
            <span
              className={
                paused ? 'bd-sd-clock__time bd-sd-clock__time--paused' : 'bd-sd-clock__time'
              }
            >
              {paused ? `пауза · ${clock.text}` : clock.text}
            </span>
            <span className="bd-sd-clock__blinds">{formatBlinds(state.currentLevel)}</span>
          </p>
        ) : undefined
      }
    />
  );
}
