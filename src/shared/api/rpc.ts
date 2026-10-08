// Запись через RPC (security definer, права проверяют сами — см. 003_rpc.sql). Таблицы
// evening_events, rsvps, predictions, votes напрямую не пишутся: RLS это запрещает.
import type { EventDraft } from '@domain/replay.ts';
import type { EventPayload, EventType } from '@domain/types.ts';
import type { VoteCategory } from '@domain/votes.ts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/context';
import { createRetryKeys, retryIntent, safeSessionStorage } from '../lib/retryKeys';
import { addClockSample } from '../lib/serverClock';
import { TimeoutError, WRITE_TIMEOUT_MS, withTimeout } from '../lib/timeout';
import { supabase } from '../supabase';
import { toError } from './errors';
import { queryKeys } from './keys';
import { toEventRecord, type EveningEventRecord, type RsvpStatus } from './types';

// --- Сырые вызовы ----------------------------------------------------------------------------

export interface AddEventInput {
  eveningId: string;
  type: EventType;
  /** Для timer_*, level_*, hand, finish — пустой объект (по умолчанию). */
  payload?: EventPayload;
  /**
   * Ключ повтора (миграция 007): один на намерение пользователя. Повтор с тем же ключом после
   * потерянного ответа вернёт уже записанное событие, а не задвоит платёж или раздачу.
   */
  clientId?: string;
}

/** Случайный uuid v4 — ключ повтора add_event. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Ключи повтора записей вечера (add_event, add_guest): в sessionStorage, переживают перезагрузку
 * WebView. Одно хранилище на приложение — см. shared/lib/retryKeys.ts.
 */
export const retryKeys = createRetryKeys(safeSessionStorage(), newClientId);

/**
 * Тост тайм-аута записи с ключом повтора: повтор тем же ключом не задвоит запись. Если запись
 * успела дойти и уже видна в журнале, повторное нажатие не уходит молча с новым ключом, а
 * спрашивает, нужна ли ещё одна (`retryKeys.landed`, useEveningActions, SeatSheet).
 */
export const WRITE_TIMEOUT_TEXT = 'Ответа нет — нажми ещё раз: запись не задвоится';
/** Тайм-аут записи без ключа повтора, которую повтор не испортит (те же доли, та же отметка). */
const RETRY_TIMEOUT_TEXT = 'Ответа нет — нажми ещё раз';

/**
 * RPC записи с пределом ожидания WRITE_TIMEOUT_MS: зависшее соединение отменяется, а шторка
 * перестаёт ждать и закрывается. Сервер мог успеть записать — повтор идёт тем же ключом.
 */
function writeRpc<R>(
  call: (signal: AbortSignal) => PromiseLike<R>,
  message = WRITE_TIMEOUT_TEXT,
): Promise<R> {
  return withTimeout(call, WRITE_TIMEOUT_MS, () => new TimeoutError(message, WRITE_TIMEOUT_MS));
}

/** Событие в журнал вечера. Перед вызовом страница проверяет его доменной canApply. */
export async function addEvent({
  eveningId,
  type,
  payload = {},
  clientId,
}: AddEventInput): Promise<EveningEventRecord> {
  const t0 = Date.now();
  const { data, error } = await writeRpc((signal) =>
    supabase
      .rpc('add_event', {
        p_evening: eveningId,
        p_type: type,
        p_payload: payload,
        ...(clientId ? { p_client_id: clientId } : {}),
      })
      .abortSignal(signal),
  );
  const t1 = Date.now();
  if (error) throw toError(error);
  const record = toEventRecord(data);
  // `at` ставит сервер — заодно замер часов (см. serverClock.ts). Повтор по ключу вернёт старое
  // событие — его `at` о часах ничего не говорит.
  if (Date.parse(record.at) >= t0 - 60_000) addClockSample(record.at, t0, t1);
  return record;
}

export interface AddEventsInput {
  eveningId: string;
  /** Записи одного действия по порядку: вылет и ребай, вход и оплата (только join/rebuy/bust/payment). */
  events: readonly EventDraft[];
  /**
   * Ключ повтора действия (миграция 020): у первой записи — он сам, у i-й сервер выводит свой
   * (`derived_client_id`). Повтор тем же ключом вернёт уже записанное действие целиком.
   */
  clientId?: string;
}

