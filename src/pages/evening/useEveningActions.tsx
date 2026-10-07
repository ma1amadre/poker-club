// Действия банкира над журналом: проверка доменной canApply перед отправкой, хаптика,
// отмена событий с подтверждением. Ошибки сервера показывает глобальный обработчик мутаций
// (тост), поэтому здесь их только глотаем, чтобы не задвоить сообщение (и хаптику: тост с тоном
// сам даёт отклик, см. Toast.tsx).
// send проверяет запись по свежему журналу на эту секунду, а не по рендеру, в котором нажали
// кнопку: его зовут и после вопросов («Завершить вечер?», «Перейти на 6-й уровень?»), а пока вопрос
// висел, журнал и часы ушли вперёд.
import { canApply, replayLog } from '@domain/replay.ts';
import { isShowdownEvent } from '@domain/showdown.ts';
import type { EveningState, EventPayload, EventType } from '@domain/types.ts';
import { useCallback, useLayoutEffect, useRef, type ReactElement } from 'react';
import { retryKeys, useAddEvent, useVoidEvent, type EveningEventRecord } from '../../shared/api';
import { formatRub, formatTime, retryIntent, serverNow } from '../../shared/lib';
import { haptic } from '../../shared/telegram';
import { useConfirm, useToast } from '../../shared/ui';
import { describeEvent, landedQuestion, voidImpact, voidImpactText } from './lib';
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
  /**
   * Проверка намерения по свежему состоянию прямо перед отправкой, после всех вопросов: текст
   * отказа или null. «Уровень вперёд» — уровень не сменился, пока висел вопрос.
   */
  guard?: (state: EveningState) => string | null;
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
  /** Текст, почему событие сейчас нельзя добавить (или null), — по состоянию этого рендера. */
  check: (type: EventType, payload?: EventPayload) => string | null;
  /** Состояние вечера на эту секунду по последнему журналу (не по замыканию рендера). */
  freshState: () => EveningState;
  /**
   * Прошлое нажатие этого намерения осталось без ответа, а его запись уже в журнале: спросить,
   * нужна ли ещё одна. Дошедшая запись — «Не записывать»; null — записывать (или спрашивать не о чем).
   */
  confirmIfLanded: (intent: string) => Promise<EveningEventRecord | null>;
  busy: boolean;
  confirm: ReturnType<typeof useConfirm>['confirm'];
  confirmElement: ReactElement;
}

/** Что изменится, если отменить событие: что оживёт, что станет «не принято», кончится ли вечер. */
function voidEffect(model: EveningModel, eventId: number) {
  return voidImpact(model.evening.format, model.events, eventId, serverNow());
}

/** «Ребай: Саша, ребай на 1 000 ₽», 20:15 — запись в тексте подтверждения. */
function quoteEvent(model: EveningModel, event: EveningEventRecord): string {
  const l = describeEvent(event, model.nameOf, formatRub, model.evening.format);
  return `«${l.title}${l.detail ? `, ${l.detail}` : ''}», ${formatTime(event.at)}`;
}

