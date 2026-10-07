// Прогресс до ачивок для показа: achievementProgress домена → строки карточки игрока (полоса
// «4 из 5», место в сезоне, подпись). Счётчики и правила считает домен, здесь только слова и
// раскладка по группам. Подписи на «ты» — только на своей карточке; на чужой — нейтрально.
// Имена не склоняем (падежей у произвольного имени нет) — конструкции с тире и двоеточием.
import {
  ACHIEVEMENT_META,
  ACHIEVEMENT_THRESHOLDS,
  type AchievementCode,
} from '@domain/achievements.ts';
import type { AchievementProgress } from '@domain/progress.ts';
import type { PlayerId } from '@domain/types.ts';
import {
  formatPointsWithUnit,
  joinNames,
  kosCount,
  NBSP,
  pluralWithNumber,
  winsCount,
} from '../../shared/lib';

/** Сезонные ачивки: их дают за каждый завершённый сезон, прогресс — по текущему. */
export const SEASONAL_CODES: ReadonlySet<AchievementCode> = new Set([
  'iron_chair',
  'rebuy_king',
  'champion',
]);

export interface ProgressView {
  code: AchievementCode;
  title: string;
  /** Полоса Progress: value из max с подписью «4 из 5»; null — полосы нет. */
  bar: { value: number; max: number; text: string } | null;
  /** Короткое значение справа, когда полосы нет: «3-е место», «пропуск». */
  aside: string | null;
  hint: string;
  /** В этом сезоне уже недостижима — строка приглушена. */
  muted: boolean;
  /** Насколько близко (0…1) — порядок блока «На подходе». */
  ratio: number;
}

export interface ProgressViewOptions {
  /** Своя карточка — подписи на «ты» с призывом; чужая — нейтральные. */
  isMe: boolean;
  /** Чья карточка: на своей в списке лидеров вместо имени — «ты». */
  self?: PlayerId;
  nameOf: (id: PlayerId) => string;
}

const REBUY_FORMS = ['ребай', 'ребая', 'ребаев'] as const;
const PREDICTION_FORMS = ['прогноз', 'прогноза', 'прогнозов'] as const;
const TIMES_FORMS = ['раз', 'раза', 'раз'] as const;

function countBar(current: number, target: number): ProgressView['bar'] {
  return { value: Math.min(current, target), max: target, text: `${current} из${NBSP}${target}` };
}