/**
 * Несколько записей журнала одним действием и одной транзакцией (add_events, миграция 020): лягут
 * все или ни одной. Перед вызовом страница проверяет цепочку доменной canApplySequence.
 */
export async function addEvents({
  eveningId,
  events,
  clientId,
}: AddEventsInput): Promise<EveningEventRecord[]> {
  const t0 = Date.now();
  const { data, error } = await writeRpc((signal) =>
    supabase
      .rpc('add_events', {
        p_evening: eveningId,
        p_events: events.map((e) => ({ type: e.type, payload: e.payload })),
        ...(clientId ? { p_client_id: clientId } : {}),
      })
      .abortSignal(signal),
  );
  const t1 = Date.now();
  if (error) throw toError(error);
  const records = (data ?? []).map(toEventRecord);
  if (records.length !== events.length)
    throw new Error('Сервер вернул не все записи действия. Обнови экран и проверь ленту.');
  // `at` ставит сервер — замер часов, как у add_event (повтор по ключу вернёт старое время).
  const first = records[0];
  if (first && Date.parse(first.at) >= t0 - 60_000) addClockSample(first.at, t0, t1);
  return records;
}

/**
 * Отменить несколько записей одного вечера одной транзакцией (void_events, миграция 020): тост
 * «Отменить» после «Вылет и ребай», отмена входа вместе с его оплатой.
 */
export async function voidEvents(eventIds: readonly number[]): Promise<void> {
  const { error } = await writeRpc(
    (signal) => supabase.rpc('void_events', { p_events: [...eventIds] }).abortSignal(signal),
    'Ответа нет — проверь ленту: если записи не зачёркнуты, отмени ещё раз',
  );
  if (error) throw toError(error);
}

/** Отменить событие (пометка voided, история сохраняется). Отмена finish возвращает вечер в live. */
export async function voidEvent(eventId: number): Promise<void> {
  const { error } = await writeRpc(
    (signal) => supabase.rpc('void_event', { p_event: eventId }).abortSignal(signal),
    // Ключа у отмены нет: повтор уже прошедшей отмены сервер отклонит, лента покажет итог.
    'Ответа нет — проверь ленту: если запись не зачёркнута, отмени ещё раз',
  );
  if (error) throw toError(error);
}

export interface MarkSettledInput {
  eveningId: string;
  /** Журнал, который видел экран расчёта (journalVersion): изменился — сервер откажет, P0001. */
  lastEventId: number;
  voidedCount: number;
}

export async function markSettled({
  eveningId,
  lastEventId,
  voidedCount,
}: MarkSettledInput): Promise<void> {
  const { error } = await writeRpc(
    (signal) =>
      supabase
        .rpc('mark_settled', {
          p_evening: eveningId,
          p_last_event_id: lastEventId,
          p_voided_count: voidedCount,
        })
        .abortSignal(signal),
    RETRY_TIMEOUT_TEXT,
  );
  if (error) throw toError(error);
}

export async function unmarkSettled(eveningId: string): Promise<void> {
  const { error } = await writeRpc(
    (signal) => supabase.rpc('unmark_settled', { p_evening: eveningId }).abortSignal(signal),
    RETRY_TIMEOUT_TEXT,
  );
  if (error) throw toError(error);
}

export async function setRsvp(eveningId: string, status: RsvpStatus): Promise<void> {
  const { error } = await supabase.rpc('set_rsvp', { p_evening: eveningId, p_status: status });
  if (error) throw toError(error);
}

export interface PredictionInput {
  eveningId: string;
  winnerId: string | null;
  firstOutId: string | null;
}

export async function setPrediction({
  eveningId,
  winnerId,
  firstOutId,
}: PredictionInput): Promise<void> {
  const { error } = await supabase.rpc('set_prediction', {
    p_evening: eveningId,
    // SQL принимает null («без прогноза»), а типы в стиле генератора аргументы nullable не помечают.
    p_winner: winnerId as string,
    p_first_out: firstOutId as string,
  });
  if (error) throw toError(error);
}

export interface CastVoteInput {
  eveningId: string;
  category: VoteCategory;
  nomineeId: string;
  caption?: string | null;
  /** Путь в бакете vote-photos из uploadVotePhoto. */
  photoPath?: string | null;
}

