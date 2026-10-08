// «Проверка перед игрой» (аудит 07.10.2026, «Следующий шаг» 6; миграция 023): что банкиру и админу
// стоит проверить за 10 минут до старта — банкир назначен, связь и живое обновление, удержание
// экрана, табло на связи, имена и фразы озвучены. Здесь только решения и тексты — чистые функции
// без React (vitest — pregame.test.ts); замеры собирает PregameCheck.tsx.
import { FIXED_TEXTS, levelTexts, speakableName, type SpeakablePlayer } from '@domain/voice.ts';
import type { EveningState, PlayerId } from '@domain/types.ts';
import type { RealtimeStatus } from '../../shared/api/realtime';
import type { RsvpStatus } from '../../shared/api/types';
import { formatTime, NBSP, pluralWithNumber } from '../../shared/lib/format';
import { joinNames } from '../../shared/lib/text';
import type { WakeLockStatus } from '../../shared/lib/wakeLock';

/** ok — в порядке; warn — работает, но стоит поправить; fail — не работает; wait — проверяем. */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'wait';

export type CheckKey = 'banker' | 'server' | 'realtime' | 'wake' | 'board' | 'names' | 'phrases';

export interface CheckItem {
  key: CheckKey;
  status: CheckStatus;
  title: string;
  detail: string;
  /** Как исправить — только у warn и fail. */
  hint: string | null;
}

/** Ответ сервера дольше — «связь медленная»: записи пульта будут уходить с задержкой. */
export const SLOW_SERVER_MS = 1500;
/** Отметка табло свежее — табло на связи (board_ping раз в 20 с, три пропуска — нет). */
export const BOARD_FRESH_MS = 60_000;

export type ServerCheck =
  { state: 'pending' } | { state: 'ok'; rttMs: number } | { state: 'failed' };

export type BoardCheck =
  | { state: 'pending' }
  | { state: 'error' }
  | { state: 'ready'; seenAtMs: number | null; voiceAtMs: number | null };

export interface VoiceNames {
  /** Игроки, чьё имя табло произнести не может (латиница без «Имени на табло»). */
  unspeakable: string[];
  /** Игроки, чьё имя ещё не озвучено генератором. */
  unvoiced: string[];
  /** Сколько игроков проверено. */
  total: number;
}

export type VoiceCheck =
  | { state: 'pending' }
  | { state: 'error' }
  | {
      state: 'ready';
      names: VoiceNames;
      missingPhrases: number;
      totalPhrases: number;
    };

export interface PregameInput {
  bankerName: string | null;
  isAdmin: boolean;
  server: ServerCheck;
  realtime: RealtimeStatus;
  wake: WakeLockStatus;
  board: BoardCheck;
  voice: VoiceCheck;
  /** Время сервера — им же меряют отметки табло. */
  nowMs: number;
  /**
   * Сегодня день вечера по Москве (или он уже идёт). Табло клуба показывает анонс только в день
   * игры (private.club_board_evening_id) — раньше отметки табло не будет, и это не сбой.
   */
  gameDay: boolean;
  /**
   * Экран удерживается (за 3 ч до начала и в игре). Раньше проверка экран не держит — пункт ждёт,
   * кроме «API нет»: о нём лучше знать заранее.
   */
  holdScreen: boolean;
}

/** Совет об озвучке: у админа — как запустить её сейчас, у банкира — к кому идти. */
function voicingHint(isAdmin: boolean): string {
  return isAdmin
    ? `Озвучка идёт раз в${NBSP}сутки, в${NBSP}08:43 МСК. Не ждать — запусти её вручную: GitHub → poker-club-ops → Actions → voice → Run workflow, потом перезагрузи табло.`
    : `Озвучка идёт раз в${NBSP}сутки, утром. Не ждать — попроси админа запустить её вручную, потом перезагрузи табло.`;
}

function bankerItem(input: PregameInput): CheckItem {
  if (input.bankerName)
    return {
      key: 'banker',
      status: 'ok',
      title: 'Банкир назначен',
      detail: `Пульт ведёт ${input.bankerName}.`,
      hint: null,
    };
  return {
    key: 'banker',
    status: 'fail',
    title: 'Банкир не назначен',
    detail: 'Сейчас журнал вечера может вести только админ.',
    hint: input.isAdmin
      ? 'Назначь банкира в форме вечера: «Админ» → «Вечера» → этот вечер.'
      : 'Попроси админа назначить банкира.',
  };
}

