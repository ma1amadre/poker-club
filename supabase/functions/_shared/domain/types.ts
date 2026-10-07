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
  buyInRub: number; // 500 — цена входа и ребая (стандартного; вход ×k стоит buyInRub·k)
  startingChips: number; // 500 — фишек за вход и за ребай (×k — startingChips·k)
  bountyRub: number; // 100 — из каждого входа/ребая «за голову»; в фонд идёт buyIn - bounty (×k — всё ×k)
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
  | 'finish';

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
];

/** Наибольшая кратность входа или ребая (stacks в payload join/rebuy). */
export const MAX_ENTRY_STACKS = 10;

export type EventPayload =
  // join, rebuy; stacks — кратность входа: целое 1..MAX_ENTRY_STACKS, нет поля = 1 (старые события).
  // Вход ×k: взнос buyInRub·k, фишки startingChips·k, голова bountyRub·k, в фонд (buyIn − bounty)·k.
  | { playerId: PlayerId; stacks?: number }
  | { playerId: PlayerId; by: PlayerId[] } // bust; by = кто выбил (0..n)
  | { playerId: PlayerId; amountRub: number; note?: string } // payment: + игрок→банкир, − банкир→игрок
  | Record<string, never>; // timer_*, level_*, hand, finish

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
  currentStacks: number; // кратность текущего (последнего) входа или ребая: голова = currentStacks × bountyRub
  alive: boolean;
  busts: number; // все вылеты, включая те, после которых был ребай
  finalBustEventId: number | null; // последний bust, если после него не было ребая
  place: number | null; // известно после finish или для вылетевших после закрытия ребаев
  kos: number;
  koVictims: PlayerId[]; // по одному элементу на каждый нокаут, в порядке событий
  bountyWonRub: number; // только головы за нокауты; свою голову и сиротские победитель получает в money.ts
  bustLevel: number | null; // номер уровня (с 1) окончательного вылета
}

export interface TimerState {
  status: 'not_started' | 'running' | 'paused';
  levelIndex: number; // 0-based
  levelElapsedMs: number;
  levelRemainingMs: number | null; // null для не-time триггеров
  handsInLevel: number;
  bustsInLevel: number;
  totalElapsedMs: number; // чистое игровое время без пауз
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
  prizePoolRub: number; // totalStacks × (buyInRub − bountyRub)
  bountyPoolRub: number; // все головы вечера: totalStacks × bountyRub
  finished: boolean;
  places: PlayerId[]; // index 0 = 1-е место; заполняется только при finished (до этого — [])
  firstBustPlayerId: PlayerId | null; // для прогноза «кто вылетит первым» = первый bust вечера
  errors: { eventId: number; message: string }[];
}
