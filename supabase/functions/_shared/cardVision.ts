// «Снять борд» (card-vision): банкир фотографирует стол, Edge Function спрашивает Claude, какие карты
// открыты, и возвращает руки и стол. Здесь — всё, что не зависит от SDK и базы: промпт и схема ответа
// (как в тесте на 17 фото стола клуба, 15.10.2026), проверка запроса, нормализация и проверка ответа
// модели, тексты ошибок на «ты», ограничение частоты и сам порядок проверок (`cardVision`) с
// зависимостями-параметрами. Вызов модели — card-vision/claude.ts (npm-SDK, только Deno), режим
// подмены ответа для локальной проверки — cardVisionFixtures.ts. Тесты — cardVision.test.ts (vitest).
//
// Фото нигде не сохраняется: ни в Storage, ни в базе, ни в логах (в лог — только итог и время).
// Карты на табло отсюда не попадают: клиент кладёт их в черновик шторки олл-ина, банкир проверяет и
// отправляет обычной кнопкой.
import { CARD_RANKS, CARD_SUITS, SHOWDOWN_MAX_HANDS } from './domain/showdown.ts';
import type { CardCode } from './domain/types.ts';

// ---------------------------------------------------------------------------
// Модель, промпт, схема
// ---------------------------------------------------------------------------

/** Тест 15.10.2026: Sonnet 5.5 — 166/166 карт на 17 фото, медиана 2,5 с, около 0,5 цента за фото. */
export const CARD_VISION_MODEL = 'claude-sonnet-5-5';
/** Ответ — короткий JSON; запас на рассуждение (thinking adaptive, effort low). */
export const CARD_VISION_MAX_TOKENS = 4000;
/** Дольше — «не ответило»: банкир за столом ждать не будет, есть касания и голос. */
export const CARD_VISION_TIMEOUT_MS = 20_000;

/** Карта в ответе модели: ранг A K Q J 10 9…2 и масть s h d c («10c», «Qh»). */
const CARD_SCHEMA = { type: 'string', pattern: '^(A|K|Q|J|10|[2-9])[shdc]$' } as const;

/** Схема structured outputs (output_config.format) — та же, что в тесте. */
export const CARD_VISION_SCHEMA = {
  type: 'object',
  properties: {
    hands: { type: 'array', items: { type: 'array', items: CARD_SCHEMA } },
    board: { type: 'array', items: CARD_SCHEMA },
  },
  required: ['hands', 'board'],
  additionalProperties: false,
};

/** Промпт — дословно из теста (run.mjs): на нём Sonnet 5.5 не ошибся ни разу. */
export const CARD_VISION_PROMPT = `Фото покерного стола (техасский холдем) сверху, снято телефоном.
Выпиши все ОТКРЫТЫЕ карты:
- hands — открытые руки игроков: каждая группа карт у места игрока отдельным списком;
- board — карты стола в центре, слева направо.
Формат карты: ранг A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, 2 и масть s (пики), h (черви), d (бубны), c (трефы). Например "10c", "Qh".
Цифры и масти, нарисованные на сукне, — не карты. Пустые места и закрытые карты не выдумывай. Ответь только JSON по схеме.`;

// ---------------------------------------------------------------------------
// Запрос: id вечера и фото
// ---------------------------------------------------------------------------

/** Фото больше этого сервер не принимает: клиент сжимает до ~1600 px по длинной стороне. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** Тело запроса больше этого не читаем вовсе (фото в base64 — на треть длиннее байтов). */
export const MAX_BODY_BYTES = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 64 * 1024;

