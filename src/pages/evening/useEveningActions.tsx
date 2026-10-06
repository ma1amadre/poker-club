// Действия банкира над журналом: проверка доменной canApply перед отправкой, хаптика,
// отмена событий с подтверждением. Ошибки сервера показывает глобальный обработчик мутаций
// (тост), поэтому здесь их только глотаем, чтобы не задвоить сообщение (и хаптику: тост с тоном
// сам даёт отклик, см. Toast.tsx).
import { canApply, replayLog } from '@domain/replay.ts';
import type { EventPayload, EventType } from '@domain/types.ts';
import { useCallback, useLayoutEffect, useRef, type ReactElement } from 'react';
import { newClientId, useAddEvent, useVoidEvent, type EveningEventRecord } from '../../shared/api';
import { formatRub, formatTime, serverNow } from '../../shared/lib';
import { haptic } from '../../shared/telegram';
import { useConfirm, useToast } from '../../shared/ui';
import { describeEvent } from './lib';
import type { EveningModel } from './useEveningModel';

/** Тост «Отменить» висит дольше обычного, но не до закрытия: вылеты идут один за другим. */
const UNDO_TOAST_MS = 8000;
/**
 * Сколько помнить ключ повтора неудавшейся записи. Нажал ту же кнопку снова в этом окне — это
 * повтор того же намерения: если первая запись на самом деле прошла (ответ потерялся), сервер
 * вернёт её, а не запишет второй платёж.
 */
const RETRY_KEY_MS = 2 * 60_000;

export interface SendOptions {
  /** Тост после записи — прошедшее время без «успешно»: «Ребай записан». */
  success?: string;
  /** Вторая строка тоста. */
  detail?: string;
  /** Кнопка «Отменить» в тосте: обратимое действие не подтверждают, а дают отменить. */
  undo?: boolean;
}

export interface VoidCopy {
  title?: string;
  confirmText?: string;
  /** Текст подтверждения вместо стандартного «запись останется в ленте…». */
  message?: string;
  /** Тост после отмены вместо «Запись отменена». */
  successText?: string;
}

export interface EveningActions {
  /** Отправить событие; запись журнала или null. Перед отправкой — canApply по текущему состоянию. */
  send: (
    type: EventType,
    payload?: EventPayload,
    options?: SendOptions,
  ) => Promise<EveningEventRecord | null>;
  /** Отменить событие с подтверждением, где видно, что именно отменяется. */
  voidWithConfirm: (event: EveningEventRecord, copy?: VoidCopy) => Promise<boolean>;
  /** Текст, почему событие сейчас нельзя добавить (или null). */
  check: (type: EventType, payload?: EventPayload) => string | null;
  busy: boolean;
  confirm: ReturnType<typeof useConfirm>['confirm'];
  confirmElement: ReactElement;
}

/** Что изменится, если отменить событие: какие отвергнутые записи вступят в силу, кончится ли вечер. */
function voidEffect(model: EveningModel, eventId: number) {
  const events = model.events.map((e) => (e.id === eventId ? { ...e, voided: true } : e));
  const after = replayLog(model.evening.format, events, serverNow());
  const appliedAfter = new Set(after.applied.map((e) => e.id));
  const revived = model.events.filter((e) => model.errorsById.has(e.id) && appliedAfter.has(e.id));
  return { revived, stillFinished: after.state.finished };
}

const REJECTED_TITLE: Partial<Record<EventType, string>> = {
  join: 'Вход не принят',
  rebuy: 'Ребай не принят',
  bust: 'Вылет не принят',
  payment: 'Платёж не принят',
  level_next: 'Переход уровня не принят',
  level_prev: 'Переход уровня не принят',
  hand: 'Раздача не принята',
  finish: 'Завершение не принято',
};