function serverItem(server: ServerCheck): CheckItem {
  const title = 'Связь с сервером';
  if (server.state === 'pending')
    return { key: 'server', status: 'wait', title, detail: 'Проверяем…', hint: null };
  if (server.state === 'failed')
    return {
      key: 'server',
      status: 'fail',
      title: 'Сервер не отвечает',
      detail: 'Ответа нет дольше 5 секунд.',
      hint: 'Проверь интернет на телефоне и нажми «Проверить снова».',
    };
  const rtt = Math.round(server.rttMs);
  if (rtt > SLOW_SERVER_MS)
    return {
      key: 'server',
      status: 'warn',
      title: 'Связь медленная',
      detail: `Сервер ответил за ${(rtt / 1000).toFixed(1).replace('.', ',')}${NBSP}с — записи будут уходить с задержкой.`,
      hint: 'Подключись к Wi-Fi или найди место, где связь лучше.',
    };
  return {
    key: 'server',
    status: 'ok',
    title,
    detail: `Сервер отвечает за ${rtt}${NBSP}мс.`,
    hint: null,
  };
}

function realtimeItem(status: RealtimeStatus): CheckItem {
  const title = 'Живое обновление';
  if (status === 'live')
    return {
      key: 'realtime',
      status: 'ok',
      title,
      detail: 'Записи с других телефонов появятся на экране сами.',
      hint: null,
    };
  if (status === 'connecting')
    return { key: 'realtime', status: 'wait', title, detail: 'Подключаемся…', hint: null };
  return {
    key: 'realtime',
    status: 'fail',
    title: 'Живое обновление не работает',
    detail: 'Записи с других телефонов экран покажет только после перезагрузки.',
    hint: 'Закрой приложение и открой заново. Не помогло — проверь интернет.',
  };
}

function wakeItem(wake: WakeLockStatus, holdScreen: boolean): CheckItem {
  if (!holdScreen && wake !== 'unsupported')
    return {
      key: 'wake',
      status: 'wait',
      title: 'Удержание экрана',
      detail: 'Проверим за 3 часа до начала — с этого времени экран вечера не гаснет.',
      hint: null,
    };
  if (wake === 'held')
    return {
      key: 'wake',
      status: 'ok',
      title: 'Экран не гаснет',
      detail: 'Пока открыт пульт, телефон не уснёт.',
      hint: null,
    };
  if (wake === 'released')
    return {
      key: 'wake',
      status: 'wait',
      title: 'Удержание экрана',
      detail: 'Проверяем…',
      hint: null,
    };
  return {
    key: 'wake',
    status: 'warn',
    title: 'Экран может погаснуть',
    detail: 'Телефон не даёт приложению держать экран включённым.',
    hint: 'Отключи автоблокировку на время игры в настройках телефона.',
  };
}