export type PhotoMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export const PHOTO_MEDIA_TYPES: readonly PhotoMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export interface VisionPhoto {
  mediaType: PhotoMediaType;
  /** base64 без префикса data:. */
  data: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Сколько байт в base64-строке (без пробелов). */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** Тип картинки по первым байтам: JPEG (FF D8 FF), PNG, WebP (RIFF…WEBP); иначе null. */
export function sniffImageType(b64: string): PhotoMediaType | null {
  let head: string;
  try {
    head = atob(b64.slice(0, 16));
  } catch {
    return null;
  }
  const byte = (i: number) => head.charCodeAt(i);
  if (byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff) return 'image/jpeg';
  if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export type VisionRequestRead =
  { ok: true; eveningId: string; photo: VisionPhoto } | { ok: false; failure: VisionFailureCode };

/** Тело запроса {eveningId, image, mediaType} → проверенные id вечера и фото. */
export function readVisionRequest(body: Record<string, unknown> | null): VisionRequestRead {
  const eveningId = body?.eveningId;
  if (typeof eveningId !== 'string' || !UUID_RE.test(eveningId))
    return { ok: false, failure: 'bad_evening' };
  const mediaType = body?.mediaType;
  if (typeof mediaType !== 'string' || !PHOTO_MEDIA_TYPES.includes(mediaType as PhotoMediaType))
    return { ok: false, failure: 'bad_type' };
  const image = body?.image;
  if (typeof image !== 'string' || image.length < 16 || !BASE64_RE.test(image))
    return { ok: false, failure: 'bad_photo' };
  if (base64Bytes(image) > MAX_PHOTO_BYTES) return { ok: false, failure: 'too_large' };
  if (sniffImageType(image) !== mediaType) return { ok: false, failure: 'bad_type' };
  return {
    ok: true,
    eveningId: eveningId.toLowerCase(),
    photo: { mediaType: mediaType as PhotoMediaType, data: image },
  };
}

// ---------------------------------------------------------------------------
// Ответ модели → карты
// ---------------------------------------------------------------------------

/** Что в ответе модели пришлось поправить или выбросить — клиент покажет замечаниями. */
export type VisionIssue =
  /** Не карта: не разобрать ранг или масть. */
  | { kind: 'bad_card'; value: string }
  /** Карта названа второй раз (на столе или в другой руке) — повтор выброшен. */
  | { kind: 'duplicate'; card: CardCode }
  /** Группа у места игрока — не из двух карт: в руку не сложилась, её карты не кладём. */
  | { kind: 'odd_hand'; cards: CardCode[] }
  /** На столе больше пяти карт — лишние (по порядку справа) выброшены. */
  | { kind: 'board_extra'; cards: CardCode[] }
  /** Рук больше девяти — лишние выброшены. */
  | { kind: 'hands_extra'; count: number };

export interface VisionAnswer {
  /** Руки по две карты, в порядке ответа (чья — модель не знает). */
  hands: [CardCode, CardCode][];
  /** Стол слева направо, до пяти карт. */
  board: CardCode[];
  issues: VisionIssue[];
}

const SUIT_SYMBOLS: Readonly<Record<string, string>> = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

/**
 * Карта ответа → код домена ('Tc', 'Qh'). Принимает формат схемы («10c», «Qh») и близкие к нему
 * (регистр, «T» вместо «10», значок масти); остальное — null.
 */
export function normalizeCard(raw: unknown): CardCode | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, '');
  const m = /^(10|[2-9tjqka])([shdc♠♥♦♣])$/i.exec(text);
  if (!m?.[1] || !m[2]) return null;
  const rank = m[1] === '10' ? 'T' : m[1].toUpperCase();
  const suit = SUIT_SYMBOLS[m[2]] ?? m[2].toLowerCase();
  if (!CARD_RANKS.includes(rank) || !CARD_SUITS.includes(suit)) return null;
  return rank + suit;
}

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

/**
 * Ответ модели (уже JSON) → руки и стол в кодах домена. Стол — первым (его карты в центре, их видно
 * лучше всего), потом руки по порядку: неверная карта выбрасывается с замечанием, стол — не длиннее
 * пяти, рук — не больше девяти, группа не из двух карт в руку не идёт (её карты — замечанием, положить
 * их касанием). Каждая карта берётся один раз: повтор карты, которая уже взята (на стол или в руку),
 * выбрасывается с замечанием «повтор». Взятой считается только то, что в ответ попало: лишняя карта
 * стола и карты не сложившейся группы место не занимают — та же карта в руке дальше остаётся в руке, а
 * из замечания о группе уходит (повтор — взята одна). Не та форма (нет списков hands и board) — null.
 */