/** Отмена трогает не только себя: подтверждение обязательно, даже из тоста «Отменить». */
function hasSideEffects(impact: ReturnType<typeof voidEffect>): boolean {
  return (
    impact.revived.length > 0 ||
    impact.rejected.length > 0 ||
    impact.finishedBefore !== impact.finishedAfter
  );
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
  showdown: 'Олл-ин не принят',
  showdown_close: 'Закрытие олл-ина не принято',
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
      const line = describeEvent(event, current.nameOf, formatRub, current.evening.format);
      const impact = voidEffect(current, event.id);
      const consequence =
        event.type === 'finish'
          ? impact.finishedAfter
            ? ' Вечер останется завершённым: в журнале есть ещё одна запись «Игра окончена».'
            : ' Вечер вернётся в игру: итоги, голосование и расчёт снова откроются после завершения, таймер будет на паузе.'
          : event.type === 'payment'
            ? ' Остаток игрока в расчёте пересчитается.'
            : event.type === 'join' || event.type === 'rebuy' || event.type === 'bust'
              ? ' Места, нокауты и деньги пересчитаются.'
              : isShowdownEvent(event.type)
                ? event.type === 'showdown_close'
                  ? ' Раздача снова появится на табло.'
                  : ' Табло покажет раздачу такой, какой она была до этой записи. На игру и деньги олл-ин не влияет.'
                : ' Таймер и уровень пересчитаются.';
      const impactText = voidImpactText(impact, (e) => quoteEvent(current, e));
      // Миграция 008: любая правка журнала снимает «Расчёт закрыт».
      const settledText =
        current.evening.status === 'settled' && event.type !== 'finish'
          ? ' Закрытый расчёт откроется — его нужно будет закрыть заново.'
          : '';
      const ok = await confirm({
        title: copy.title ?? 'Отменить запись?',
        message:
          (copy.message ??
            `${line.title}${line.detail ? ` (${line.detail})` : ''}, ${formatTime(event.at)}. Запись останется в ленте зачёркнутой.${consequence}`) +
          (impactText ? ` ${impactText}` : '') +
          settledText,
        confirmText: copy.confirmText ?? 'Отменить запись',
        cancelText: 'Оставить',
        danger: true,
      });
      if (!ok) return false;
      return doVoid(event.id, copy.successText);
    },
    [confirm, doVoid],
  );

  /**
   * «Отменить» из тоста: обратимое действие — без подтверждения, если отмена не трогает других
   * записей и не меняет «завершён ли вечер».
   */
  const undo = useCallback(
    async (eventId: number) => {
      const current = modelRef.current;
      const event = current.events.find((e) => e.id === eventId);
      if (event && hasSideEffects(voidEffect(current, eventId))) {
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

  const freshState = useCallback(() => {
    const m = modelRef.current;
    return replayLog(m.evening.format, m.events, serverNow()).state;
  }, []);

  const confirmIfLanded = useCallback(
    async (intent: string) => {
      const m = modelRef.current;
      const key = retryKeys.landed(intent, Date.now(), (k) =>
        m.events.some((e) => e.clientId === k && !e.voided),
      );
      const landed = key ? m.events.find((e) => e.clientId === key) : undefined;
      if (!landed) return null;
      // Ответ банкира — решение по этой попытке при любом выборе: ключ больше не нужен.
      retryKeys.succeeded(intent);
      const again = await confirm(landedQuestion(quoteEvent(m, landed)));
      return again ? null : landed;
    },
    [confirm],
  );

  const send = useCallback(
    async (type: EventType, payload: EventPayload = {}, options: SendOptions = {}) => {
      const problemNow = () => {
        const fresh = freshState();
        return (
          canApply(modelRef.current.evening.format, fresh, type, payload, serverNow()) ??
          options.guard?.(fresh) ??
          null
        );
      };
      const refuse = (problem: string) => {
        // Хаптику (warning) даёт сам тост тона caution.
        toast.show(problem, { tone: 'caution', detail: 'Запись не отправлена.' });
        return null;
      };
      const problem = problemNow();
      if (problem) return refuse(problem);

      // Ключ повтора — на намерение «тип + payload»: нажал ту же кнопку снова после ошибки или
      // тайм-аута (в том числе после перезагрузки WebView — ключи в sessionStorage) — уходит тот же
      // ключ, и если первая запись на самом деле прошла, сервер вернёт её, а не запишет вторую.
      // Запись с этим ключом уже в журнале на экране — молча слать новым ключом нельзя: тост
      // тайм-аута советовал нажать ещё раз, и вторая запись задвоила бы платёж или уровень. Банкир
      // выбирает: «Не записывать» — дошедшая запись и есть результат, «Записать ещё одну» — новое
      // действие (следующая раздача, вылет после ребая) с новым ключом.
      const intent = retryIntent(evening.id, type, payload);
      const landed = await confirmIfLanded(intent);
      if (landed) return landed;
      // Пока висел вопрос, журнал мог измениться — проверка заново (без вопроса — та же).
      const problemAfter = problemNow();
      if (problemAfter) return refuse(problemAfter);

      haptic.impact(type === 'bust' || type === 'finish' ? 'heavy' : 'medium');
      const journal = modelRef.current.events;
      const clientId = retryKeys.keyFor(intent, Date.now(), (key) =>
        journal.some((e) => e.clientId === key),
      );

      let record: EveningEventRecord;
      try {
        record = await addEvent.mutateAsync({ type, payload, clientId });
        retryKeys.succeeded(intent);
      } catch {
        retryKeys.failed(intent, clientId, Date.now());
        // Тост (и хаптику) уже дал глобальный обработчик мутаций; при тайм-ауте — «Ответа нет —
        // нажми ещё раз: запись не задвоится», а шторка снова закрывается.
        return null;
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
          detail: `Запись пришла на сервер в ${formatTime(record.at)} и помечена в ленте «Не принято». Если она лишняя — отмени её.`,
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
    [freshState, confirmIfLanded, toast, addEvent, undo, evening.id],
  );

  return {
    send,
    voidWithConfirm,
    check,
    freshState,
    confirmIfLanded,
    busy: addEvent.isPending || voidEvent.isPending,
    confirm,
    confirmElement,
  };
}