/** Голос в номинации (upsert: повторный голос в той же категории заменяет прежний). */
export async function castVote({
  eveningId,
  category,
  nomineeId,
  caption,
  photoPath,
}: CastVoteInput): Promise<void> {
  const { error } = await supabase.rpc('cast_vote', {
    p_evening: eveningId,
    p_category: category,
    p_nominee: nomineeId,
    p_caption: caption?.trim() || undefined,
    p_photo_path: photoPath || undefined,
  });
  if (error) throw toError(error);
}

export interface DeleteVoteInput {
  eveningId: string;
  voterId: string;
  category: VoteCategory;
}

/** Отозвать свой голос (пока голосование открыто) или удалить любой — админ. Фото удаляется отдельно. */
export async function deleteVote({ eveningId, voterId, category }: DeleteVoteInput): Promise<void> {
  const { error } = await supabase.rpc('delete_vote', {
    p_evening: eveningId,
    p_voter: voterId,
    p_category: category,
  });
  if (error) throw toError(error);
}

/** Ответ Edge Function notify (supabase/functions/notify/results.ts → PostOutcome). */
export type NotifyOutcome =
  | 'posted'
  | 'already_posted'
  | 'no_group'
  | 'no_changes'
  /** Анонс вечера в группу ещё не уходил — о правке писать не нужно (evening_changed). */
  | 'not_announced'
  /** Тренировочный вечер (миграция 023): в группу о нём бот не пишет. */
  | 'training';

export type NotifyKind = 'evening_finished' | 'evening_corrected';

/** О чём бот написал группе после правки вечера (notify/changes.ts). */
export type AnnounceChange = 'moved' | 'cancelled' | 'restored';

/**
 * Какой пост ушёл при `moved` (moveKind в _shared/announce.ts): новое время — «Вечер перенесён»,
 * место вписали впервые — «Место вечера», место сменилось — «Вечер переезжает».
 */
export type AnnounceMove = 'rescheduled' | 'place_set' | 'relocated';

interface NotifyResponse {
  ok: true;
  outcome: NotifyOutcome;
  change?: AnnounceChange;
  /** Только при posted + moved; сервер до разделения постов его не присылал. */
  move?: AnnounceMove;
}

/** Вызов Edge Function с JWT игрока; текст ошибки — из тела функции {error, code}. */
async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
  emptyMessage: string,
  timeout?: number,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body,
    ...(timeout ? { timeout } : {}),
  });
  if (error) {
    // Тело ошибки функции: {error: текст по-русски, code}.
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      const parsed = (await response
        .clone()
        .json()
        .catch(() => null)) as { error?: unknown } | null;
      if (typeof parsed?.error === 'string') throw new Error(parsed.error);
    }
    throw toError(error);
  }
  if (!data) throw new Error(emptyMessage);
  return data;
}

function invokeNotify(body: Record<string, unknown>): Promise<NotifyResponse> {
  // Предел ожидания: после финиша банкир ждёт этот вызов перед расчётом. Пост идемпотентен, а не
  // дошедший добьёт cron-tick.
  return invokeFunction<NotifyResponse>(
    'notify',
    body,
    'Сервер уведомлений вернул пустой ответ.',
    WRITE_TIMEOUT_MS,
  );
}

/**
 * Пост итогов вечера в группу — банкир (или админ) после finish. Текст собирает сервер из БД;
 * повторный вызов безопасен (already_posted). Если не вызвать, итоги добьёт cron-tick.
 * `evening_corrected` — только админ: исправленный итог закрытого вечера после правки журнала
 * (no_changes — с прошлого поста журнал не менялся).
 */
export async function notifyEveningFinished(
  eveningId: string,
  kind: NotifyKind = 'evening_finished',
): Promise<NotifyOutcome> {
  return (await invokeNotify({ kind, eveningId })).outcome;
}

/**
 * Админ сохранил вечер: если анонс уже в группе, а время, место или отмена изменились, бот пишет
 * «Вечер перенесён» / «отменён» / «всё-таки состоится» (миграция 008). Повтор безопасен
 * (no_changes); не дошедший вызов добьёт cron-tick.
 */
export async function notifyEveningChanged(
  eveningId: string,
): Promise<{ outcome: NotifyOutcome; change: AnnounceChange | null; move: AnnounceMove | null }> {
  const data = await invokeNotify({ kind: 'evening_changed', eveningId });
  return { outcome: data.outcome, change: data.change ?? null, move: data.move ?? null };
}

