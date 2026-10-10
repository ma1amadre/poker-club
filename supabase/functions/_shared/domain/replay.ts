// replay: состояние вечера из формата и журнала событий.
//
// Почему так устроено:
// - Одна функция валидации (validate) используется и при проигрывании журнала, и в canApply —
//   фронт отказывает в отправке ровно по тем же правилам, по которым replay отбросит событие.
// - Ошибочное событие не роняет replay: оно пропускается и попадает в state.errors. БД не
//   проверяет игровые правила (add_event — SQL), поэтому журнал может содержать мусор, и
//   экран вечера должен всё равно открываться.
// - Таймер считается из времени событий (`at`, серверное время), переход time-уровней не
//   хранится отдельным событием — его вычисляет replay, поэтому все экраны синхронны.
// - Правка записи на месте (миграция 022): поправка 'amend' ссылается на более раннюю запись
//   (вход, ребай — сумма; вылет — выбившие) и применяется В ПОЗИЦИИ исходной записи, а не в
//   своей: порядок мест, ребаи и уровни после неё не сдвигаются. Поправку принимает та же проверка,
//   что и исходную запись (validate в позиции исходной); в силе последняя принятая поправка записи,
//   отмена поправки возвращает предыдущую или исходное значение.
// - Деньги и фишки — по записям (миграция 027): у каждого входа и ребая своя сумма (readEntry), фонд —
//   сумма взносов. Записи без суммы (все до 027) читаются как раньше: кратность × вход формата.
import {
  AMENDABLE_EVENT_TYPES,
  MAX_ENTRY_RUB,
  MAX_ENTRY_STACKS,
  MAX_PAUSE_MINUTES,
  MAX_TIME_ADJUST_SECONDS,
  type AmendPayload,
  type BlindLevel,
  type EveningEvent,
  type EveningState,
  type EventPayload,
  type EventType,
  type PlayerId,
  type PlayerState,
  type TournamentFormat,
} from './types.ts';
import { readShowdown, readShowdownId } from './showdown.ts';

const MINUTE_MS = 60_000;

// Заглушка на случай формата без уровней (невалидный формат не должен ронять экран).
const EMPTY_LEVEL: BlindLevel = { sb: 0, bb: 0, trigger: { type: 'hands', count: 1 } };

function levelAt(format: TournamentFormat, index: number): BlindLevel {
  return format.levels[index] ?? format.levels[format.levels.length - 1] ?? EMPTY_LEVEL;
}

function lastLevelIndex(format: TournamentFormat): number {
  return Math.max(0, format.levels.length - 1);
}

/** Длительность time-уровня в мс; null — уровень не по времени (или длительность некорректна). */
function levelDurationMs(level: BlindLevel): number | null {
  if (level.trigger.type !== 'time') return null;
  const ms = level.trigger.minutes * MINUTE_MS;
  // Неположительная длительность дала бы бесконечный цикл авто-перехода.
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// ---------- разбор payload (приходит из jsonb, доверять типам нельзя) ----------

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function readPlayerId(payload: unknown): PlayerId | null {
  const id = asRecord(payload).playerId;
  return typeof id === 'string' && id !== '' ? id : null;
}

function readBy(payload: unknown): PlayerId[] | null {
  const by = asRecord(payload).by;
  if (!Array.isArray(by)) return null;
  const list: unknown[] = by;
  return list.every((x) => typeof x === 'string' && x !== '') ? (list as PlayerId[]) : null;
}

/**
 * Кратность входа или ребая из payload: нет поля — 1 (события до кратных входов), иначе целое
 * 1..MAX_ENTRY_STACKS; null — значение некорректно (replay отбросит событие с ошибкой).
 */
export function readStacks(payload: unknown): number | null {
  const record = asRecord(payload);
  if (!('stacks' in record) || record.stacks === undefined) return 1;
  const k = record.stacks;
  return typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= MAX_ENTRY_STACKS ? k : null;
}

const STACKS_ERROR = `Кратность входа — целое число от 1 до ${MAX_ENTRY_STACKS}`;

/** Сумма входа или ребая годится: целое число рублей 1..MAX_ENTRY_RUB. */
export function isEntryRub(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ENTRY_RUB
  );
}

