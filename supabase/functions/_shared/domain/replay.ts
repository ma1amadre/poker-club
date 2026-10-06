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
import type {
  BlindLevel,
  EveningEvent,
  EveningState,
  EventPayload,
  EventType,
  PlayerId,
  PlayerState,
  TournamentFormat,
} from './types.ts';

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
  s.totalChips = s.totalEntries * format.startingChips;
  s.prizePoolRub = s.totalEntries * (format.buyInRub - format.bountyRub);

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
    return readPayment(payload) === null ? 'Платёж: нужен игрок и ненулевая сумма в целых рублях' : null;
  }
  if (s.finished) return 'Вечер уже завершён';

  switch (type) {
    case 'join': {
      const id = readPlayerId(payload);
      if (id === null) return 'Не указан игрок';
      if (s.players[id]) return 'Игрок уже в турнире';
      if (!s.rebuysOpen) return 'Регистрация закрыта';
      return null;
    }
    case 'rebuy': {
      const id = readPlayerId(payload);
      if (id === null) return 'Не указан игрок';
      const p = s.players[id];
      if (!p) return 'Игрок не входил в турнир';
      if (p.alive) return 'Игрок ещё в игре — ребай только после вылета';
      if (!s.rebuysOpen) return 'Ребаи закрыты';
      if (format.rebuyLimit !== null && p.rebuys >= format.rebuyLimit) return 'Лимит ребаев исчерпан';
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
      return s.timer.status === 'running' ? null : 'Таймер не идёт';
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
      s.players[id] = {
        playerId: id,
        joinedAt: ev.at,
        entries: 1,
        rebuys: 0,
        alive: true,
        busts: 0,
        finalBustEventId: null,
        place: null,
        kos: 0,
        koVictims: [],
        bountyWonRub: 0,
        bustLevel: null,
      };
      s.joinOrder.push(id);
      return;
    }
    case 'rebuy': {
      const p = s.players[readPlayerId(payload) as PlayerId] as PlayerState;
      p.entries += 1;
      p.rebuys += 1;
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
      // Голова делится поровну в целых рублях, остаток — первому в списке. Пустой by —
      // голова «сиротская», её получит победитель (в money.ts), здесь не начисляем.
      const share = by.length > 0 ? Math.floor(format.bountyRub / by.length) : 0;
      const rest = format.bountyRub - share * by.length;
      by.forEach((k, i) => {
        const killer = s.players[k] as PlayerState;
        killer.kos += 1;
        killer.koVictims.push(id);
        killer.bountyWonRub += share + (i === 0 ? rest : 0);
      });
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
      enterLevel(s, 0, 0);
      return;
    case 'timer_pause':
      t.status = 'paused';
      return;
    case 'timer_resume':
      t.status = 'running';
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
      if (trig.type === 'hands' && t.handsInLevel >= trig.count && t.levelIndex < lastLevelIndex(format)) {
        enterLevel(s, t.levelIndex + 1, 0);
      }
      return;
    }
    case 'finish':
      s.finished = true;
      // Время после завершения не идёт; статус 'paused' — ближайший из контрактных.
      if (t.status === 'running') t.status = 'paused';
      return;
    case 'payment':
      // На состояние игры не влияет; платежи собирает money.paymentsFromEvents.
      return;
  }
}

export interface ReplayLog {
  state: EveningState;
  /** Принятые (не voided, без ошибок) события в порядке применения. */
  applied: EveningEvent[];
}

/** replay с журналом принятых событий — нужен summary для пар нокаутов. */
export function replayLog(
  format: TournamentFormat,
  events: readonly EveningEvent[],
  nowMs: number,
): ReplayLog {
  const s = initialState(format);
  const applied: EveningEvent[] = [];
  let clockMs: number | null = null;

  const tickTo = (ms: number): void => {
    // Время событий может слегка идти назад при конкурентных вставках — назад не считаем.
    if (clockMs !== null && ms > clockMs) runClock(format, s, ms - clockMs);
    if (clockMs === null || ms > clockMs) clockMs = ms;
  };

  const sorted = [...events].sort((a, b) => a.id - b.id);
  for (const ev of sorted) {
    if (ev.voided) continue;
    const atMs = Date.parse(ev.at);
    if (Number.isNaN(atMs)) {
      s.errors.push({ eventId: ev.id, message: 'Некорректное время события' });
      continue;
    }
    tickTo(atMs);
    refresh(format, s);
    const payload: unknown = ev.payload;
    const err = validate(format, s, ev.type, payload);
    if (err !== null) {
      s.errors.push({ eventId: ev.id, message: err });
      continue;
    }
    apply(format, s, ev, payload);
    applied.push(ev);
    refresh(format, s);
  }
  tickTo(nowMs);
  refresh(format, s);
  return { state: s, applied };
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
 * Можно ли сейчас добавить событие: текст ошибки или null.
 * `state` должен быть посчитан replay на тот же момент (фронт пересчитывает его раз в секунду);
 * `nowMs` оставлен по контракту — состояние не хранит свой момент, экстраполировать не из чего.
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