/**
 * Вид слияния: `telegram` — гость → Telegram-профиль (merge_players, миграция 008), `guest` — дубль
 * гостя → другой профиль без Telegram (merge_guests, миграция 024).
 */
export type MergeKind = 'telegram' | 'guest';

/** Отчёт merge_players / merge_guests и их предпросмотров (миграции 008, 024). */
export interface MergeReport {
  guest: { id: string; name: string };
  target: { id: string; name: string };
  /** Сыгранные гостем вечера (действующий join). */
  evenings: number;
  /** Записи журнала с гостем (входы, ребаи, вылеты, платежи, в том числе отменённые). */
  events: number;
  votesReceived: number;
  votesCast: number;
  /** Чужие прогнозы, где гость — победитель или первый вылет. */
  predictionsAbout: number;
  predictionsMade: number;
  rsvps: number;
  bankerOf: number;
  /** Фото голосов гостя: остаются в его папке Storage. */
  photosKept: number;
  /** Что мешает слиянию; пусто — можно сливать. */
  blockers: string[];
  /** Только merge_guests: профиль станет постоянным (дубль был постоянным игроком). */
  becomesPermanent?: boolean;
  /** Только merge_guests: профиль включится (дубль был включён). */
  becomesActive?: boolean;
}

function toMergeReport(data: unknown): MergeReport {
  if (!data || typeof data !== 'object') throw new Error('Сервер не вернул отчёт о слиянии.');
  return data as MergeReport;
}

/** Что перенесёт слияние гостя с Telegram-профилем и что ему мешает. Только админ. */
export async function mergePlayersPreview(guestId: string, targetId: string): Promise<MergeReport> {
  const { data, error } = await supabase.rpc('merge_players_preview', {
    p_guest: guestId,
    p_target: targetId,
  });
  if (error) throw toError(error);
  return toMergeReport(data);
}

/** Перенести всё гостя на Telegram-профиль и удалить гостя. Только админ; атомарно. */
export async function mergePlayers(guestId: string, targetId: string): Promise<MergeReport> {
  const { data, error } = await supabase.rpc('merge_players', {
    p_guest: guestId,
    p_target: targetId,
  });
  if (error) throw toError(error);
  return toMergeReport(data);
}

/** Что перенесёт слияние дубля гостя с другим профилем без Telegram и что ему мешает. Только админ. */
export async function mergeGuestsPreview(guestId: string, targetId: string): Promise<MergeReport> {
  const { data, error } = await supabase.rpc('merge_guests_preview', {
    p_guest: guestId,
    p_target: targetId,
  });
  if (error) throw toError(error);
  return toMergeReport(data);
}

/** Перенести всё дубля на профиль без Telegram и удалить дубль (миграция 024). Только админ; атомарно. */
export async function mergeGuests(guestId: string, targetId: string): Promise<MergeReport> {
  const { data, error } = await supabase.rpc('merge_guests', {
    p_guest: guestId,
    p_target: targetId,
  });
  if (error) throw toError(error);
  return toMergeReport(data);
}

/**
 * Создать гостя и сразу посадить его за стол (join) — миграция 006; `stacks` — кратность входа
 * (миграция 015, 1..10). Права как у add_event для join: банкир вечера или админ. Возвращает id
 * нового игрока. Стандартный вход уходит без p_stacks — как до 015. `clientId` — ключ повтора
 * (миграция 019): повтор после потерянного ответа вернёт уже посаженного гостя, второго не будет.
 * `paidRub` — «Оплачено сразу» (миграция 020): платёж гостя на эту сумму тем же вызовом; сумму
 * считает домен (prepaidPayment).
 */
export async function addGuest(
  eveningId: string,
  name: string,
  stacks = 1,
  clientId?: string,
  paidRub?: number,
): Promise<string> {
  const { data, error } = await writeRpc((signal) =>
    supabase
      .rpc('add_guest', {
        p_evening: eveningId,
        p_name: name,
        ...(stacks > 1 ? { p_stacks: stacks } : {}),
        ...(clientId ? { p_client_id: clientId } : {}),
        ...(paidRub !== undefined ? { p_paid_rub: paidRub } : {}),
      })
      .abortSignal(signal),
  );
  if (error) throw toError(error);
  if (typeof data !== 'string') throw new Error('Сервер не вернул id гостя. Повтори попытку.');
  return data;
}