/** «100 000» с неразрывным пробелом — верхняя граница суммы в тексте отказа (без Intl в домене). */
function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Отказ суммы входа или ребая (тот же текст — у RPC, миграция 027). */
export const ENTRY_RUB_ERROR = `Сумма входа или ребая — целое число рублей от 1 до ${groupDigits(MAX_ENTRY_RUB)}`;

const ENTRY_BOTH_ERROR = 'Вход: нужна сумма или кратность — что-то одно';

/** Во что обходится вход или ребай: взнос (весь — в фонд) и фишки. */
export interface EntryValue {
  rub: number;
  chips: number;
}

/**
 * Фишки за сумму входа по курсу формата: startingChips фишек за buyInRub, до целого (половина —
 * вверх). Вход 700 ₽ при 500 ₽ = 500 фишек — 700 фишек. Формат без курса (вход 0) — 0 фишек: экран
 * невалидного формата не должен падать.
 */
export function chipsForRub(
  format: Pick<TournamentFormat, 'buyInRub' | 'startingChips'>,
  rub: number,
): number {
  if (!(format.buyInRub > 0) || !Number.isFinite(format.startingChips)) return 0;
  return Math.round((rub * format.startingChips) / format.buyInRub);
}

/** Причина, по которой payload входа или ребая несёт неверную сумму; null — сумма годна. */
function entryError(payload: unknown): string | null {
  const record = asRecord(payload);
  const hasRub = 'rub' in record && record.rub !== undefined;
  const hasStacks = 'stacks' in record && record.stacks !== undefined;
  if (hasRub && hasStacks) return ENTRY_BOTH_ERROR;
  if (hasRub) return isEntryRub(record.rub) ? null : ENTRY_RUB_ERROR;
  return readStacks(record) === null ? STACKS_ERROR : null;
}

/**
 * Взнос и фишки входа или ребая из payload. rub (027) — сумма записи, фишки по курсу формата;
 * stacks (015) — кратность: buyInRub·k и startingChips·k; ни того ни другого — стандартный вход.
 * null — сумма или кратность некорректны либо указаны обе (replay отбросит запись с ошибкой).
 */
export function readEntry(format: TournamentFormat, payload: unknown): EntryValue | null {
  if (entryError(payload) !== null) return null;
  const record = asRecord(payload);
  if ('rub' in record && record.rub !== undefined) {
    const rub = record.rub as number;
    return { rub, chips: chipsForRub(format, rub) };
  }
  const k = readStacks(record) as number;
  return { rub: format.buyInRub * k, chips: format.startingChips * k };
}

/**
 * Пауза из payload timer_pause: minutes — длительность перерыва, null — без срока (нет поля, как у
 * всех пауз до миграции 022); null вместо объекта — значение некорректно.
 */
export function readPause(payload: unknown): { minutes: number | null } | null {
  const record = asRecord(payload);
  if (!('minutes' in record) || record.minutes === undefined) return { minutes: null };
  const m = record.minutes;
  return typeof m === 'number' && Number.isInteger(m) && m >= 1 && m <= MAX_PAUSE_MINUTES
    ? { minutes: m }
    : null;
}

const PAUSE_ERROR = `Пауза: длительность — целое число минут от 1 до ${MAX_PAUSE_MINUTES}`;

/** Поправка остатка уровня из payload time_adjust, секунд (±), или null — значение некорректно. */
export function readTimeAdjust(payload: unknown): number | null {
  const s = asRecord(payload).seconds;
  return typeof s === 'number' &&
    Number.isInteger(s) &&
    s !== 0 &&
    Math.abs(s) <= MAX_TIME_ADJUST_SECONDS
    ? s
    : null;
}

const TIME_ADJUST_ERROR = `Поправка времени — целое число секунд, не ноль и не больше ${MAX_TIME_ADJUST_SECONDS} по модулю`;

