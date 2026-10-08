// Базовые типы домена. Вечер хранится как журнал событий, всё остальное вычисляется из него
// функцией replay — поэтому здесь только форма данных, без логики.

export type PlayerId = string; // uuid players.id

export type LevelTrigger =
  | { type: 'time'; minutes: number }
  | { type: 'eliminations'; count: number } // уровень растёт после N вылетов С НАЧАЛА уровня
  | { type: 'hands'; count: number }; // после N событий 'hand' с начала уровня

export interface BlindLevel {
  sb: number;
  bb: number;
  ante?: number;
  trigger: LevelTrigger;
}

export interface TournamentFormat {
  name: string;
  buyInRub: number; // 500 — цена входа и ребая (стандартного; вход ×k стоит buyInRub·k), весь взнос — в фонд
  startingChips: number; // 500 — фишек за вход и за ребай (×k — startingChips·k)
  // Баунти «за голову» убрано 07.10.2026: в старых форматах (jsonb) поле bountyRub бывает — его
  // никто не читает, миграция 018 его вычищает.
  rebuyUntilLevel: number; // 5 — вход/ребай разрешён, пока номер текущего уровня (с 1) <= этого
  rebuyLimit: number | null; // null = без лимита (решение клуба)
  payoutPct: number[]; // [70, 30]
  levels: BlindLevel[]; // после последнего уровня блайнды остаются последними
}

export type EventType =
  | 'join'
  | 'rebuy'
  | 'bust'
  | 'timer_start'
  | 'timer_pause'
  | 'timer_resume'
  | 'level_next'
  | 'level_prev'
  | 'hand'
  | 'payment'
  | 'finish'
  | 'showdown'
  | 'showdown_close'
  | 'amend'
  | 'time_adjust';

export const EVENT_TYPES: readonly EventType[] = [
  'join',
  'rebuy',
  'bust',
  'timer_start',
  'timer_pause',
  'timer_resume',
  'level_next',
  'level_prev',
  'hand',
  'payment',
  'finish',
  'showdown',
  'showdown_close',
  'amend',
  'time_adjust',
];

/**
 * Показ олл-ина на табло (миграция 017): карты участников и стола. На игру, деньги, места, очки и
 * итоги не влияют — replay только держит текущую раздачу в state.showdown.
 */
export const SHOWDOWN_EVENT_TYPES: readonly EventType[] = ['showdown', 'showdown_close'];

/** Карта в нотации 'As', 'Td', '9h': ранг 2–9TJQKA, масть s ♠, h ♥, d ♦, c ♣. */
export type CardCode = string;

// Псевдонимы типов, а не interface: payload уходит в RPC как Json (у interface нет индексной подписи).
export type ShowdownHand = {
  playerId: PlayerId;
  cards: [CardCode, CardCode];
};

/** payload 'showdown': полное состояние раздачи (каждая правка пишет всё заново). */
export type ShowdownPayload = {
  showdownId: string; // uuid раздачи — один на олл-ин, общий у всех его правок
  hands: ShowdownHand[]; // 2..9 рук, порядок — порядок показа
  board: CardCode[]; // 0, 3, 4 или 5 карт
};

/** Открытая раздача олл-ина: последняя принятая версия и когда её открыли и правили. */
export type ShowdownState = ShowdownPayload & {
  openedEventId: number; // первое принятое событие этой раздачи
  eventId: number; // последнее принятое — текущая версия
  openedAt: string;
  updatedAt: string; // `at` последней правки: от него табло считает, когда спрятать раздачу
};

/** Наибольшая кратность входа или ребая (stacks в payload join/rebuy). */
export const MAX_ENTRY_STACKS = 10;

/**
 * Правка записи на месте (миграция 022): какие записи можно исправить поправкой 'amend'. Вход и
 * ребай — кратность (stacks), вылет — выбивших (by). Поправка встаёт на место исходной записи.
 */
export const AMENDABLE_EVENT_TYPES: readonly EventType[] = ['join', 'rebuy', 'bust'];

/**
 * payload 'amend': ссылка на исправляемую запись этого вечера (id меньше id поправки) и ровно одно
 * новое значение: stacks — у входа и ребая (целое 1..MAX_ENTRY_STACKS, хранится и 1), by — у вылета
 * (кто выбил, 0..n). replay применяет поправку в позиции исходной записи; последняя принятая
 * поправка записи — в силе, отмена поправки возвращает предыдущую (или исходную запись).
 */
export type AmendPayload =
  | { eventId: number; stacks: number } // join, rebuy
  | { eventId: number; by: PlayerId[] }; // bust

/** Наибольшая длительность паузы с отсчётом (payload timer_pause.minutes), минут. */
export const MAX_PAUSE_MINUTES = 120;

