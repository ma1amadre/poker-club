// Действия банкира над журналом: проверка доменной canApply перед отправкой, хаптика,
// отмена событий с подтверждением. Ошибки сервера показывает глобальный обработчик мутаций
// (тост), поэтому здесь их только глотаем, чтобы не задвоить сообщение (и хаптику: тост с тоном
// сам даёт отклик, см. Toast.tsx).
// send проверяет запись по свежему журналу на эту секунду, а не по рендеру, в котором нажали
// кнопку: его зовут и после вопросов («Завершить вечер?», «Перейти на 6-й уровень?»), а пока вопрос
// висел, журнал и часы ушли вперёд.
// sendAll — несколько записей одним действием (вылет и ребай, вход с оплатой, миграция 020): одна
// транзакция add_events, один ключ повтора, проверка цепочкой canApplySequence; «Отменить» в тосте
// отменяет всё действие одной транзакцией void_events. Оплата, записанная вместе со входом или
// ребаем, отменяется вместе с ним и при отмене из ленты (linkedPayment). Если журнал принял не всё
// (ребай пришёл после закрытия), кнопка тоста отменяет только непринятое и оплату с ним
// (rejectedPart), а принятый вылет остаётся.
import { canApply, canApplySequence, replayLog, type EventDraft } from '@domain/replay.ts';
import { isShowdownEvent } from '@domain/showdown.ts';
import type { EveningState, EventPayload, EventType } from '@domain/types.ts';
import { useCallback, useLayoutEffect, useRef, type ReactElement } from 'react';
import {
  retryKeys,
  useAddEvent,
  useAddEvents,
  useVoidEvent,
  useVoidEvents,
  type EveningEventRecord,
} from '../../shared/api';
import { formatRub, formatTime, retryIntent, serverNow } from '../../shared/lib';
import { haptic } from '../../shared/telegram';
import { useConfirm, useToast } from '../../shared/ui';
import {
  describeEvent,
  landedQuestion,
  linkedPayment,
  rejectedPart,
  rejectedToast,
  voidImpact,
  voidImpactText,
} from './lib';
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
   * Своё действие в тосте вместо «Отменить» (у тоста «Материи» — одна кнопка): «Ребай» после
   * вылета, пока игрок может докупиться. Получает записанное.
   */
  action?: { label: string; onClick: (records: EveningEventRecord[]) => void };
  /**
   * Проверка намерения по свежему состоянию прямо перед отправкой, после всех вопросов: текст
   * отказа или null. «Уровень вперёд» — уровень не сменился, пока висел вопрос.
   */
  guard?: (state: EveningState) => string | null;
  /**
   * Сервер записал, но журнал принял не всё (пришло после закрытия ребаев): тост с причиной и
   * «Отменить …» уже показан, отправка вернёт null. Повторять нечего — шторку можно закрыть, а не
   * принимать null за «ответа нет».
   */
  onRejected?: () => void;
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
  /**
   * Несколько записей одним действием и одной транзакцией (вылет и ребай, вход с оплатой): записи
   * или null. Перед отправкой — canApplySequence по свежему журналу.
   */
  sendAll: (
    drafts: readonly EventDraft[],
    options?: SendOptions,
  ) => Promise<EveningEventRecord[] | null>;
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