/**
 * Поправка из payload amend: id исправляемой записи и ровно одно новое значение — rub (сумма входа
 * или ребая, 027), stacks (кратность, правки 022–026) или by (вылет). null — форма неверна. Есть ли
 * такая запись и подходит ли значение к ней, решает replay по журналу.
 */
export function readAmend(payload: unknown): AmendPayload | null {
  const record = asRecord(payload);
  const id = record.eventId;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  const has = (key: string): boolean => key in record && record[key] !== undefined;
  const fields = ['rub', 'stacks', 'by'].filter(has);
  if (fields.length !== 1) return null;
  if (has('rub')) return isEntryRub(record.rub) ? { eventId: id, rub: record.rub } : null;
  if (has('stacks')) {
    const k = readStacks(record);
    return k === null ? null : { eventId: id, stacks: k };
  }
  const by = readBy(record);
  return by === null ? null : { eventId: id, by: [...by] };
}

const AMEND_SHAPE_ERROR =
  'Правка: нужна исправляемая запись и одно новое значение — сумма или выбившие';

/** Платёж из payload или null, если payload некорректен. Используется и в money.ts. */
export function readPayment(payload: unknown): { playerId: PlayerId; amountRub: number } | null {
  const playerId = readPlayerId(payload);
  const amount = asRecord(payload).amountRub;
  if (playerId === null) return null;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount === 0) return null;
  return { playerId, amountRub: amount };
}

// ---------- рабочее состояние ----------

function initialState(format: TournamentFormat): EveningState {
  return {
    players: {},
    joinOrder: [],
    timer: {
      status: 'not_started',
      levelIndex: 0,
      levelElapsedMs: 0,
      levelRemainingMs: levelDurationMs(levelAt(format, 0)),
      handsInLevel: 0,
      bustsInLevel: 0,
      totalElapsedMs: 0,
      pause: null,
    },
    currentLevel: levelAt(format, 0),
    nextLevel: format.levels.length > 1 ? levelAt(format, 1) : null,
    rebuysOpen: true,
    aliveCount: 0,
    totalEntries: 0,
    totalChips: 0,
    prizePoolRub: 0,
    finished: false,
    places: [],
    firstBustPlayerId: null,
    showdown: null,
    errors: [],
  };
}

function enterLevel(s: EveningState, index: number, carryMs: number): void {
  s.timer.levelIndex = index;
  s.timer.levelElapsedMs = carryMs;
  s.timer.handsInLevel = 0;
  s.timer.bustsInLevel = 0;
}

/** Отсчитать deltaMs игрового времени (только в running) с авто-переходом time-уровней. */
function runClock(format: TournamentFormat, s: EveningState, deltaMs: number): void {
  if (s.timer.status !== 'running' || deltaMs <= 0) return;
  s.timer.totalElapsedMs += deltaMs;
  s.timer.levelElapsedMs += deltaMs;
  // Цикл ограничен числом уровней: каждый шаг увеличивает levelIndex.
  while (s.timer.levelIndex < lastLevelIndex(format)) {
    const dur = levelDurationMs(levelAt(format, s.timer.levelIndex));
    if (dur === null || s.timer.levelElapsedMs < dur) break;
    // Лишнее время переносится в следующий уровень.
    enterLevel(s, s.timer.levelIndex + 1, s.timer.levelElapsedMs - dur);
  }
}