function boardItem(board: BoardCheck, nowMs: number, gameDay: boolean): CheckItem {
  const title = 'Табло';
  // До дня игры табло клуба показывает «Следующая игра» и этот вечер не отмечает — ждать, а не сбой.
  const fresh =
    board.state === 'ready' && board.seenAtMs !== null && nowMs - board.seenAtMs <= BOARD_FRESH_MS;
  if (!gameDay && !fresh)
    return {
      key: 'board',
      status: 'wait',
      title,
      detail: 'Табло клуба покажет этот вечер в день игры — тогда и проверим связь.',
      hint: null,
    };
  if (board.state === 'pending')
    return { key: 'board', status: 'wait', title, detail: 'Проверяем…', hint: null };
  if (board.state === 'error')
    return {
      key: 'board',
      status: 'warn',
      title: 'Табло не проверить',
      detail: 'Сервер не ответил на вопрос о табло.',
      hint: 'Нажми «Проверить снова».',
    };
  const openHint =
    'Открой «Табло клуба» на ТВ: кнопка «Вывести на ТВ» вверху экрана. Ссылку достаточно открыть один раз и сохранить в закладки.';
  if (board.seenAtMs === null)
    return {
      key: 'board',
      status: 'fail',
      title: 'Табло не открыто',
      detail: 'Этот вечер ещё не показывало ни одно табло.',
      hint: openHint,
    };
  const age = nowMs - board.seenAtMs;
  if (age > BOARD_FRESH_MS)
    return {
      key: 'board',
      status: 'fail',
      title: 'Табло не на связи',
      detail: `Последний раз отмечалось в${NBSP}${formatTime(board.seenAtMs)}.`,
      hint: 'Проверь, что ТВ не уснул, браузер с табло открыт и есть интернет. Табло клуба может показывать другой вечер — тогда открой ссылку этого вечера.',
    };
  const voiceOn = board.voiceAtMs !== null && nowMs - board.voiceAtMs <= BOARD_FRESH_MS;
  if (!voiceOn)
    return {
      key: 'board',
      status: 'warn',
      title: 'Табло на связи, голос выключен',
      detail: 'Табло показывает этот вечер, но молчит.',
      hint: 'Нажми «Включить голос» на табло — хватит одного нажатия пульта ТВ.',
    };
  return {
    key: 'board',
    status: 'ok',
    title: 'Табло на связи',
    detail: 'Показывает этот вечер, голос включён.',
    hint: null,
  };
}

function namesItem(voice: VoiceCheck, isAdmin: boolean): CheckItem {
  const title = 'Имена игроков';
  if (voice.state === 'pending')
    return { key: 'names', status: 'wait', title, detail: 'Проверяем…', hint: null };
  if (voice.state === 'error')
    return {
      key: 'names',
      status: 'warn',
      title: 'Имена не проверить',
      detail: 'Сервер не ответил, какие фразы озвучены.',
      hint: 'Нажми «Проверить снова».',
    };
  const { unspeakable, unvoiced, total } = voice.names;
  if (total === 0)
    return {
      key: 'names',
      status: 'wait',
      title,
      detail: 'Пока некого проверять — проверим тех, кто ответит «иду» или сядет за стол.',
      hint: null,
    };
  if (unspeakable.length === 0 && unvoiced.length === 0)
    return {
      key: 'names',
      status: 'ok',
      title: 'Имена озвучены',
      detail:
        total === 1 ? 'Табло назовёт игрока по имени.' : `Табло назовёт по имени всех ${total}.`,
      hint: null,
    };
  const parts: string[] = [];
  const hints: string[] = [];
  if (unspeakable.length > 0) {
    parts.push(
      `Табло не прочитает ${unspeakable.length === 1 ? 'имя' : 'имена'}: ${joinNames(unspeakable)}.`,
    );
    hints.push(
      'Задай «Имя на табло» кириллицей в карточке игрока (у себя — своя карточка, у других — админ).',
    );
  }
  if (unvoiced.length > 0) {
    parts.push(
      `Ещё не ${unvoiced.length === 1 ? 'озвучено' : 'озвучены'}: ${joinNames(unvoiced)}.`,
    );
    hints.push(voicingHint(isAdmin));
  }
  parts.push('Нокауты и победу табло объявит без имени.');
  return {
    key: 'names',
    status: 'warn',
    title: 'Не все имена звучат',
    detail: parts.join(' '),
    hint: hints.join(' '),
  };
}

function phrasesItem(voice: VoiceCheck, isAdmin: boolean): CheckItem {
  const title = 'Фразы табло';
  if (voice.state === 'pending')
    return { key: 'phrases', status: 'wait', title, detail: 'Проверяем…', hint: null };
  if (voice.state === 'error')
    return {
      key: 'phrases',
      status: 'warn',
      title: 'Фразы не проверить',
      detail: 'Сервер не ответил, какие фразы озвучены.',
      hint: 'Нажми «Проверить снова».',
    };
  if (voice.missingPhrases === 0)
    return {
      key: 'phrases',
      status: 'ok',
      title: 'Фразы табло озвучены',
      detail: 'Уровни этого формата, ребаи, паузы и перерывы — всё есть.',
      hint: null,
    };
  return {
    key: 'phrases',
    status: 'warn',
    title: 'Не все фразы озвучены',
    detail: `Нет ${voice.missingPhrases} из ${voice.totalPhrases} — эти объявления табло пропустит.`,
    hint: voicingHint(isAdmin),
  };
}