/** Призовые доли вечера до старта (миграция 007) — банкир вечера или админ. */
export async function setPayout(eveningId: string, payoutPct: number[]): Promise<void> {
  const { error } = await writeRpc(
    (signal) =>
      supabase.rpc('set_payout', { p_evening: eveningId, p_pct: payoutPct }).abortSignal(signal),
    RETRY_TIMEOUT_TEXT,
  );
  if (error) throw toError(error);
}

export async function setMyName(name: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_name', { p_name: name });
  if (error) throw toError(error);
}

/**
 * Своё имя для озвучки на табло (миграция 016). Пустая строка — сбросить: голос возьмёт имя в
 * клубе, если оно кириллическое. Возвращает то, что сохранил сервер (null — сброшено).
 */
export async function setMySpokenName(name: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_my_spoken_name', { p_name: name });
  if (error) throw toError(error);
  return typeof data === 'string' && data !== '' ? data : null;
}

/** Свой режим (миграция 024): true — болельщик («слежу, не играю»), false — играю. */
export async function setMySpectator(spectator: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_my_spectator', { p_spectator: spectator });
  if (error) throw toError(error);
  return data === true;
}

// --- Хуки-мутации ----------------------------------------------------------------------------

/** Изменился вечер: его карточка, списки вечеров и (для завершённых) статистика клуба. */
function invalidateEvening(queryClient: QueryClient, eveningId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.evening(eveningId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.eveningsAll });
  void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
}

/** Добавить событие в журнал вечера `eveningId`. */
export function useAddEvent(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AddEventInput, 'eveningId'>) => addEvent({ ...input, eveningId }),
    onSuccess: (record) => {
      // Сразу кладём событие в кеш: экран банкира не ждёт ни Realtime, ни перезапроса.
      queryClient.setQueryData<EveningEventRecord[]>(queryKeys.eveningEvents(eveningId), (old) =>
        old && !old.some((e) => e.id === record.id) ? [...old, record] : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
    // Ответ мог потеряться после того, как запись прошла: сверяем журнал с сервером, чтобы
    // шторка до повторного нажатия уже показала то, что записано на самом деле.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

/** Несколько записей одним действием (add_events) в журнал вечера `eveningId`. */
export function useAddEvents(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AddEventsInput, 'eveningId'>) => addEvents({ ...input, eveningId }),
    onSuccess: (records) => {
      queryClient.setQueryData<EveningEventRecord[]>(queryKeys.eveningEvents(eveningId), (old) =>
        old ? [...old, ...records.filter((r) => !old.some((e) => e.id === r.id))] : old,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

/** Отменить несколько записей вечера `eveningId` одной транзакцией (void_events). */
export function useVoidEvents(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventIds: readonly number[]) => voidEvents(eventIds),
    onSuccess: (_void, eventIds) => {
      const at = new Date().toISOString();
      queryClient.setQueryData<EveningEventRecord[]>(queryKeys.eveningEvents(eveningId), (old) =>
        old?.map((e) => (eventIds.includes(e.id) ? { ...e, voided: true, voidedAt: at } : e)),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

export function useVoidEvent(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) => voidEvent(eventId),
    onSuccess: (_void, eventId) => {
      queryClient.setQueryData<EveningEventRecord[]>(queryKeys.eveningEvents(eveningId), (old) =>
        old?.map((e) =>
          e.id === eventId ? { ...e, voided: true, voidedAt: new Date().toISOString() } : e,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
    // Ответ мог потеряться после того, как отмена прошла (тайм-аут): лента покажет, как на деле.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

/**
 * Намерение «этот гость с этой кратностью» (и, если «Оплачено сразу», с этой оплатой) — ключ
 * повтора add_guest (регистр имени не важен). Без оплаты строка та же, что до миграции 020.
 */
export function guestRetryIntent(
  eveningId: string,
  name: string,
  stacks = 1,
  paidRub?: number,
): string {
  return retryIntent(
    eveningId,
    'guest',
    paidRub === undefined
      ? { name: name.toLowerCase(), stacks }
      : { name: name.toLowerCase(), stacks, paidRub },
  );
}

export function useAddGuest(eveningId: string) {
  const queryClient = useQueryClient();
  const refresh = () => {
    // Новый игрок нужен в справочнике (имя в ленте), новый join — в журнале.
    void queryClient.invalidateQueries({ queryKey: queryKeys.players });
    void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
    invalidateEvening(queryClient, eveningId);
  };
  return useMutation({
    // Ключ повтора — по намерению «имя + кратность»: тот же гость, нажатый ещё раз после ошибки или
    // тайм-аута, уходит с прежним ключом, и сервер вернёт уже посаженного (миграция 019).
    mutationFn: async ({
      name,
      stacks = 1,
      paidRub,
    }: {
      name: string;
      stacks?: number;
      /** «Оплачено сразу»: платёж гостя на эту сумму тем же вызовом (миграция 020). */
      paidRub?: number;
    }) => {
      const intent = guestRetryIntent(eveningId, name, stacks, paidRub);
      // Гость с этим ключом уже в журнале на экране — новый гость с тем же именем, а не повтор
      // (дошедшую без ответа попытку SeatSheet до этого показывает и переспрашивает).
      const journal = queryClient.getQueryData<EveningEventRecord[]>(
        queryKeys.eveningEvents(eveningId),
      );
      const clientId = retryKeys.keyFor(intent, Date.now(), (key) =>
        Boolean(journal?.some((e) => e.clientId === key)),
      );
      try {
        const id = await addGuest(eveningId, name, stacks, clientId, paidRub);
        retryKeys.succeeded(intent);
        return id;
      } catch (error) {
        retryKeys.failed(intent, clientId, Date.now());
        throw error;
      }
    },
    onSuccess: refresh,
    // Ответ мог потеряться после того, как гость сел: справочник и журнал — как на сервере.
    onError: refresh,
  });
}

export function useMarkSettled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkSettledInput) => markSettled(input),
    onSuccess: (_void, { eveningId }) => invalidateEvening(queryClient, eveningId),
    // Отказ «журнал изменился» — перечитать журнал, чтобы остатки на экране стали актуальными.
    onError: (_error, { eveningId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningEvents(eveningId) });
      invalidateEvening(queryClient, eveningId);
    },
  });
}

export function useUnmarkSettled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eveningId: string) => unmarkSettled(eveningId),
    onSuccess: (_void, eveningId) => invalidateEvening(queryClient, eveningId),
  });
}