/** Пересчитать всё производное после изменения журнала или времени. */
function refresh(format: TournamentFormat, s: EveningState): void {
  const t = s.timer;
  s.currentLevel = levelAt(format, t.levelIndex);
  s.nextLevel = t.levelIndex < format.levels.length - 1 ? levelAt(format, t.levelIndex + 1) : null;
  const dur = levelDurationMs(s.currentLevel);
  t.levelRemainingMs = dur === null ? null : Math.max(0, dur - t.levelElapsedMs);

  s.rebuysOpen =
    !s.finished && (t.status === 'not_started' || t.levelIndex + 1 <= format.rebuyUntilLevel);

  const list = s.joinOrder.map((id) => s.players[id]).filter((p): p is PlayerState => !!p);
  s.aliveCount = list.filter((p) => p.alive).length;
  s.totalEntries = list.reduce((sum, p) => sum + p.entries, 0);
  // Деньги и фишки — по записям (у каждого входа и ребая своя сумма). Весь взнос — в фонд.
  s.totalChips = list.reduce((sum, p) => sum + p.chips, 0);
  s.prizePoolRub = list.reduce((sum, p) => sum + p.feeRub, 0);

  for (const p of list) p.place = null;
  s.places = [];
  // Вылетевшие в порядке «последний вылет — выше»: finalBustEventId растёт со временем.
  const dead = list
    .filter((p) => !p.alive)
    .sort((a, b) => (b.finalBustEventId ?? 0) - (a.finalBustEventId ?? 0));
  if (s.finished) {
    const winner = list.find((p) => p.alive);
    if (winner) {
      winner.place = 1;
      s.places = [winner.playerId, ...dead.map((p) => p.playerId)];
      dead.forEach((p, i) => (p.place = i + 2));
    }
  } else if (!s.rebuysOpen) {
    // Ребаи закрыты: каждый вылет окончательный, и места уже вылетевших не изменятся —
    // все будущие вылеты будут выше них.
    dead.forEach((p, i) => (p.place = s.aliveCount + 1 + i));
  }
}

// ---------- правила ----------