export function normalizeVisionAnswer(parsed: unknown): VisionAnswer | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const rawHands = asArray(record.hands);
  const rawBoard = asArray(record.board);
  if (!rawHands || !rawBoard) return null;

  const issues: VisionIssue[] = [];
  /** Взятые карты: стол (до пяти) и сложившиеся руки. */
  const taken = new Set<CardCode>();
  /**
   * Карты списка без неверных (с замечанием), без уже взятых (повтор — с замечанием) и без повторов
   * внутри списка (`repeats` — их замечание решает вызывающий: взят ли список).
   */
  const cardsOf = (list: readonly unknown[]): { cards: CardCode[]; repeats: CardCode[] } => {
    const cards: CardCode[] = [];
    const repeats: CardCode[] = [];
    for (const raw of list) {
      const card = normalizeCard(raw);
      if (!card) {
        issues.push({ kind: 'bad_card', value: String(raw).slice(0, 12) });
        continue;
      }
      if (taken.has(card)) {
        issues.push({ kind: 'duplicate', card });
        continue;
      }
      if (cards.includes(card)) {
        repeats.push(card);
        continue;
      }
      cards.push(card);
    }
    return { cards, repeats };
  };
  const duplicates = (cards: readonly CardCode[]): VisionIssue[] =>
    cards.map((card) => ({ kind: 'duplicate', card }));

  const boardAll = cardsOf(rawBoard);
  const board = boardAll.cards.slice(0, 5);
  for (const card of board) taken.add(card);
  // Повтор внутри стола — «взята одна», только если карта легла (лишние — в board_extra).
  issues.push(...duplicates(boardAll.repeats.filter((card) => taken.has(card))));
  if (boardAll.cards.length > 5)
    issues.push({ kind: 'board_extra', cards: boardAll.cards.slice(5) });

  const hands: [CardCode, CardCode][] = [];
  let extraHands = 0;
  for (const rawHand of rawHands) {
    const list = asArray(rawHand);
    const { cards, repeats } = cardsOf(list ?? [rawHand]);
    if (cards.length === 0) continue;
    const [a, b] = cards;
    if (cards.length !== 2 || !a || !b) {
      issues.push({ kind: 'odd_hand', cards });
      continue;
    }
    if (hands.length >= SHOWDOWN_MAX_HANDS) {
      extraHands += 1;
      continue;
    }
    hands.push([a, b]);
    taken.add(a);
    taken.add(b);
    issues.push(...duplicates(repeats));
  }
  if (extraHands > 0) issues.push({ kind: 'hands_extra', count: extraHands });

  // Карта не сложившейся группы легла в руку дальше: в замечании о группе её нет — это повтор.
  const settled = issues.flatMap((issue): VisionIssue[] => {
    if (issue.kind !== 'odd_hand') return [issue];
    const later = issue.cards.filter((card) => taken.has(card));
    if (later.length === 0) return [issue];
    const rest = issue.cards.filter((card) => !taken.has(card));
    return [...(rest.length > 0 ? [{ ...issue, cards: rest }] : []), ...duplicates(later)];
  });
  return { hands, board, issues: settled };
}

