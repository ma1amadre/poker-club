// «Твой вечер» — подписи строк к доменному eveningRecap (что вечер значил лично для игрока).
// Ничего не считает: нокауты, прогноз, места в сезоне, ачивки и рекорды — из домена (recap.ts,
// records.ts); подписи ачивок и значения рекордов — общие с лентой (shared/lib/clubLife).
import { ACHIEVEMENT_META } from '@domain/achievements.ts';
import type { TitleChange } from '@domain/feed.ts';
import type { EveningRecap } from '@domain/recap.ts';
import type { PlayerId } from '@domain/types.ts';
// Только чистое форматирование (Intl), без React: модуль тестируется в node.
import { ACHIEVEMENT_SHORT, recordTitleLower, recordValueText } from '../../shared/lib/clubLife';
import { NBSP, plural } from '../../shared/lib/format';
import { paths } from '../../shared/lib/paths';
import { formatSeason } from '../../shared/lib/season';
import { formatPointsWithUnit, joinNames, placeLabel, signedNumber } from '../../shared/lib/text';
import type { IconName } from '../../shared/ui/icons';

// --- Строки «Твоего вечера» ------------------------------------------------------------------

export type NameOf = (id: PlayerId) => string;

/** Строка карточки: значок, факт, подробности, куда ведёт тап (если есть). */
export interface RecapLine {
  key: string;
  icon: IconName;
  title: string;
  detail: string | null;
  to?: string;
}

/** Что игрок назвал в прогнозе (строка predictions) — чтобы не писать про поле, которого не было. */
export interface PredictionPick {
  winnerId: PlayerId | null;
  firstOutId: PlayerId | null;
}