function validate(
  format: TournamentFormat,
  s: EveningState,
  type: EventType,
  payload: unknown,
): string | null {
  // Деньги через банкира ходят и до, и после завершения вечера (взнос при входе, выплата после).
  if (type === 'payment') {
    return readPayment(payload) === null
      ? 'Платёж: нужен игрок и ненулевая сумма в целых рублях'
      : null;
  }
  // Поправка встаёт на место исходной записи, поэтому законна и после завершения (правка закрытого
  // вечера — админ). Здесь — форма; есть ли запись и подходит ли к ней значение — в replayLog.
  if (type === 'amend') return readAmend(payload) === null ? AMEND_SHAPE_ERROR : null;
  if (s.finished) return 'Вечер уже завершён';

  switch (type) {
    case 'join': {
      const id = readPlayerId(payload);
      if (id === null) return 'Не указан игрок';
      const entryErr = entryError(payload);
      if (entryErr !== null) return entryErr;
      if (s.players[id]) return 'Игрок уже в турнире';
      if (!s.rebuysOpen) return 'Регистрация закрыта';
      return null;
    }
    case 'rebuy': {
      const id = readPlayerId(payload);
      if (id === null) return 'Не указан игрок';
      const entryErr = entryError(payload);
      if (entryErr !== null) return entryErr;
      const p = s.players[id];
      if (!p) return 'Игрок не входил в турнир';
      if (p.alive) return 'Игрок ещё в игре — ребай только после вылета';
      if (!s.rebuysOpen) return 'Ребаи закрыты';
      if (format.rebuyLimit !== null && p.rebuys >= format.rebuyLimit)
        return 'Лимит ребаев исчерпан';
      return null;
    }
    case 'bust': {
      const id = readPlayerId(payload);
      if (id === null) return 'Не указан игрок';
      const by = readBy(payload);
      if (by === null) return 'Не указано, кто выбил (пустой список — если никто)';
      const p = s.players[id];
      if (!p) return 'Игрок не входил в турнир';
      if (!p.alive) return 'Игрок уже выбыл';
      if (new Set(by).size !== by.length) return 'Игрок повторяется в списке выбивших';
      for (const k of by) {
        if (k === id) return 'Игрок не может выбить сам себя';
        if (!s.players[k]?.alive) return 'Выбить может только игрок, который сейчас в игре';
      }
      if (s.aliveCount <= 1) return 'Нельзя выбить последнего игрока';
      return null;
    }
    case 'timer_start':
      return s.timer.status === 'not_started' ? null : 'Таймер уже запущен';
    case 'timer_pause':
      if (readPause(payload) === null) return PAUSE_ERROR;
      return s.timer.status === 'running' ? null : 'Таймер не идёт';
    case 'time_adjust': {
      const seconds = readTimeAdjust(payload);
      if (seconds === null) return TIME_ADJUST_ERROR;
      if (s.timer.status === 'not_started') return 'Таймер не запущен';
      const dur = levelDurationMs(s.currentLevel);
      if (dur === null) return 'Уровень не по времени — поправлять нечего';
      if (s.nextLevel === null) return 'Последний уровень сам не кончается — поправлять нечего';
      const after = dur - s.timer.levelElapsedMs + seconds * 1000;
      // Ноль — это переход уровня: для него есть «Уровень вперёд», поправка его не делает.
      if (after <= 0)
        return 'Убавить нельзя: уровень бы закончился — для этого есть «Уровень вперёд»';
      if (after > dur) return 'Прибавить нельзя: остаток стал бы больше длины уровня';
      return null;
    }
    case 'timer_resume':
      return s.timer.status === 'paused' ? null : 'Таймер не на паузе';
    case 'level_next':
      if (s.timer.status === 'not_started') return 'Таймер не запущен';
      return s.timer.levelIndex < format.levels.length - 1 ? null : 'Это последний уровень';
    case 'level_prev':
      if (s.timer.status === 'not_started') return 'Таймер не запущен';
      return s.timer.levelIndex > 0 ? null : 'Это первый уровень';
    case 'hand':
      return s.timer.status === 'not_started' ? 'Таймер не запущен' : null;
    case 'finish':
      return s.aliveCount === 1 ? null : 'Завершить можно, когда в игре остался один игрок';
    case 'showdown': {
      const read = readShowdown(payload);
      if (!read.ok) return read.error;
      // Новая раздача — только из тех, кто в игре. Правка открытой может оставить в ней и того,
      // кто уже вылетел: олл-ин вводят до вылета, а опечатку в карте замечают и после него.
      const prev = s.showdown?.showdownId === read.value.showdownId ? s.showdown : null;
      for (const hand of read.value.hands) {
        const p = s.players[hand.playerId];
        if (!p) return 'Олл-ин: игрок не входил в турнир';
        if (!p.alive && !prev?.hands.some((h) => h.playerId === hand.playerId))
          return 'Олл-ин: игрок уже выбыл — в раздачу берутся только те, кто в игре';
      }
      return null;
    }
    case 'showdown_close': {
      const id = readShowdownId(payload);
      if (id === null) return 'Олл-ин: нет id раздачи';
      return s.showdown?.showdownId === id ? null : 'Эта раздача олл-ина уже закрыта';
    }
    default:
      return 'Неизвестный тип события';
  }
}

