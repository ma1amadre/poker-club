// Шторка «Часы и уровень» режима стола: открывается касанием полосы часов. Здесь то, что нужно
// реже вылетов: время уровня ±1 мин (миграция 022) и уровень вручную. Пауза — кнопкой на полосе,
// «Раздача сыграна» (уровни по раздачам) — под сеткой мест. Записи — те же, что на пульте «Подробно».
import { formatBlinds, NBSP } from '../../shared/lib';
import { IconButton, Progress, Sheet } from '../../shared/ui';
import {
  clockView,
  levelLabel,
  rebuyText,
  rebuyWindow,
  timeAdjustable,
  triggerProgress,
} from './lib';
import { stripStatus } from './table';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';
import type { Pult } from './usePult';

export interface ClockSheetProps {
  open: boolean;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  pult: Pult;
}

export function ClockSheet({ open, onClose, model, actions, pult }: ClockSheetProps) {
  const { state, evening, nowMs } = model;
  const format = evening.format;
  const clock = clockView(state);
  const status = stripStatus(state, nowMs);
  const progress = triggerProgress(state);
  const blinds = formatBlinds(state.currentLevel);
  const next = state.nextLevel ? `дальше ${formatBlinds(state.nextLevel)}` : 'последний уровень';
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={levelLabel(format, state)}
      description={`Блайнды ${blinds}, ${next}.`}
    >
      <div className="ev-sheet-body">
        <div className="ev-clocksheet__time">
          <p
            className={
              status.word
                ? 'm-figure ev-clock__time ev-clock__time--paused'
                : 'm-figure ev-clock__time'
            }
            role="timer"
            aria-label={clock.aria}
          >
            {clock.text}
          </p>
          {status.line && (
            <p className={status.mode === 'due' ? 'm-body ev-strip__due' : 'm-body'}>
              {`${status.word ?? ''}${NBSP}· ${status.line}`}
            </p>
          )}
          {clock.note && <p className="m-small">{clock.note}</p>}
          {progress && (
            <Progress
              label={progress.label}
              value={Math.min(progress.done, progress.total)}
              max={progress.total}
              showValue
              valueText={`${progress.done} из ${progress.total}`}
            />
          )}
          <p className="m-small">{rebuyText(rebuyWindow(format, state))}</p>
        </div>

        {timeAdjustable(state) && (
          <div className="ev-pult__levels">
            <IconButton
              variant="secondary"
              icon="minus"
              label="Убавить минуту уровня"
              disabled={actions.busy || Boolean(actions.check('time_adjust', { seconds: -60 }))}
              onClick={() =>
                void actions.send(
                  'time_adjust',
                  { seconds: -60 },
                  { success: 'Минута убавлена', undo: true },
                )
              }
            />
            <span className="m-small ev-pult__levels-label">{`Время уровня ±1${NBSP}мин`}</span>
            <IconButton
              variant="secondary"
              icon="plus"
              label="Прибавить минуту уровня"
              disabled={actions.busy || Boolean(actions.check('time_adjust', { seconds: 60 }))}
              onClick={() =>
                void actions.send(
                  'time_adjust',
                  { seconds: 60 },
                  { success: 'Минута прибавлена', undo: true },
                )
              }
            />
          </div>
        )}

        <div className="ev-pult__levels">
          <IconButton
            variant="secondary"
            icon="skip-back"
            label="Уровень назад"
            disabled={actions.busy || Boolean(actions.check('level_prev'))}
            onClick={() =>
              void actions.send('level_prev', {}, { success: 'Уровень назад', undo: true })
            }
          />
          <span className="m-small ev-pult__levels-label">Уровень вручную</span>
          <IconButton
            variant="secondary"
            icon="skip-forward"
            label="Уровень вперёд"
            disabled={actions.busy || Boolean(actions.check('level_next'))}
            onClick={() => {
              // Переход может переспросить (край уровня, закрытие ребаев) — окно поверх шторки
              // «Материя» не допускает: шторка закрывается первой.
              onClose();
              void pult.levelNext();
            }}
          />
        </div>
      </div>
    </Sheet>
  );
}