export function useSetRsvp(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: RsvpStatus) => setRsvp(eveningId, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.rsvps(eveningId) }),
  });
}

export function useSetPrediction(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PredictionInput, 'eveningId'>) =>
      setPrediction({ ...input, eveningId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.predictions(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useCastVote(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CastVoteInput, 'eveningId'>) => castVote({ ...input, eveningId }),
    meta: { silent: true }, // тост ошибки с контекстом показывает VoteSheet
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.votes(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useDeleteVote(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<DeleteVoteInput, 'eveningId'>) => deleteVote({ ...input, eveningId }),
    meta: { silent: true }, // тост ошибки с контекстом показывают VotePage и VoteResults
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.votes(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useSetPayout(eveningId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payoutPct: number[]) => setPayout(eveningId, payoutPct),
    onSuccess: () => invalidateEvening(queryClient, eveningId),
  });
}

export function useNotifyEveningFinished(eveningId: string, kind: NotifyKind = 'evening_finished') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notifyEveningFinished(eveningId, kind),
    // results_posted_at изменился — перечитать вечер.
    onSuccess: () => invalidateEvening(queryClient, eveningId),
  });
}

/** Предпросмотр слияния для выбранной пары; всегда свежий — данные клуба могли измениться. */
export function useMergePreview(
  guestId: string,
  targetId: string | null,
  kind: MergeKind = 'telegram',
) {
  return useQuery({
    queryKey: queryKeys.mergePreview(guestId, targetId ?? '', kind),
    queryFn: () =>
      kind === 'guest'
        ? mergeGuestsPreview(guestId, targetId ?? '')
        : mergePlayersPreview(guestId, targetId ?? ''),
    enabled: targetId !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Слияние гостя с Telegram-профилем или дубля гостя с другим профилем без Telegram: id гостя
 * пропадает из журналов, голосов и прогнозов — перечитываем всё (вечера, история клуба, справочник
 * игроков).
 */
export function useMergePlayers(kind: MergeKind = 'telegram') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guestId, targetId }: { guestId: string; targetId: string }) =>
      kind === 'guest' ? mergeGuests(guestId, targetId) : mergePlayers(guestId, targetId),
    meta: { silent: true }, // причину отказа показывает шторка привязки
    onSuccess: () => {
      // Предпросмотр слитой пары устарел навсегда (гостя нет) — убрать, а не перезапрашивать.
      queryClient.removeQueries({ queryKey: ['merge-preview'] });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'merge-preview',
      });
    },
  });
}