function apply(
  format: TournamentFormat,
  s: EveningState,
  ev: EveningEvent,
  payload: unknown,
): void {
  const t = s.timer;
  switch (ev.type) {
    case 'join': {
      const id = readPlayerId(payload) as PlayerId;
      const entry = readEntry(format, payload) as EntryValue;
      s.players[id] = {
        playerId: id,
        joinedAt: ev.at,
        entries: 1,
        rebuys: 0,
        feeRub: entry.rub,
        chips: entry.chips,
        alive: true,
        busts: 0,
        finalBustEventId: null,
        place: null,
        kos: 0,
        koVictims: [],
        bustLevel: null,
      };
      s.joinOrder.push(id);
      return;
    }
    case 'rebuy': {
      const p = s.players[readPlayerId(payload) as PlayerId] as PlayerState;
      const entry = readEntry(format, payload) as EntryValue;
      p.entries += 1;
      p.rebuys += 1;
      p.feeRub += entry.rub;
      p.chips += entry.chips;
      p.alive = true;
      p.finalBustEventId = null;
      p.bustLevel = null;
      return;
    }
    case 'bust': {
      const id = readPlayerId(payload) as PlayerId;
      const by = readBy(payload) as PlayerId[];
      const p = s.players[id] as PlayerState;
      p.alive = false;
      p.busts += 1;
      p.finalBustEventId = ev.id;
      p.bustLevel = t.levelIndex + 1;
      if (s.firstBustPlayerId === null) s.firstBustPlayerId = id;
      // Нокаут — только статистика (денег за голову нет с 07.10.2026): при дележе он засчитывается
      // каждому из by, пустой by — нокаут никому.
      for (const k of by) {
        const killer = s.players[k] as PlayerState;
        killer.kos += 1;
        killer.koVictims.push(id);
      }
      if (t.status !== 'not_started') {
        t.bustsInLevel += 1;
        const trig = levelAt(format, t.levelIndex).trigger;
        if (
          trig.type === 'eliminations' &&
          t.bustsInLevel >= trig.count &&
          t.levelIndex < lastLevelIndex(format)
        ) {
          enterLevel(s, t.levelIndex + 1, 0);
        }
      }
      return;
    }
    case 'timer_start':
      t.status = 'running';
      t.pause = null;
      enterLevel(s, 0, 0);
      return;
    case 'timer_pause':
      t.status = 'paused';
      t.pause = { eventId: ev.id, at: ev.at, minutes: readPause(payload)?.minutes ?? null };
      return;
    case 'timer_resume':
      t.status = 'running';
      t.pause = null;
      return;
    case 'time_adjust':
      // Остаток уровня = длина − прошедшее: прибавить к остатку — убавить прошедшее. Границы
      // проверил validate: уровень не кончится и не станет длиннее себя. Игровое время не меняется.
      t.levelElapsedMs -= (readTimeAdjust(payload) as number) * 1000;
      return;
    case 'amend':
      // В своей позиции поправка ничего не меняет: она применена в позиции исходной записи.
      return;
    case 'level_next':
      enterLevel(s, t.levelIndex + 1, 0);
      return;
    case 'level_prev':
      enterLevel(s, t.levelIndex - 1, 0);
      return;
    case 'hand': {
      t.handsInLevel += 1;
      const trig = levelAt(format, t.levelIndex).trigger;
      if (
        trig.type === 'hands' &&
        t.handsInLevel >= trig.count &&
        t.levelIndex < lastLevelIndex(format)
      ) {
        enterLevel(s, t.levelIndex + 1, 0);
      }
      return;
    }
    case 'finish':
      s.finished = true;
      // Время после завершения не идёт; статус 'paused' — ближайший из контрактных.
      if (t.status === 'running') t.status = 'paused';
      // Игра окончена — «продолжаем через» не о чем.
      t.pause = null;
      // Итог вечера важнее последней раздачи: финиш закрывает олл-ин (отмена финиша вернёт его).
      s.showdown = null;
      return;
    case 'payment':
      // На состояние игры не влияет; платежи собирает money.paymentsFromEvents.
      return;
    case 'showdown': {
      // Только показ: игроков, деньги и таймер раздача не трогает.
      const read = readShowdown(payload);
      if (!read.ok) return;
      const prev = s.showdown?.showdownId === read.value.showdownId ? s.showdown : null;
      s.showdown = {
        ...read.value,
        openedEventId: prev?.openedEventId ?? ev.id,
        openedAt: prev?.openedAt ?? ev.at,
        eventId: ev.id,
        updatedAt: ev.at,
      };
      return;
    }
    case 'showdown_close':
      s.showdown = null;
      return;
  }
}

export interface ReplayLog {
  state: EveningState;
  /**
   * Принятые (не voided, без ошибок) события в порядке применения. Исправленная запись — на своём
   * месте и с payload, как его применил replay (с поправкой в силе); принятые поправки — тоже здесь,
   * в своих позициях (на состояние там они не влияют).
   */
  applied: EveningEvent[];
  /** id исправленной записи → id поправки, которая в силе (последняя принятая). */
  amended: Map<number, number>;
}

const AMEND_TARGET_TYPES: ReadonlySet<EventType> = new Set(AMENDABLE_EVENT_TYPES);