/** «2-е место из 5 · 4,5 очка · +300 ₽» — результат одной строкой (экран вечера). */
export function recapResultLine(recap: EveningRecap): string | null {
  if (!recap.played) return null;
  return [
    placeLabel(recap.place, recap.entrants),
    recap.points !== null ? formatPointsWithUnit(recap.points) : null,
    recap.netRub !== null ? `${signedNumber(recap.netRub)}${NBSP}₽` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** «Дима — 2, Женя — 1 (в дележе)». */
function kosDetail(recap: EveningRecap, nameOf: NameOf): string {
  return recap.kosBy
    .map((k) => {
      const shared =
        k.shared === 0 ? '' : k.shared === k.count ? ' (в дележе)' : ` (${k.shared} в дележе)`;
      return `${nameOf(k.victimId)} — ${k.count}${shared}`;
    })
    .join(', ');
}

/**
 * «Саша (до ребая), Дима и Женя (в дележе)». Нокаут в дележе помечен, как в «Твоих нокаутах»:
 * иначе «Дима и Женя» читались бы как два отдельных вылета. Пустой by — вылет без отметки, кто выбил.
 */
function bustsDetail(recap: EveningRecap, nameOf: NameOf): string {
  return recap.bustedBy
    .map((b) => {
      const who = b.by.length > 0 ? joinNames(b.by.map(nameOf)) : 'вылет без отметки, кто выбил';
      const notes = [b.by.length > 1 && 'в дележе', !b.final && 'до ребая'].filter(Boolean);
      return notes.length > 0 ? `${who} (${notes.join(', ')})` : who;
    })
    .join(', ');
}

function predictionLine(recap: EveningRecap, pick: PredictionPick | null): RecapLine {
  const p = recap.prediction;
  if (!p.made) {
    return {
      key: 'prediction',
      icon: 'eye',
      title: 'Прогноза на этот вечер не было',
      detail: null,
    };
  }
  const parts = [
    pick?.winnerId ? `победитель ${p.winnerHit ? 'угадан' : 'не угадан'}` : null,
    pick?.firstOutId ? `первый вылет ${p.firstOutHit ? 'угадан' : 'не угадан'}` : null,
  ].filter(Boolean);
  return {
    key: 'prediction',
    icon: 'eye',
    title:
      p.points > 0 ? `Прогноз — +${formatPointsWithUnit(p.points)} Оракула` : 'Прогноз без очков',
    detail: parts.length > 0 ? capitalizeFirst(parts.join(', ')) : null,
  };
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Место в сезоне до → после: стрелка-значок и слово, цвет смысла не несёт. */
function seasonLine(recap: EveningRecap): RecapLine | null {
  const before = recap.seasonPlaceBefore;
  const after = recap.seasonPlaceAfter;
  if (after === null) return null;
  const season = formatSeason(recap.seasonKey);
  if (before === null) {
    return {
      key: 'season',
      icon: 'trending-up',
      title: `Место в сезоне — ${after}-е`,
      detail: `Первый вечер в сезоне: ${season}`,
      to: paths.rating,
    };
  }
  const delta = recap.seasonPlaceDelta ?? before - after;
  const places = (n: number) => `${n}${NBSP}${plural(n, ['место', 'места', 'мест'])}`;
  return {
    key: 'season',
    icon: delta > 0 ? 'trending-up' : delta < 0 ? 'trending-down' : 'minus',
    title: `Место в сезоне: ${before}-е → ${after}-е`,
    detail:
      delta > 0
        ? `Выше на ${places(delta)} · ${season}`
        : delta < 0
          ? `Ниже на ${places(-delta)} · ${season}`
          : `Без изменений · ${season}`,
    to: paths.rating,
  };
}

/** Смена званий, которая касается игрока: получил, отдал или у него новая Немезида. */
function titleLines(changes: readonly TitleChange[], meId: PlayerId, nameOf: NameOf): RecapLine[] {
  const out: RecapLine[] = [];
  // Новые Немезиды у самого игрока — одной строкой: после вечера с нокаутами их бывает несколько.
  const mine: PlayerId[] = [];
  for (const t of changes) {
    const key = `title:${t.title}:${t.victimId ?? ''}`;
    if (t.title === 'form') {
      if (t.to === meId) {
        out.push({
          key,
          icon: 'crown',
          title: 'Звание «Форма» — теперь у тебя',
          detail: 'Больше всех очков за последние 5 вечеров клуба',
          to: paths.player(meId),
        });
      } else if (t.from === meId) {
        out.push({
          key,
          icon: 'crown',
          title: `Звание «Форма» перешло: теперь — ${nameOf(t.to)}`,
          detail: null,
          to: paths.player(t.to),
        });
      }
      continue;
    }
    const victim = t.victimId;
    if (!victim) continue;
    if (victim === meId) {
      out.push({
        key,
        icon: 'crown',
        title: `Твоя Немезида теперь — ${nameOf(t.to)}`,
        detail: 'Чаще всех выбивает тебя',
        to: paths.player(t.to),
      });
    } else if (t.to === meId) {
      mine.push(victim);
    } else if (t.from === meId) {
      out.push({
        key,
        icon: 'crown',
        title: `Немезида игрока ${nameOf(victim)} теперь — ${nameOf(t.to)}`,
        detail: null,
        to: paths.player(victim),
      });
    }
  }
  const [only] = mine;
  if (only !== undefined) {
    const many = mine.length > 1;
    out.unshift({
      key: 'title:nemesis:mine',
      icon: 'crown',
      title: `Ты — Немезида ${many ? 'игроков' : 'игрока'} ${joinNames(mine.map(nameOf))}`,
      detail: many ? 'Чаще всех выбиваешь этих игроков' : 'Чаще всех выбиваешь этого игрока',
      to: paths.player(many ? meId : only),
    });
  }
  return out;
}

/** Новые ачивки этого вечера. */
function achievementLines(recap: EveningRecap, meId: PlayerId): RecapLine[] {
  return recap.newAchievements.map((a) => ({
    key: `achievement:${a.code}`,
    icon: 'shield-check',
    title: `Новая ачивка «${ACHIEVEMENT_META[a.code].title}»`,
    detail: capitalizeFirst(ACHIEVEMENT_SHORT[a.code]),
    to: paths.player(meId),
  }));
}

/**
 * Строки «Твоего вечера» по порядку: кого выбил, кто выбил тебя, прогноз, новые ачивки, место
 * в сезоне, рекорды, звания. Не игравшему, но сделавшему прогноз — только прогноз с очками
 * Оракула и новые ачивки (ход к «Оракулу»). Пустой список — карточку не показываем.
 */
export function recapLines(
  recap: EveningRecap,
  meId: PlayerId,
  nameOf: NameOf,
  pick: PredictionPick | null,
): RecapLine[] {
  if (!recap.played) {
    if (!recap.prediction.made) return [];
    return [predictionLine(recap, pick), ...achievementLines(recap, meId)];
  }
  const lines: RecapLine[] = [];

  lines.push(
    recap.kos > 0
      ? {
          key: 'kos',
          icon: 'zap',
          title: `Твои нокауты — ${recap.kos}`,
          detail: kosDetail(recap, nameOf),
        }
      : { key: 'kos', icon: 'zap', title: 'Без нокаутов в этот вечер', detail: null },
  );

  if (recap.bustedBy.length > 0) {
    lines.push({
      key: 'busted',
      icon: 'user-x',
      title: recap.bustedBy.length > 1 ? 'Кто тебя выбивал' : 'Кто тебя выбил',
      detail: capitalizeFirst(bustsDetail(recap, nameOf)),
    });
  }

  lines.push(predictionLine(recap, pick));

  lines.push(...achievementLines(recap, meId));

  const season = seasonLine(recap);
  if (season) lines.push(season);

  for (const r of recap.records) {
    const value = recordValueText(r.kind, r.value);
    lines.push({
      key: `record:${r.kind}`,
      icon: 'trending-up',
      title: r.status === 'new' ? 'Новый рекорд клуба' : 'Рекорд клуба повторён',
      detail: `${capitalizeFirst(recordTitleLower(r.kind))} — ${value}${
        r.status === 'new' && r.previous !== null
          ? `, прежний — ${recordValueText(r.kind, r.previous)}`
          : ''
      }`,
      to: paths.ratingRecords,
    });
  }

  lines.push(...titleLines(recap.titleChanges, meId, nameOf));
  return lines;
}