function hintFor(p: AchievementProgress, { isMe, self, nameOf }: ProgressViewOptions): string {
  const T = ACHIEVEMENT_THRESHOLDS;
  const c = p.current ?? 0;
  const target = p.target ?? 0;
  const left = Math.max(0, target - c);
  const names = (ids: readonly PlayerId[] | undefined) =>
    joinNames((ids ?? []).map((id) => (isMe && id === self ? 'ты' : nameOf(id))));

  switch (p.code) {
    case 'first_blood':
      return isMe
        ? 'Первого нокаута в клубе ещё не было — выбей кого-нибудь первым'
        : 'Первого нокаута в клубе ещё не было';
    case 'hunter':
      if (c === 0)
        return isMe ? `Выбей ${T.hunterKos} игроков за один вечер` : 'Нокаутов пока не было';
      return isMe
        ? `Лучший вечер — ${kosCount(c)}, нужно ${T.hunterKos} за вечер`
        : `Лучший вечер — ${kosCount(c)}`;
    case 'comeback':
      return isMe
        ? `Выиграй вечер, в котором понадобилось ${pluralWithNumber(T.comebackRebuys, REBUY_FORMS)} и больше`
        : ACHIEVEMENT_META.comeback.description;
    case 'hat_trick':
      if (c === 0)
        return isMe ? `Выиграй ${T.hatTrickWins} вечера подряд` : 'Серии побед сейчас нет';
      return isMe
        ? `Побед подряд сейчас: ${c}, до ачивки — ${winsCount(left)}`
        : `Побед подряд сейчас: ${c}`;
    case 'sworn_enemy':
      if (!p.victimId || c === 0)
        return isMe
          ? `Выбей одного и того же соперника ${pluralWithNumber(T.swornEnemyKos, TIMES_FORMS)}`
          : 'Нокаутов пока не было';
      // Не «чаще всех»: это не Немезида (у той же жертвы может быть игрок с тем же счётом), а
      // лучший счёт этого игрока против одного соперника. Имя — после «против игрока», чтобы его
      // нельзя было прочитать как подлежащее.
      return isMe
        ? `Больше всего нокаутов у тебя — против игрока ${nameOf(p.victimId)}: ${c}. До ачивки — ${kosCount(left)}`
        : `Больше всего нокаутов — против игрока ${nameOf(p.victimId)}: ${c}`;
    case 'oracle':
      if (c === 0)
        return isMe
          ? `Угадай победителя в ${T.oracleStreak} прогнозах подряд`
          : 'Серии угаданных прогнозов сейчас нет';
      return isMe
        ? `Угадано победителей подряд: ${c}, до ачивки — ${pluralWithNumber(left, PREDICTION_FORMS)}`
        : `Угадано победителей подряд: ${c}`;
    case 'star':
      return isMe
        ? 'Победи в номинации голосования после вечера'
        : ACHIEVEMENT_META.star.description;
    case 'iron_chair':
      if (target === 0) return 'В этом сезоне ещё не было вечеров';
      if (!p.possible)
        return isMe
          ? 'В этом сезоне уже есть пропуск — снова в игре со следующего сезона'
          : 'В этом сезоне уже есть пропуск';
      return isMe
        ? 'Все вечера сезона без пропусков — не пропускай до конца'
        : 'Все вечера сезона без пропусков';
    case 'rebuy_king': {
      const leaders = p.leaders ?? [];
      if (leaders.length === 0 || !p.leaderValue) return 'В этом сезоне ребаев ещё не было';
      const value = pluralWithNumber(p.leaderValue, REBUY_FORMS);
      if (leaders.length > 1) return `Больше всех ребаев делят: ${names(leaders)} — ${value}`;
      return `Больше всех ребаев: ${names(leaders)} — ${value}`;
    }
    case 'champion': {
      if (p.current === null)
        return isMe ? 'Твоих вечеров в этом сезоне ещё нет' : 'Вечеров в этом сезоне ещё нет';
      const leaders = p.leaders ?? [];
      if (leaders.length === 0) return 'Очков в сезоне ещё ни у кого нет';
      const points = formatPointsWithUnit(p.leaderValue ?? 0);
      if (leaders.length > 1) return `Первое место делят: ${names(leaders)} — ${points}`;
      return `Лидер сезона: ${names(leaders)} — ${points}`;
    }
  }
}

/** Строка прогресса одной ачивки. */
export function progressView(p: AchievementProgress, opts: ProgressViewOptions): ProgressView {
  const title = ACHIEVEMENT_META[p.code].title;
  const hint = hintFor(p, opts);
  const c = p.current ?? 0;
  const target = p.target ?? 0;
  let bar: ProgressView['bar'] = null;
  let aside: string | null = null;
  let ratio = 0;

  if (p.measure === 'place') {
    if (p.current !== null) {
      aside = `${p.current}-е место`;
      ratio = 1 / p.current;
    }
  } else if (p.measure === 'count' && p.code !== 'first_blood' && target > 0) {
    if (p.code === 'iron_chair' && !p.possible) aside = 'пропуск';
    else {
      bar = countBar(c, target);
      ratio = Math.min(1, c / target);
    }
  }
  return { code: p.code, title, bar, aside, hint, muted: !p.possible, ratio };
}

export interface ProgressGroups {
  /** Сезонные: гонка текущего сезона. */
  season: ProgressView[];
  /** Неполученные с уже начатым счётчиком — ближние сверху. */
  close: ProgressView[];
  /** Остальные неполученные: счётчик на нуле или только условие. */
  rest: ProgressView[];
}

/** Раскладка прогресса по блокам карточки. Порядок внутри season и rest — как у домена. */
export function groupProgress(views: readonly ProgressView[]): ProgressGroups {
  const season = views.filter((v) => SEASONAL_CODES.has(v.code));
  const other = views.filter((v) => !SEASONAL_CODES.has(v.code));
  const close = other
    .filter((v) => v.bar !== null && v.bar.value > 0)
    .sort((a, b) => b.ratio - a.ratio);
  const rest = other.filter((v) => !close.includes(v));
  return { season, close, rest };
}