/** Пункты проверки по порядку: люди, связь, телефон, табло, голос. */
export function pregameChecks(input: PregameInput): CheckItem[] {
  return [
    bankerItem(input),
    serverItem(input.server),
    realtimeItem(input.realtime),
    wakeItem(input.wake, input.holdScreen),
    boardItem(input.board, input.nowMs, input.gameDay),
    namesItem(input.voice, input.isAdmin),
    phrasesItem(input.voice, input.isAdmin),
  ];
}

const IN_PROGRESS_DETAILS: ReadonlySet<string> = new Set(['Проверяем…', 'Подключаемся…']);

/**
 * Пункт проверяется прямо сейчас (на экране — крутилка), а не ждёт своего часа: «проверим в день
 * игры», «пока некого проверять».
 */
export function checkInProgress(item: CheckItem): boolean {
  return item.status === 'wait' && IN_PROGRESS_DETAILS.has(item.detail);
}

export interface PregameSummary {
  status: CheckStatus;
  text: string;
}

/** Итог одной строкой: «всё в порядке», «2 пункта — посмотри», «проверяем…». */
export function pregameSummary(items: readonly CheckItem[]): PregameSummary {
  const bad = items.filter((i) => i.status === 'fail' || i.status === 'warn');
  if (bad.length > 0) {
    const fail = bad.some((i) => i.status === 'fail');
    const text = `${pluralWithNumber(bad.length, ['пункт', 'пункта', 'пунктов'])} — посмотри`;
    return { status: fail ? 'fail' : 'warn', text };
  }
  if (items.some((i) => i.status === 'wait' && i.detail === 'Проверяем…'))
    return { status: 'wait', text: 'Проверяем…' };
  return { status: 'ok', text: 'Всё в порядке' };
}

// --- Кого и что озвучивать -------------------------------------------------------------------

export interface PregamePlayer extends SpeakablePlayer {
  id: PlayerId;
}

/**
 * Чьи имена проверять: до старта — посаженные и ответившие «иду», в игре — все, кто садился за стол
 * (вылетевшие тоже: табло назовёт их в нокауте). Порядок — посадка, затем ответы.
 */
export function pregamePlayerIds(
  state: Pick<EveningState, 'joinOrder'>,
  rsvps: readonly { player_id: string; status: RsvpStatus }[],
  started: boolean,
): PlayerId[] {
  const out = [...state.joinOrder];
  if (!started)
    for (const r of rsvps)
      if (r.status === 'yes' && !out.includes(r.player_id)) out.push(r.player_id);
  return out;
}

/** Что проверять в озвучке: имена (текст — как скажет табло, null — не прочитает) и фразы. */
export interface PregameVoicePlan {
  names: { id: PlayerId; display: string; text: string | null }[];
  /** Фразы уровней формата и фиксированные (паузы, ребаи, перерывы) — без имён. */
  phrases: string[];
}

export function pregameVoicePlan(
  format: unknown,
  players: readonly PregamePlayer[],
): PregameVoicePlan {
  return {
    names: players.map((p) => ({ id: p.id, display: p.display_name, text: speakableName(p) })),
    phrases: [...new Set([...levelTexts(format), ...FIXED_TEXTS])],
  };
}

/**
 * Итог озвучки по найденным клипам: isVoiced(текст) — есть ли клип. Имена без текста — «не
 * прочитает», без клипа — «не озвучено».
 */
export function voiceCheckFrom(
  plan: PregameVoicePlan,
  isVoiced: (text: string) => boolean,
): Extract<VoiceCheck, { state: 'ready' }> {
  const unspeakable: string[] = [];
  const unvoiced: string[] = [];
  for (const n of plan.names) {
    if (n.text === null) unspeakable.push(n.display);
    else if (!isVoiced(n.text)) unvoiced.push(n.display);
  }
  return {
    state: 'ready',
    names: { unspeakable, unvoiced, total: plan.names.length },
    missingPhrases: plan.phrases.filter((t) => !isVoiced(t)).length,
    totalPhrases: plan.phrases.length,
  };
}