/** Первая буква строчная: причина отказа исходной записи встаёт внутрь фразы. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * payload исходной записи с новым значением поправки. Сумма и кратность взаимно исключают друг друга:
 * правка суммы убирает из записи кратность, правка кратности (022–026) — сумму. Лента пульта берёт
 * ту же функцию для подписи «было».
 */
export function amendedPayload(
  target: Pick<EveningEvent, 'payload'>,
  patch: AmendPayload,
): EventPayload {
  const base = asRecord(target.payload);
  const { rub: _rub, stacks: _stacks, ...rest } = base;
  const next =
    'by' in patch
      ? { ...base, by: [...patch.by] }
      : 'rub' in patch
        ? { ...rest, rub: patch.rub }
        : { ...rest, stacks: patch.stacks };
  return next as unknown as EventPayload;
}

interface AmendCandidate {
  event: EveningEvent;
  patch: AmendPayload;
}

/**
 * Поправки журнала по исправляемым записям (в порядке id) и отказы по форме: запись не найдена,
 * отменена, не раньше поправки, не того типа, значение не к той записи.
 */
function collectAmends(sorted: readonly EveningEvent[]): {
  byTarget: Map<number, AmendCandidate[]>;
  errors: Map<number, string>;
} {
  const byId = new Map(sorted.map((e) => [e.id, e]));
  const byTarget = new Map<number, AmendCandidate[]>();
  const errors = new Map<number, string>();
  for (const ev of sorted) {
    if (ev.voided || ev.type !== 'amend') continue;
    const patch = readAmend(ev.payload);
    const target = patch ? byId.get(patch.eventId) : undefined;
    let error: string | null = null;
    if (patch === null) error = AMEND_SHAPE_ERROR;
    else if (!target) error = 'Правка: исправляемой записи нет в журнале';
    else if (target.id >= ev.id) error = 'Правка: исправить можно только более раннюю запись';
    else if (target.voided) error = 'Правка: исправляемая запись отменена';
    else if (!AMEND_TARGET_TYPES.has(target.type))
      error = 'Правка: исправить можно только вход, ребай или вылет';
    else if (target.type === 'bust' && !('by' in patch))
      error = 'Правка: у вылета исправляются выбившие, а не сумма';
    else if (target.type !== 'bust' && 'by' in patch)
      error = 'Правка: у входа и ребая исправляется сумма, а не выбившие';
    if (error !== null || patch === null || !target) {
      errors.set(ev.id, error ?? AMEND_SHAPE_ERROR);
      continue;
    }
    const list = byTarget.get(target.id) ?? [];
    list.push({ event: ev, patch });
    byTarget.set(target.id, list);
  }
  return { byTarget, errors };
}

/** replay с журналом принятых событий — нужен summary для пар нокаутов. */
export function replayLog(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  nowMs: number,
): ReplayLog {
  const s = initialState(format);
  const applied: EveningEvent[] = [];
  const amended = new Map<number, number>();
  let clockMs: number | null = null;

  const tickTo = (ms: number): void => {
    // Время событий может слегка идти назад при конкурентных вставках — назад не считаем.
    if (clockMs !== null && ms > clockMs) runClock(format, s, ms - clockMs);
    if (clockMs === null || ms > clockMs) clockMs = ms;
  };

  const sorted = [...events].sort((a, b) => a.id - b.id);
  const amends = collectAmends(sorted);
  // Решение по поправке принимается в позиции исходной записи: null — принята, текст — отказ.
  const amendVerdict = new Map<number, string | null>(amends.errors);
  for (const ev of sorted) {
    if (ev.voided) continue;
    const atMs = Date.parse(ev.at);
    if (Number.isNaN(atMs)) {
      s.errors.push({ eventId: ev.id, message: 'Некорректное время события' });
      continue;
    }
    tickTo(atMs);
    refresh(format, s);

    if (ev.type === 'amend') {
      // Решения нет — исправляемая запись так и не дошла до проверки (например, её время сломано).
      const verdict = amendVerdict.has(ev.id)
        ? (amendVerdict.get(ev.id) ?? null)
        : 'Правка: исправляемая запись не принята журналом';
      if (verdict !== null) s.errors.push({ eventId: ev.id, message: verdict });
      else applied.push(ev);
      continue;
    }

    // Исправленная запись: каждая поправка проверяется здесь, в позиции исходной, теми же
    // правилами; в силе — последняя принятая. Ни одной принятой — запись остаётся как была.
    let effective = ev;
    for (const c of amends.byTarget.get(ev.id) ?? []) {
      const amendedEv = { ...ev, payload: amendedPayload(ev, c.patch) };
      const amendErr = validate(format, s, ev.type, amendedEv.payload);
      amendVerdict.set(
        c.event.id,
        amendErr === null ? null : `Правка не подходит: ${lowerFirst(amendErr)}`,
      );
      if (amendErr === null) {
        effective = amendedEv;
        amended.set(ev.id, c.event.id);
      }
    }

    const payload: unknown = effective.payload;
    const err = validate(format, s, ev.type, payload);
    if (err !== null) {
      s.errors.push({ eventId: ev.id, message: err });
      continue;
    }
    apply(format, s, effective, payload);
    applied.push(effective);
    refresh(format, s);
  }
  tickTo(nowMs);
  refresh(format, s);
  return { state: s, applied, amended };
}

