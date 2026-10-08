// Пауза (миграция 022): без срока или перерыв на N минут. Перерыв — пауза с длительностью: табло и
// экраны вечера показывают «продолжаем через 09:59», голос — «Перерыв десять минут» и «Минута до
// конца перерыва»; по истечении часы стоят и экраны зовут продолжать — таймер сам не продолжает,
// «Продолжить игру» на пульте. Пауза без срока — как все паузы до 022 («Пауза.», «стоим 3 мин»).
// Одна шторка на оба вида пульта: «Пауза» на полосе часов («Стол») и «Поставить паузу» («Подробно»).
import { PAUSE_MINUTES_OPTIONS } from '@domain/types.ts';
import { useState } from 'react';
import { NBSP, pluralWithNumber } from '../../shared/lib';
import { Button, Sheet } from '../../shared/ui';
import type { EveningActions } from './useEveningActions';

export interface PauseSheetProps {
  open: boolean;
  onClose: () => void;
  actions: EveningActions;
}

export function PauseSheet({ open, onClose, actions }: PauseSheetProps) {
  // Какая кнопка отправляет: 0 — без срока, иначе минуты.
  const [sending, setSending] = useState<number | null>(null);
  const start = async (minutes: number | null) => {
    setSending(minutes ?? 0);
    const record = await actions.send('timer_pause', minutes === null ? {} : { minutes }, {
      success: minutes === null ? 'Пауза' : `Перерыв ${minutes}${NBSP}мин`,
      undo: true,
    });
    setSending(null);
    if (record) onClose();
  };
  const busy = sending !== null || actions.busy;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Пауза"
      description="Таймер встанет. Перерыв на N минут — табло покажет отсчёт и, когда время выйдет, позовёт продолжать. Сам таймер не пойдёт: игру продолжают с пульта."
      dismissible={sending === null}
    >
      <div className="ev-pause">
        <Button
          variant="primary"
          block
          icon="pause"
          className="ev-pause__open"
          loading={sending === 0}
          disabled={busy || Boolean(actions.check('timer_pause', {}))}
          onClick={() => void start(null)}
        >
          Пауза без срока
        </Button>
        {PAUSE_MINUTES_OPTIONS.map((m) => (
          <Button
            key={m}
            variant="secondary"
            loading={sending === m}
            aria-label={`Перерыв ${pluralWithNumber(m, ['минута', 'минуты', 'минут'])}`}
            disabled={busy || Boolean(actions.check('timer_pause', { minutes: m }))}
            onClick={() => void start(m)}
          >
            {`${m}${NBSP}мин`}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}
