// Действия банкира над журналом: проверка доменной canApply перед отправкой, хаптика,
// отмена событий с подтверждением. Ошибки сервера показывает глобальный обработчик мутаций
// (тост), поэтому здесь их только глотаем, чтобы не задвоить сообщение.
import { canApply } from '@domain/replay.ts';
import type { EventPayload, EventType } from '@domain/types.ts';
import { useCallback, type ReactElement } from 'react';
import { useAddEvent, useVoidEvent, type EveningEventRecord } from '../../shared/api';
import { formatRub, formatTime } from '../../shared/lib';
import { haptic } from '../../shared/telegram';
import { useConfirm, useToast } from '../../shared/ui';
import { describeEvent } from './lib';
import type { EveningModel } from './useEveningModel';

/** Тост «Отменить» висит дольше обычного, но не до закрытия: вылеты идут один за другим. */
const UNDO_TOAST_MS = 8000;

export interface SendOptions {
  /** Тост после записи — прошедшее время без «успешно»: «Ребай записан». */
  success?: string;
  /** Вторая строка тоста. */
  detail?: string;
  /** Кнопка «Отменить» в тосте: обратимое действие не подтверждают, а дают отменить. */
  undo?: boolean;
}

export interface EveningActions {
  /** Отправить событие; запись журнала или null. Перед отправкой — canApply по текущему состоянию. */
  send: (
    type: EventType,
    payload?: EventPayload,
    options?: SendOptions,
  ) => Promise<EveningEventRecord | null>;
  /** Отменить событие с подтверждением, где видно, что именно отменяется. */
  voidWithConfirm: (
    event: EveningEventRecord,
    copy?: { title: string; confirmText: string },
  ) => Promise<boolean>;
  /** Текст, почему событие сейчас нельзя добавить (или null). */
  check: (type: EventType, payload?: EventPayload) => string | null;
  busy: boolean;
  confirm: ReturnType<typeof useConfirm>['confirm'];
  confirmElement: ReactElement;
}

export function useEveningActions(model: EveningModel): EveningActions {
  const { evening, state, nowMs, nameOf } = model;
  const addEvent = useAddEvent(evening.id);
  const voidEvent = useVoidEvent(evening.id);
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();

  const check = useCallback(
    (type: EventType, payload: EventPayload = {}) =>
      canApply(evening.format, state, type, payload, nowMs),
    [evening.format, state, nowMs],
  );

  const undo = useCallback(
    async (eventId: number) => {
      haptic.impact('light');
      try {
        await voidEvent.mutateAsync(eventId);
        toast.show('Запись отменена');
      } catch {
        // тост уже показал глобальный обработчик мутаций
      }
    },
    [voidEvent, toast],
  );

  const send = useCallback(
    async (type: EventType, payload: EventPayload = {}, options: SendOptions = {}) => {
      const problem = check(type, payload);
      if (problem) {
        haptic.notify('error');
        toast.show(problem, { tone: 'caution', detail: 'Запись не отправлена.' });
        return null;
      }
      haptic.impact(type === 'bust' || type === 'finish' ? 'heavy' : 'medium');
      try {
        const record = await addEvent.mutateAsync({ type, payload });
        if (options.success) {
          toast.show(options.success, {
            tone: 'positive',
            detail: options.detail,
            ...(options.undo
              ? {
                  durationMs: UNDO_TOAST_MS,
                  action: { label: 'Отменить', onClick: () => void undo(record.id) },
                }
              : {}),
          });
        }
        return record;
      } catch {
        haptic.notify('error');
        return null; // тост уже показал глобальный обработчик мутаций
      }
    },
    [check, toast, addEvent, undo],
  );

  const voidWithConfirm = useCallback(
    async (event: EveningEventRecord, copy?: { title: string; confirmText: string }) => {
      const line = describeEvent(event, nameOf, formatRub);
      const consequence =
        event.type === 'finish'
          ? ' Вечер вернётся в игру: итоги, голосование и расчёт снова откроются после завершения.'
          : event.type === 'payment'
            ? ' Остаток игрока в расчёте пересчитается.'
            : event.type === 'join' || event.type === 'rebuy' || event.type === 'bust'
              ? ' Места, нокауты и деньги пересчитаются.'
              : ' Таймер и уровень пересчитаются.';
      const ok = await confirm({
        title: copy?.title ?? 'Отменить запись?',
        message: `${line.title}${line.detail ? ` (${line.detail})` : ''}, ${formatTime(event.at)}. Запись останется в ленте зачёркнутой.${consequence}`,
        confirmText: copy?.confirmText ?? 'Отменить запись',
        cancelText: 'Оставить',
        danger: true,
      });
      if (!ok) return false;
      haptic.impact('medium');
      try {
        await voidEvent.mutateAsync(event.id);
        toast.show('Запись отменена');
        return true;
      } catch {
        return false;
      }
    },
    [confirm, nameOf, toast, voidEvent],
  );

  return {
    send,
    voidWithConfirm,
    check,
    busy: addEvent.isPending || voidEvent.isPending,
    confirm,
    confirmElement,
  };
}