/** Что изменится, если отменить события: что оживёт, что станет «не принято», кончится ли вечер. */
function voidEffect(model: EveningModel, eventIds: number | readonly number[]) {
  return voidImpact(model.evening.format, model.events, eventIds, serverNow());
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

export function useEveningActions(model: EveningModel): EveningActions {
  const { evening, state, nowMs } = model;
  const addEvent = useAddEvent(evening.id);
  const addEvents = useAddEvents(evening.id);
  const voidEvent = useVoidEvent(evening.id);
  const voidEvents = useVoidEvents(evening.id);
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

  /** Отмена одной записи (void_event) или действия целиком (void_events, одна транзакция). */
  const voidIds = useCallback(
    async (ids: readonly number[]) => {
      if (ids.length === 1 && ids[0] !== undefined) await voidEvent.mutateAsync(ids[0]);
      else await voidEvents.mutateAsync(ids);
    },
    [voidEvent, voidEvents],
  );

  const doVoid = useCallback(
    async (ids: readonly number[], successText?: string) => {
      haptic.impact('medium');
      try {
        await voidIds(ids);
        toast.show(successText ?? (ids.length > 1 ? 'Записи отменены' : 'Запись отменена'));
        return true;
      } catch {
        return false; // тост уже показал глобальный обработчик мутаций
      }
    },
    [voidIds, toast],
  );

  /**
   * Отмена с подтверждением: `event` — главная запись, `extra` — записи того же действия (ребай и
   * оплата после вылета). Оплата, записанная вместе со входом или ребаем, отменяется вместе с ним.
   */
  const voidGroupWithConfirm = useCallback(
    async (
      event: EveningEventRecord,
      extra: readonly EveningEventRecord[],
      copy: VoidCopy = {},
    ) => {
      const current = modelRef.current;
      const format = current.evening.format;
      const line = describeEvent(event, current.nameOf, formatRub, format);
      // Оплата при входе — по каждой отменяемой записи входа или ребая.
      const group = [event, ...extra.filter((e) => e.id !== event.id && !e.voided)];
      const paid = group
        .map((e) => linkedPayment(current.events, e, format))
        .filter((e): e is EveningEventRecord => e !== null && !group.some((g) => g.id === e.id));
      const ids = [...group, ...paid].map((e) => e.id);
      const impact = voidEffect(current, ids);
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
      const others = group.slice(1);
      const othersText =
        others.length > 0
          ? ` Вместе с ней ${others.length > 1 ? 'отменятся' : 'отменится'}: ${others.map((e) => quoteEvent(current, e)).join('; ')}.`
          : '';
      const paidText =
        paid.length > 0
          ? ` Оплата, записанная вместе ${paid.length > 1 ? 'со входами' : event.type === 'rebuy' ? 'с ребаем' : 'со входом'}, тоже отменится: ${paid
              .map((e) => quoteEvent(current, e))
              .join('; ')} — банкир возвращает эти деньги игроку.`
          : '';
      // Миграция 008: любая правка журнала снимает «Расчёт закрыт».
      const settledText =
        current.evening.status === 'settled' && event.type !== 'finish'
          ? ' Закрытый расчёт откроется — его нужно будет закрыть заново.'
          : '';
      const many = ids.length > 1;
      const ok = await confirm({
        title: copy.title ?? (many ? 'Отменить записи?' : 'Отменить запись?'),
        message:
          (copy.message ??
            `${line.title}${line.detail ? ` (${line.detail})` : ''}, ${formatTime(event.at)}. ${many ? 'Записи останутся в ленте зачёркнутыми' : 'Запись останется в ленте зачёркнутой'}.${consequence}`) +
          othersText +
          paidText +
          (impactText ? ` ${impactText}` : '') +
          settledText,
        confirmText: copy.confirmText ?? (many ? 'Отменить записи' : 'Отменить запись'),
        cancelText: 'Оставить',
        danger: true,
      });
      if (!ok) return false;
      return doVoid(ids, copy.successText);
    },
    [confirm, doVoid],
  );

  const voidWithConfirm = useCallback(
    (event: EveningEventRecord, copy: VoidCopy = {}) => voidGroupWithConfirm(event, [], copy),
    [voidGroupWithConfirm],
  );

  /**
   * «Отменить» из тоста: обратимое действие — без подтверждения, если отмена не трогает других
   * записей и не меняет «завершён ли вечер».
   */
  const undo = useCallback(
    async (eventIds: readonly number[]) => {
      const current = modelRef.current;
      const records = eventIds
        .map((id) => current.events.find((e) => e.id === id))
        .filter((e): e is EveningEventRecord => e !== undefined && !e.voided);
      const [main, ...rest] = records;
      if (!main) return;
      if (
        hasSideEffects(
          voidEffect(
            current,
            records.map((e) => e.id),
          ),
        )
      ) {
        await voidGroupWithConfirm(main, rest);
        return;
      }
      haptic.impact('light');
      try {
        await voidIds(records.map((e) => e.id));
        toast.show(records.length > 1 ? 'Записи отменены' : 'Запись отменена');
      } catch {
        // тост уже показал глобальный обработчик мутаций
      }
    },
    [voidIds, toast, voidGroupWithConfirm],
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

  /**
   * Сервер игровые правила не проверяет, а replay судит по серверному `at`: запись, отправленная за
   * секунду до закрытия ребаев, могла прийти уже после. Принял ли журнал записанное: если нет —
   * тост с причиной, иначе «Ребай записан» соврал бы, а деньги взяты. Кнопка тоста отменяет только
   * непринятое и оплату с ним (rejectedPart): вылет, который журнал принял, остаётся. true — что-то
   * не принято.
   */
  const reportRejected = useCallback(
    (records: readonly EveningEventRecord[], options: SendOptions) => {
      const current = modelRef.current;
      const format = current.evening.format;
      const ids = new Set(records.map((r) => r.id));
      const events = [...current.events.filter((e) => !ids.has(e.id)), ...records];
      const after = replayLog(format, events, serverNow());
      const part = rejectedPart(format, records, after.state.errors);
      const first = part?.rejected[0];
      if (!part || !first) return false;
      const text = rejectedToast(part, formatTime(first.event.at));
      toast.show(text.title, {
        tone: 'caution',
        detail: text.detail,
        action: {
          label: text.actionLabel,
          onClick: () => void undo(part.toVoid.map((e) => e.id)),
        },
      });
      options.onRejected?.();
      return true;
    },
    [toast, undo],
  );

  /** Тост после записи: «Отменить» (всё действие) или своё действие вызывающего. */
  const successToast = useCallback(
    (options: SendOptions, records: EveningEventRecord[]) => {
      if (!options.success) return;
      const action = options.action
        ? { label: options.action.label, onClick: () => options.action?.onClick(records) }
        : options.undo
          ? { label: 'Отменить', onClick: () => void undo(records.map((r) => r.id)) }
          : undefined;
      toast.show(options.success, {
        tone: 'positive',
        detail: options.detail,
        ...(action ? { durationMs: UNDO_TOAST_MS, action } : {}),
      });
    },
    [toast, undo],
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

      if (reportRejected([record], options)) return null;

      successToast(options, [record]);
      return record;
    },
    [freshState, confirmIfLanded, toast, addEvent, reportRejected, successToast, evening.id],
  );

  const sendAll = useCallback(
    async (drafts: readonly EventDraft[], options: SendOptions = {}) => {
      if (drafts.length === 0) return [];
      const problemNow = () => {
        const fresh = freshState();
        const chain = canApplySequence(
          modelRef.current.evening.format,
          modelRef.current.events,
          drafts,
          serverNow(),
        );
        if (chain) {
          // В действии из нескольких записей — какая именно не проходит: «Вход: Саша. Игрок уже в турнире».
          const draft = drafts[chain.index];
          if (!draft || drafts.length === 1) return chain.message;
          const m = modelRef.current;
          const line = describeEvent(
            { id: 0, type: draft.type, payload: draft.payload, at: '', voided: false },
            m.nameOf,
            formatRub,
            m.evening.format,
          );
          return `${line.title}. ${chain.message}`;
        }
        return options.guard?.(fresh) ?? null;
      };
      const refuse = (problem: string) => {
        toast.show(problem, { tone: 'caution', detail: 'Записи не отправлены.' });
        return null;
      };
      const problem = problemNow();
      if (problem) return refuse(problem);

      // Ключ повтора — на всё действие: сервер выводит из него ключи остальных записей (020), и
      // повтор после тайм-аута вернёт действие целиком. Дошедшее без ответа — тот же вопрос, что у send.
      const intent = retryIntent(evening.id, 'batch', drafts);
      const landed = await confirmIfLanded(intent);
      if (landed) return [landed];
      const problemAfter = problemNow();
      if (problemAfter) return refuse(problemAfter);

      haptic.impact(drafts.some((d) => d.type === 'bust') ? 'heavy' : 'medium');
      const journal = modelRef.current.events;
      const clientId = retryKeys.keyFor(intent, Date.now(), (key) =>
        journal.some((e) => e.clientId === key),
      );

      let records: EveningEventRecord[];
      try {
        records = await addEvents.mutateAsync({ events: drafts, clientId });
        retryKeys.succeeded(intent);
      } catch {
        retryKeys.failed(intent, clientId, Date.now());
        return null;
      }

      if (reportRejected(records, options)) return null;

      successToast(options, records);
      return records;
    },
    [freshState, confirmIfLanded, toast, addEvents, reportRejected, successToast, evening.id],
  );

  return {
    send,
    sendAll,
    voidWithConfirm,
    check,
    freshState,
    confirmIfLanded,
    busy: addEvent.isPending || addEvents.isPending || voidEvent.isPending || voidEvents.isPending,
    confirm,
    confirmElement,
  };
}