/**
 * Длительности перерыва, которые предлагает пульт. Для них фраза «Перерыв N минут.» озвучена
 * заранее (FIXED_TEXTS голоса); другую длительность табло объявит коротким «Пауза.».
 */
export const PAUSE_MINUTES_OPTIONS: readonly number[] = [5, 10, 15, 20, 30];

/**
 * payload 'timer_pause' (миграция 022): minutes — на сколько перерыв (целое 1..MAX_PAUSE_MINUTES),
 * нет поля — пауза без срока (так выглядят все паузы до 022). Таймер сам не продолжает: по истечении
 * экраны только зовут продолжить.
 */
export type PausePayload = { minutes?: number };

/** Наибольшая поправка остатка уровня одним событием 'time_adjust', секунд (по модулю). */
export const MAX_TIME_ADJUST_SECONDS = 3600;

/**
 * payload 'time_adjust' (миграция 022): seconds — сколько прибавить к остатку текущего уровня
 * (минус — убавить), целое, не 0, по модулю до MAX_TIME_ADJUST_SECONDS. Только уровень по времени,
 * не последний; остаток после поправки — больше нуля и не больше длины уровня.
 */
export type TimeAdjustPayload = { seconds: number };

export type EventPayload =
  // join, rebuy; stacks — кратность входа: целое 1..MAX_ENTRY_STACKS, нет поля = 1 (старые события).
  // Вход ×k: взнос buyInRub·k (весь — в призовой фонд), фишки startingChips·k.
  | { playerId: PlayerId; stacks?: number }
  | { playerId: PlayerId; by: PlayerId[] } // bust; by = кто выбил (0..n)
  | { playerId: PlayerId; amountRub: number; note?: string } // payment: + игрок→банкир, − банкир→игрок
  | ShowdownPayload // showdown
  | { showdownId: string } // showdown_close
  | AmendPayload // amend (022)
  | PausePayload // timer_pause: { minutes? } (022)
  | TimeAdjustPayload // time_adjust (022)
  | Record<string, never>; // timer_start, timer_resume, level_*, hand, finish

export interface EveningEvent {
  id: number;
  type: EventType;
  payload: EventPayload;
  at: string; // ISO, серверное время вставки
  voided: boolean; // voided-события replay игнорирует
}

export interface PlayerState {
  playerId: PlayerId;
  joinedAt: string;
  entries: number; // вход + ребаи (штук, без учёта кратности)
  rebuys: number;
  stacks: number; // сумма кратностей входа и ребаев: взнос = stacks × buyInRub
  alive: boolean;
  busts: number; // все вылеты, включая те, после которых был ребай
  finalBustEventId: number | null; // последний bust, если после него не было ребая
  place: number | null; // известно после finish или для вылетевших после закрытия ребаев
  kos: number;
  koVictims: PlayerId[]; // по одному элементу на каждый нокаут, в порядке событий
  bustLevel: number | null; // номер уровня (с 1) окончательного вылета
}

/** Пауза таймера (миграция 022): какая запись её поставила, когда и на сколько. */
export interface PauseState {
  eventId: number; // принятый timer_pause
  at: string; // его `at` — серверное время начала паузы
  minutes: number | null; // длительность перерыва; null — пауза без срока
}

export interface TimerState {
  status: 'not_started' | 'running' | 'paused';
  levelIndex: number; // 0-based
  levelElapsedMs: number;
  levelRemainingMs: number | null; // null для не-time триггеров
  handsInLevel: number;
  bustsInLevel: number;
  totalElapsedMs: number; // чистое игровое время без пауз
  // Текущая пауза (status 'paused', вечер не завершён) или null. Конец перерыва — pauseLeftMs.
  pause: PauseState | null;
}

export interface EveningState {
  players: Record<PlayerId, PlayerState>;
  joinOrder: PlayerId[];
  timer: TimerState;
  currentLevel: BlindLevel;
  nextLevel: BlindLevel | null;
  rebuysOpen: boolean;
  aliveCount: number;
  totalEntries: number; // входы и ребаи штук
  totalStacks: number; // сумма кратностей всех входов и ребаев
  totalChips: number; // totalStacks × startingChips
  prizePoolRub: number; // totalStacks × buyInRub — все взносы вечера
  finished: boolean;
  places: PlayerId[]; // index 0 = 1-е место; заполняется только при finished (до этого — [])
  firstBustPlayerId: PlayerId | null; // для прогноза «кто вылетит первым» = первый bust вечера
  // Открытый олл-ин (показ карт на табло) или null: закрыт showdown_close, новым олл-ином или finish.
  showdown: ShowdownState | null;
  errors: { eventId: number; message: string }[];
}
