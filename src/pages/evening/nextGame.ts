// Вторая игра в тот же день и зачёт тренировки (миграция 026): когда показывать кнопки, вопросы перед
// действием, тосты и состав прошлой игры дня для шторки посадки. Права, окно в 12 часов и номер игры
// проверяет сервер (create_next_game, promote_training_evening) — здесь только то, что видит экран.
// Тексты — на «ты» без рода, о людях — без склонения имён.
import { gameNoOf } from '../../shared/api/types';
import { moscowDateKey } from '../../shared/lib/clubTime';
import { gameSuffix, joinNames } from '../../shared/lib/text';

/** Сколько после финала банкиру видна «Ещё игра сегодня» — то же окно, что у create_next_game. */
export const NEXT_GAME_WINDOW_MS = 12 * 60 * 60 * 1000;

interface FinishedLike {
  status: string;
  scheduled_at: string;
  finished_at: string | null;
  is_training?: boolean | null;
}

/**
 * «Ещё игра сегодня» на экране итога: настоящий вечер завершён не раньше NEXT_GAME_WINDOW_MS назад,
 * смотрит банкир этого вечера или админ (canControl), и по Москве всё ещё день этой игры: новая игра
 * встаёт на сейчас, и после полуночи она была бы игрой 1 другой даты, а не игрой 2 этого дня
 * (create_next_game отвечает на это ошибкой).
 */
export function nextGameAvailable(
  evening: FinishedLike,
  canControl: boolean,
  nowMs: number,
): boolean {
  if (!canControl || evening.is_training === true) return false;
  if (evening.status !== 'finished' && evening.status !== 'settled') return false;
  const finishedMs = evening.finished_at ? Date.parse(evening.finished_at) : Number.NaN;
  return (
    Number.isFinite(finishedMs) &&
    nowMs - finishedMs < NEXT_GAME_WINDOW_MS &&
    moscowDateKey(evening.scheduled_at) === moscowDateKey(nowMs)
  );
}

export interface Question {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger?: boolean;
}

/** Вопрос перед «Ещё игра сегодня»: что создастся и чего не будет. */
export function nextGameQuestion(): Question {
  return {
    title: 'Ещё игра сегодня?',
    message:
      'Новый вечер на сейчас: то же место, формат и банкир. В шторке посадки уже будут отмечены игроки этой игры. Анонса в группе не будет, итоги новой игры придут отдельным постом.',
    confirmText: 'Создать игру',
    cancelText: 'Не сейчас',
  };
}

/** Тост после create_next_game: создана или уже была (двойное нажатие, второй телефон). */
export function nextGameToast(result: { gameNo: number; created: boolean }): {
  success: string;
  detail: string;
} {
  return result.created
    ? {
        success: `Игра ${result.gameNo} создана`,
        detail: 'Отметь, кто садится за стол, и начинай.',
      }
    : { success: `Игра ${result.gameNo} уже создана`, detail: 'Открываю её.' };
}

/**
 * Вопрос перед зачётом тренировки: что изменится (рейтинг, статистика, ачивки, деньги, пост итогов,
 * голосование на 24 ч) и что отменить это нельзя. guestNames — гости за столом тренировки: в рейтинг
 * они не попадут, поэтому совет — сначала привязать гостя к профилю.
 */
export function promoteQuestion(guestNames: readonly string[]): Question {
  const guests =
    guestNames.length === 0
      ? ''
      : guestNames.length === 1
        ? ` Гость ${guestNames[0]} в рейтинг не попадёт: если это игрок клуба, сначала привяжи гостя к профилю — «Админ» → «Игроки».`
        : ` Гости ${joinNames(guestNames)} в рейтинг не попадут: если среди них игроки клуба, сначала привяжи гостей к профилям — «Админ» → «Игроки».`;
  return {
    title: 'Засчитать как настоящий вечер?',
    message:
      'Тренировка станет вечером клуба, отменить это нельзя. Места и очки войдут в рейтинг и сезон, нокауты и ачивки — в статистику и ленту, деньги — в расчёты клуба. В группу уйдёт пост итогов, голосование за руку, блеф и бэд-бит откроется на 24 часа.' +
      guests,
    confirmText: 'Засчитать вечер',
    cancelText: 'Не засчитывать',
    danger: true,
  };
}

/** Чем кончилась отправка поста итогов после зачёта. */
export type PromotePost = 'posted' | 'already_posted' | 'no_group' | 'failed';

/** Тост после зачёта: номер игры в дне (если не первая) и судьба поста итогов. */
export function promotedToast(
  gameNo: number,
  post: PromotePost,
): { success: string; detail: string } {
  const postLine =
    post === 'posted' || post === 'already_posted'
      ? 'Итоги — в группе.'
      : post === 'no_group'
        ? 'Группа клуба не подключена — поста итогов не будет.'
        : 'Итоги бот отправит в группу сам в течение 15 минут.';
  return {
    success: 'Тренировка засчитана как вечер',
    detail: [
      gameNo > 1 ? `Это игра ${gameNo} дня.` : null,
      'Голосование открыто 24 часа.',
      postLine,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

interface DayEvening {
  id: string;
  scheduled_at: string;
  game_no?: number | null;
  is_training?: boolean | null;
}

/**
 * Состав прошлой игры того же московского дня — для шторки посадки игры 2 и дальше: игроки в порядке
 * входа (итог из истории клуба). У игры 1, у тренировки и если прошлой игры в истории нет — null.
 */
export function previousGameRoster(
  evening: DayEvening,
  history:
    | {
        evenings: readonly DayEvening[];
        summaryById: ReadonlyMap<string, { entrants: readonly string[] }>;
      }
    | undefined,
): { gameNo: number; playerIds: string[] } | null {
  const current = gameNoOf(evening);
  if (current <= 1 || evening.is_training === true || !history) return null;
  const day = moscowDateKey(evening.scheduled_at);
  const previous = history.evenings
    .filter(
      (e) =>
        e.id !== evening.id &&
        e.is_training !== true &&
        gameNoOf(e) < current &&
        moscowDateKey(e.scheduled_at) === day &&
        history.summaryById.has(e.id),
    )
    .sort(
      (a, b) =>
        gameNoOf(b) - gameNoOf(a) || Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at),
    )[0];
  if (!previous) return null;
  const entrants = history.summaryById.get(previous.id)?.entrants ?? [];
  return entrants.length > 0 ? { gameNo: gameNoOf(previous), playerIds: [...entrants] } : null;
}

/** «Вечер 9 октября · игра 2» — подпись вечера, где его отличают по дате. */
export function eveningTitle(
  training: boolean,
  dateText: string,
  gameNo: number | null | undefined,
): string {
  return `${training ? 'Тренировка' : 'Вечер'} ${dateText}${training ? '' : gameSuffix(gameNo)}`;
}