/** Текст ответа модели (JSON по схеме) → карты; не JSON или не та форма — null. */
export function parseVisionText(text: string): VisionAnswer | null {
  try {
    return normalizeVisionAnswer(JSON.parse(text));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ошибки
// ---------------------------------------------------------------------------

export type VisionFailureCode =
  | 'bad_evening'
  | 'bad_type'
  | 'bad_photo'
  | 'too_large'
  | 'not_found'
  | 'forbidden'
  | 'not_live'
  | 'not_configured'
  | 'too_many'
  | 'timeout'
  | 'busy'
  | 'upstream'
  | 'network'
  | 'bad_key'
  | 'billing'
  | 'bug'
  | 'refused'
  | 'bad_answer';

interface FailureText {
  status: number;
  message: string;
}

/** Код ошибки → HTTP-статус и текст на «ты» (клиент показывает его как есть). */
const FAILURES: Readonly<Record<VisionFailureCode, FailureText>> = {
  bad_evening: { status: 400, message: 'Некорректный id вечера.' },
  bad_type: {
    status: 400,
    message: 'Нужна фотография JPEG, PNG или WebP. Сними стол ещё раз.',
  },
  bad_photo: { status: 400, message: 'Фото не дошло целиком. Сними стол ещё раз.' },
  too_large: {
    status: 413,
    message: 'Фото больше 4 МБ даже после сжатия. Сними стол ещё раз.',
  },
  not_found: { status: 404, message: 'Вечер не найден.' },
  forbidden: { status: 403, message: 'Снимать борд может банкир вечера или админ.' },
  not_live: { status: 409, message: 'Вечер не идёт — снимать борд нечего.' },
  not_configured: {
    status: 503,
    message: 'Распознавание не настроено — нужен ключ ANTHROPIC_API_KEY в секретах.',
  },
  too_many: {
    status: 429,
    message: 'Слишком много снимков подряд — подожди минуту или отметь карты касанием.',
  },
  timeout: {
    status: 504,
    message: 'Распознавание не ответило за 20 секунд. Сними ещё раз или отметь карты касанием.',
  },
  busy: {
    status: 503,
    message: 'Распознавание сейчас перегружено — повтори через несколько секунд.',
  },
  upstream: {
    status: 502,
    message:
      'Сервис распознавания временно не отвечает — повтори через минуту или отметь карты касанием.',
  },
  network: {
    status: 502,
    message: 'Нет связи с сервисом распознавания — повтори через несколько секунд.',
  },
  bad_key: {
    status: 503,
    message:
      'Распознавание не настроено: ключ ANTHROPIC_API_KEY не принят — нужен новый в секретах.',
  },
  billing: {
    status: 503,
    message: 'Распознавание недоступно: проблема с оплатой API Anthropic. Отметь карты касанием.',
  },
  bug: {
    status: 500,
    message: 'Распознавание отклонило запрос — это ошибка приложения. Отметь карты касанием.',
  },
  refused: {
    status: 422,
    message: 'Модель отказалась разбирать это фото. Сними стол ещё раз или отметь карты касанием.',
  },
  bad_answer: {
    status: 502,
    message:
      'Распознавание вернуло непонятный ответ. Сними стол ещё раз или отметь карты касанием.',
  },
};

export interface VisionReply {
  status: number;
  body: Record<string, unknown>;
}

/** Ответ-ошибка функции: {error: текст, code} (как у остальных функций). */
export function visionFailure(code: VisionFailureCode): VisionReply {
  const f = FAILURES[code];
  return { status: f.status, body: { error: f.message, code } };
}

/**
 * HTTP-статус ответа Anthropic → код ошибки: 429 — перегрузка (повтори), 5xx и 529 — сбой сервиса
 * (повтори позже), 401/403 — ключ, 402 — оплата; прочие 4xx (400, 404, 413…) — наш запрос неверен:
 * это баг, повтор не поможет.
 */
export function failureForStatus(status: number | undefined): VisionFailureCode {
  if (status === 429) return 'busy';
  if (status === 401 || status === 403) return 'bad_key';
  if (status === 402) return 'billing';
  if (status !== undefined && status >= 500) return 'upstream';
  return 'bug';
}

// ---------------------------------------------------------------------------
// Частота
// ---------------------------------------------------------------------------

/** Снимков на игрока за окно — с запасом на пересъёмку; защита ключа от зацикленного клиента. */
export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60_000;

export interface RateLimiter {
  /** Можно ли ещё один снимок этому игроку сейчас; да — снимок засчитан. */
  take(key: string, nowMs: number): boolean;
}

/**
 * Скользящее окно в памяти экземпляра функции. Экземпляров может быть несколько, и они засыпают —
 * это страховка от зацикленного клиента, а не учёт: настоящий предел — право снимать (банкир идущего
 * вечера или админ).
 */
export function createRateLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key, nowMs) {
      const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(nowMs);
      hits.set(key, recent);
      // Чужие окна давно кончились — не копим ключи.
      if (hits.size > 100)
        for (const [k, list] of hits) if (list.every((t) => nowMs - t >= windowMs)) hits.delete(k);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Порядок проверок и вызов
// ---------------------------------------------------------------------------

/** Что вернул вызов модели (claude.ts) или подмена (cardVisionFixtures.ts). */
export type RecognizeOutcome =
  /** text — JSON по схеме, как его вернула модель. */
  | { kind: 'answer'; text: string }
  | { kind: 'refusal'; category: string | null }
  /** detail — для лога (без фото и без ключа). */
  | { kind: 'failure'; failure: VisionFailureCode; detail?: string };

export interface VisionCaller {
  id: string;
  is_admin: boolean;
}

export interface VisionEvening {
  id: string;
  status: string;
  banker_id: string | null;
}

export interface CardVisionDeps {
  loadEvening(id: string): Promise<VisionEvening | null>;
  /** null — распознавание не настроено (нет ключа и нет подмены). */
  recognize: ((photo: VisionPhoto, signal: AbortSignal) => Promise<RecognizeOutcome>) | null;
  limiter: RateLimiter;
  /** Часы (мс): время ответа и окно частоты. */
  now(): number;
  /** Запрос клиента: ушёл — вызов модели прерывается. */
  signal?: AbortSignal;
  timeoutMs?: number;
  log?(line: string): void;
}

/** Ответ клиенту при успехе. */
export interface VisionSuccess {
  hands: [CardCode, CardCode][];
  board: CardCode[];
  issues: VisionIssue[];
  /** Сколько думала модель (без загрузки фото), мс. */
  ms: number;
}

/**
 * Запрос «Снять борд» от вошедшего игрока: id вечера и фото → руки и стол или ошибка. Проверки по
 * порядку: вечер есть; вызывающий — банкир этого вечера или админ (как у записи в журнал); вечер идёт
 * (live — и настоящий, и тренировка: шторка олл-ина есть только у идущего); распознавание настроено;
 * фото — JPEG/PNG/WebP до 4 МБ; не чаще RATE_LIMIT в минуту. Модель не ответила за timeoutMs —
 * вызов прерывается, «не ответило».
 */
export async function cardVision(
  caller: VisionCaller,
  body: Record<string, unknown> | null,
  deps: CardVisionDeps,
): Promise<VisionReply> {
  const eveningId = body?.eveningId;
  if (typeof eveningId !== 'string' || !UUID_RE.test(eveningId))
    return visionFailure('bad_evening');
  const evening = await deps.loadEvening(eveningId.toLowerCase());
  if (!evening) return visionFailure('not_found');
  if (!caller.is_admin && evening.banker_id !== caller.id) return visionFailure('forbidden');
  if (evening.status !== 'live') return visionFailure('not_live');
  if (!deps.recognize) return visionFailure('not_configured');

  const read = readVisionRequest(body);
  if (!read.ok) return visionFailure(read.failure);
  if (!deps.limiter.take(caller.id, deps.now())) return visionFailure('too_many');

  const controller = new AbortController();
  const onGone = () => controller.abort();
  deps.signal?.addEventListener('abort', onGone);
  let timedOut = false;
  const timeoutMs = deps.timeoutMs ?? CARD_VISION_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RecognizeOutcome>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ kind: 'failure', failure: 'timeout' });
    }, timeoutMs);
  });
  const started = deps.now();
  let outcome: RecognizeOutcome;
  try {
    outcome = await Promise.race([
      deps.recognize(read.photo, controller.signal).catch((error: unknown): RecognizeOutcome => ({
        kind: 'failure',
        failure: 'bug',
        detail: error instanceof Error ? error.message : String(error),
      })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onGone);
  }
  const ms = Math.max(0, Math.round(deps.now() - started));
  if (timedOut) outcome = { kind: 'failure', failure: 'timeout' };

  if (outcome.kind === 'refusal') {
    deps.log?.(`card-vision: отказ модели (${outcome.category ?? 'без категории'}), ${ms} мс`);
    return visionFailure('refused');
  }
  if (outcome.kind === 'failure') {
    deps.log?.(
      `card-vision: ${outcome.failure}, ${ms} мс${outcome.detail ? ` — ${outcome.detail}` : ''}`,
    );
    return visionFailure(outcome.failure);
  }
  const answer = parseVisionText(outcome.text);
  if (!answer) {
    deps.log?.(`card-vision: ответ не по схеме, ${ms} мс`);
    return visionFailure('bad_answer');
  }
  deps.log?.(
    `card-vision: рук ${answer.hands.length}, на столе ${answer.board.length}, замечаний ${answer.issues.length}, ${ms} мс`,
  );
  const success: VisionSuccess = { ...answer, ms };
  return { status: 200, body: { ...success } };
}