export function useEveningActions(model: EveningModel): EveningActions {
  const { evening, state, nowMs } = model;
  const addEvent = useAddEvent(evening.id);
  const voidEvent = useVoidEvent(evening.id);
  const toast = useToast();
  const { confirm, confirmElement } = useConfirm();
  // Тост «Отменить» живёт дольше рендера, в котором создан: читаем свежую модель через ref.
  const modelRef = useRef(model);
  useLayoutEffect(() => {
    modelRef.current = model;
  });
  // Ключи повтора неудавшихся записей: «тип + payload» → ключ и момент неудачи.
  const retryKeys = useRef(new Map<string, { id: string; failedAt: number }>());

  const check = useCallback(
    (type: EventType, payload: EventPayload = {}) =>
      canApply(evening.format, state, type, payload, nowMs),
    [evening.format, state, nowMs],
  );

  const doVoid = useCallback(
    async (eventId: number, successText = 'Запись отменена') => {
      haptic.impact('medium');
      try {
        await voidEvent.mutateAsync(eventId);
        toast.show(successText);
        return true;
      } catch {
        return false; // тост уже показал глобальный обработчик мутаций
      }
    },
    [voidEvent, toast],
  );

  const voidWithConfirm = useCallback(
    async (event: EveningEventRecord, copy: VoidCopy = {}) => {
      const current = modelRef.current;
      const line = describeEvent(event, current.nameOf, formatRub);
      const { revived, stillFinished } = voidEffect(current, event.id);
      const consequence =
        event.type === 'finish'
          ? stillFinished
            ? ' Вечер останется завершённым: в журнале есть ещё одна запись «Игра окончена».'
            : ' Вечер вернётся в игру: итоги, голосование и расчёт снова откроются после завершения, таймер будет на паузе.'
          : event.type === 'payment'
            ? ' Остаток игрока в расчёте пересчитается.'
            : event.type === 'join' || event.type === 'rebuy' || event.type === 'bust'
              ? ' Места, нокауты и деньги пересчитаются.'
              : ' Таймер и уровень пересчитаются.';
      const revivedText =
        revived.length > 0
          ? ` Вместо неё вступит в силу ${revived.length > 1 ? 'записи' : 'запись'}, которую журнал сейчас не принимает: ${revived
              .map((e) => {
                const l = describeEvent(e, current.nameOf, formatRub);
                return `«${l.title}${l.detail ? `, ${l.detail}` : ''}», ${formatTime(e.at)}`;
              })
              .join('; ')}. Если она тоже лишняя — отмените и её.`
          : '';
      const ok = await confirm({
        title: copy.title ?? 'Отменить запись?',
        message:
          (copy.message ??
            `${line.title}${line.detail ? ` (${line.detail})` : ''}, ${formatTime(event.at)}. Запись останется в ленте зачёркнутой.${consequence}`) +
          revivedText,
        confirmText: copy.confirmText ?? 'Отменить запись',
        cancelText: 'Оставить',
        danger: true,
      });
      if (!ok) return false;
      return doVoid(event.id, copy.successText);
    },
    [confirm, doVoid],
  );

  /** «Отменить» из тоста: обратимое действие — без подтверждения, если отмена ничего не воскрешает. */
  const undo = useCallback(
    async (eventId: number) => {
      const current = modelRef.current;
      const event = current.events.find((e) => e.id === eventId);
      if (event && voidEffect(current, eventId).revived.length > 0) {
        await voidWithConfirm(event);
        return;
      }
      haptic.impact('light');
      try {
        await voidEvent.mutateAsync(eventId);
        toast.show('Запись отменена');
      } catch {
        // тост уже показал глобальный обработчик мутаций
      }
    },
    [voidEvent, toast, voidWithConfirm],
  );

  const send = useCallback(
    async (type: EventType, payload: EventPayload = {}, options: SendOptions = {}) => {
      const problem = check(type, payload);
      if (problem) {
        // Хаптику (warning) даёт сам тост тона caution.
        toast.show(problem, { tone: 'caution', detail: 'Запись не отправлена.' });
        return null;
      }
      haptic.impact(type === 'bust' || type === 'finish' ? 'heavy' : 'medium');

      const key = `${type}:${JSON.stringify(payload)}`;
      const pending = retryKeys.current.get(key);
      const clientId =
        pending && Date.now() - pending.failedAt < RETRY_KEY_MS ? pending.id : newClientId();

      let record: EveningEventRecord;
      try {
        record = await addEvent.mutateAsync({ type, payload, clientId });
        retryKeys.current.delete(key);
      } catch {
        retryKeys.current.set(key, { id: clientId, failedAt: Date.now() });
        return null; // тост (и хаптику) уже дал глобальный обработчик мутаций
      }

      // Сервер игровые правила не проверяет, а replay судит по серверному `at`: запись, отправленная
      // за секунду до закрытия ребаев, могла прийти уже после. Проверяем, принял ли её журнал, —
      // иначе «Ребай записан» соврал бы, а деньги взяты.
      const current = modelRef.current;
      const events = [...current.events.filter((e) => e.id !== record.id), record];
      const after = replayLog(current.evening.format, events, serverNow());
      const rejected = after.state.errors.find((e) => e.eventId === record.id);
      if (rejected) {
        toast.show(`${REJECTED_TITLE[type] ?? 'Запись не принята'}: ${rejected.message}`, {
          tone: 'caution',
          detail: `Запись пришла на сервер в ${formatTime(record.at)} и помечена в ленте «Не принято». Если она лишняя — отмените её.`,
          action: { label: 'Отменить запись', onClick: () => void undo(record.id) },
        });
        return null;
      }

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
    },
    [check, toast, addEvent, undo],
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