/** Своё имя для озвучки; обновляет список игроков, историю клуба и игрока в контексте входа. */
export function useSetMySpokenName() {
  const queryClient = useQueryClient();
  const { updatePlayer } = useAuth();
  return useMutation({
    mutationFn: (name: string) => setMySpokenName(name),
    meta: { silent: true }, // ошибку шторка показывает под полем
    onSuccess: (saved) => {
      updatePlayer({ spoken_name: saved });
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

/**
 * Свой режим «болельщик» (миграция 024); обновляет список игроков и игрока в контексте входа (вопрос
 * на главной, своя карточка, «Без ответа» у остальных).
 */
export function useSetMySpectator() {
  const queryClient = useQueryClient();
  const { updatePlayer } = useAuth();
  return useMutation({
    mutationFn: (spectator: boolean) => setMySpectator(spectator),
    onSuccess: (saved) => {
      updatePlayer({ is_spectator: saved });
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

/** Сменить своё имя; обновляет и список игроков, и игрока в контексте входа. */
export function useSetMyName() {
  const queryClient = useQueryClient();
  const { updatePlayer } = useAuth();
  return useMutation({
    mutationFn: (name: string) => setMyName(name),
    meta: { silent: true }, // ошибку («имя уже занято») RenameSheet показывает под полем
    onSuccess: (_void, name) => {
      // Сервер схлопывает пробелы так же (regexp_replace '\s+' → ' ', btrim).
      updatePlayer({ display_name: name.replace(/\s+/g, ' ').trim() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

// --- Настройка бота (Edge Function bot-setup, только админ) --------------------------------------

/** Бот по getMe. */
export interface BotInfo {
  username: string;
  name: string;
  canJoinGroups: boolean | null;
  canReadAllGroupMessages: boolean | null;
}

/** Группа, где бот сейчас состоит (по обновлениям бота за последние сутки + getChatMember). */
export interface BotChat {
  id: number;
  title: string;
  type: 'group' | 'supergroup';
  /** Статус бота в группе: member, administrator… */
  status: string;
}

const BOT_SETUP_EMPTY = 'Функция настройки бота вернула пустой ответ.';

/** Имя бота из Telegram (getMe) — для поля «Имя бота». */
export async function fetchBotInfo(): Promise<BotInfo> {
  const data = await invokeFunction<{ bot: BotInfo }>(
    'bot-setup',
    { action: 'me' },
    BOT_SETUP_EMPTY,
  );
  return data.bot;
}

/**
 * Группы, куда добавлен бот. Telegram хранит обновление о добавлении не дольше суток: группу,
 * куда бота добавили раньше и где с тех пор было тихо, не видно — бота надо удалить и добавить снова.
 */
export async function fetchBotChats(): Promise<BotChat[]> {
  const data = await invokeFunction<{ chats: BotChat[] }>(
    'bot-setup',
    { action: 'chats' },
    BOT_SETUP_EMPTY,
  );
  return data.chats;
}

/** Проверочный пост бота в группу. dryRun — локальный стек: пост только в логе функции. */
export async function sendBotTestMessage(chatId: number): Promise<{ dryRun: boolean }> {
  return invokeFunction<{ dryRun: boolean }>(
    'bot-setup',
    { action: 'test', chatId },
    BOT_SETUP_EMPTY,
  );
}

/** Кнопки админки «Клуб»: каждый вызов — по нажатию, без кеша (ответ Telegram меняется). */
export function useFetchBotInfo() {
  return useMutation({ mutationFn: fetchBotInfo });
}

export function useFetchBotChats() {
  return useMutation({ mutationFn: fetchBotChats });
}

export function useSendBotTestMessage() {
  return useMutation({ mutationFn: sendBotTestMessage });
}