/** Состояние вечера на момент nowMs. */
export function replay(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  nowMs: number,
): EveningState {
  return replayLog(format, events, nowMs).state;
}

/**
 * Сколько осталось до конца перерыва (пауза с длительностью, миграция 022), мс: меньше нуля — срок
 * вышел, пора продолжать (таймер сам не продолжает — только банкир). null — не пауза, пауза без
 * срока или вечер завершён. nowMs — серверное «сейчас», как у replay.
 */
export function pauseLeftMs(state: EveningState, nowMs: number): number | null {
  const pause = state.timer.pause;
  if (state.finished || state.timer.status !== 'paused' || !pause || pause.minutes === null)
    return null;
  const at = Date.parse(pause.at);
  return Number.isFinite(at) ? at + pause.minutes * MINUTE_MS - nowMs : null;
}

/**
 * Можно ли сейчас добавить событие: текст ошибки или null.
 * `state` должен быть посчитан replay на тот же момент (фронт пересчитывает его раз в секунду);
 * `nowMs` оставлен по контракту — состояние не хранит свой момент, экстраполировать не из чего.
 * Поправку ('amend') state проверить не может — только её форму; целиком её проверяет
 * canApplySequence по журналу (canAmend в amend.ts).
 */
export function canApply(
  format: TournamentFormat,
  state: EveningState,
  type: EventType,
  payload: EventPayload,
  _nowMs: number,
): string | null {
  return validate(format, state, type, payload);
}

/** Запись, которую пульт собирается отправить: тип и payload, без id и времени. */
export interface EventDraft {
  type: EventType;
  payload: EventPayload;
}

/**
 * Можно ли сейчас записать несколько событий подряд одним действием (вылет и ребай, вход и
 * оплата): журнал проигрывается до nowMs, затем черновики применяются по порядку — каждый к
 * состоянию после предыдущего, теми же правилами, что replay. Ответ — первая отказная запись
 * (индекс в drafts и текст) или null. Пустой список — null.
 */
export function canApplySequence(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  drafts: readonly EventDraft[],
  nowMs: number,
): { index: number; message: string } | null {
  if (drafts.length === 0) return null;
  const lastId = events.reduce((m, e) => Math.max(m, e.id), 0);
  const at = new Date(nowMs).toISOString();
  const tail: EveningEvent[] = drafts.map((d, i) => ({
    id: lastId + 1 + i,
    type: d.type,
    payload: d.payload,
    at,
    voided: false,
  }));
  const { state } = replayLog(format, [...events, ...tail], nowMs);
  for (const [index, ev] of tail.entries()) {
    const error = state.errors.find((e) => e.eventId === ev.id);
    if (error) return { index, message: error.message };
  }
  return null;
}
