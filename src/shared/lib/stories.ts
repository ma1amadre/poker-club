// Истории клуба на экранах: «Сюжет вечера» (экран итога и табло), «На кону» (карточка анонса) и
// подписи «Олл-инов вечера». Что рассказывать, считает домен (eveningStory, eveningStakes,
// allIns.ts); здесь только текст. О людях — в настоящем времени и без рода; если речь о самом
// игроке (meId), — на «ты»: «Ты забираешь олл-ин с 13 % до флопа». Табло meId не передаёт.
// Те же истории в постах бота — _shared/messages.ts (к группе, без «ты»).
import { ACHIEVEMENT_META } from '@domain/achievements.ts';
import type { AllIn, AllInSwing } from '@domain/allins.ts';
import { standingPlace } from '@domain/recap.ts';
import type { Street } from '@domain/showdown.ts';
import type { SeasonStakes, StakeItem } from '@domain/stakes.ts';
import type { StoryItem } from '@domain/story.ts';
import type { PlayerId } from '@domain/types.ts';
import { recordTitleLower, recordValueText } from './clubLife';
import { formatRub, NBSP, plural } from './format';
import { cardLabel } from './poker/cards';
import { formatSeason } from './season';
import { formatPointsWithUnit, joinNames } from './text';

export type NameOf = (playerId: PlayerId) => string;

/** Как называть людей в строке: «ты» — себя, остальных по имени. */
interface Who {
  /** Подлежащее: «Женя» / «ты». */
  name: (id: PlayerId) => string;
  me: (id: PlayerId) => boolean;
}

function who(nameOf: NameOf, meId?: string | null): Who {
  return {
    name: (id) => (meId && id === meId ? 'ты' : nameOf(id)),
    me: (id) => Boolean(meId && id === meId),
  };
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Улица в предложении: «до флопа», «на флопе». */
export const STREET_PHRASE: Readonly<Record<Street, string>> = {
  preflop: 'до флопа',
  flop: 'на флопе',
  turn: 'на тёрне',
  river: 'на ривере',
};

/** «13 %»; ноль на табло — «меньше 1 %». */
export function pctText(pct: number): string {
  return pct > 0 ? `${pct}${NBSP}%` : `меньше 1${NBSP}%`;
}

// --- Сюжет вечера ---------------------------------------------------------------------------

/** Строка сюжета: «Женя забирает олл-ин с 13 % до флопа; фаворит — Саша, 87 %.» */
export function storyLine(item: StoryItem, nameOf: NameOf, meId?: string | null): string {
  const w = who(nameOf, meId);
  switch (item.kind) {
    case 'swing': {
      const s = item.swing;
      const favs = s.favoriteIds.map(w.name);
      const fav =
        favs.length > 1
          ? `фавориты — ${joinNames(favs)}, по ${pctText(s.favoritePct)}`
          : `фаворит — ${favs[0] ?? 'игрок'}, ${pctText(s.favoritePct)}`;
      const verb = w.me(s.winnerId) ? 'забираешь' : 'забирает';
      return `${capitalize(w.name(s.winnerId))} ${verb} олл-ин с ${pctText(s.pct)} ${STREET_PHRASE[s.street]}; ${fav}.`;
    }
    case 'revenge': {
      const killer = w.name(item.playerId);
      const verb = w.me(item.playerId) ? 'выбиваешь' : 'выбивает';
      const victim = w.me(item.nemesisId) ? 'тебя' : `игрока ${nameOf(item.nemesisId)}`;
      return `Месть Немезиде: ${killer} ${verb} ${victim}.`;
    }
    case 'phoenix':
      return `Феникс вечера — ${w.name(item.playerId)}: первый вылет и победа.`;
    case 'comeback': {
      const verb = w.me(item.playerId) ? 'выигрываешь' : 'выигрывает';
      const after = item.rebuys === 1 ? 'после ребая' : `после ${item.rebuys} ребаев`;
      return `${capitalize(w.name(item.playerId))} ${verb} вечер ${after}.`;
    }
    case 'record': {
      const r = item.record;
      const holders = r.playerIds.length > 0 ? `${joinNames(r.playerIds.map(w.name))}, ` : '';
      const label = r.status === 'new' ? 'Новый рекорд клуба' : 'Рекорд клуба повторён';
      return `${label}: ${recordTitleLower(r.kind)} — ${holders}${recordValueText(r.kind, r.value)}.`;
    }
    case 'season_leader': {
      const [leader] = item.leaders;
      if (!leader) return '';
      if (item.leaders.length > 1)
        return `На первом месте сезона — ${joinNames(item.leaders.map((l) => w.name(l.playerId)))}.`;
      const points = formatPointsWithUnit(leader.total);
      return item.leadersBefore.includes(leader.playerId)
        ? `${capitalize(w.name(leader.playerId))} — единоличный лидер сезона, ${points}.`
        : `Новый лидер сезона — ${w.name(leader.playerId)}, ${points}.`;
    }
  }
}

// --- На кону -------------------------------------------------------------------------------

const winsText = (n: number): string => `${n}${NBSP}${plural(n, ['победа', 'победы', 'побед'])}`;

/** Шаг «На кону»: «Женя — в одной победе от ачивки «Хет-трик»». */
export function stakeLine(item: StakeItem, nameOf: NameOf, meId?: string | null): string {
  const w = who(nameOf, meId);
  switch (item.kind) {
    case 'win_step': {
      const record =
        item.record === 'new'
          ? `рекорда клуба (${winsText(item.streak)} подряд)`
          : item.record === 'equal'
            ? `повтора рекорда клуба (${winsText(item.streak)} подряд)`
            : null;
      const goals = [item.hatTrick ? `ачивки «${ACHIEVEMENT_META.hat_trick.title}»` : null, record]
        .filter((x): x is string => x !== null)
        .join(' и ');
      return `${capitalize(w.name(item.playerId))} — в одной победе от ${goals}.`;
    }
    case 'enemy_step':
      return (
        `${capitalize(w.name(item.playerId))} — в одном нокауте от ачивки ` +
        `«${ACHIEVEMENT_META.sworn_enemy.title}» (цель — ${w.name(item.victimId)}).`
      );
    case 'first_blood':
      return `Первый нокаут в истории клуба принесёт ачивку «${ACHIEVEMENT_META.first_blood.title}».`;
    case 'pool_record':
      return (
        `Идут ${item.going} — фонд ещё до ребаев ${item.status === 'new' ? 'побьёт' : 'повторит'} ` +
        `рекорд клуба (${formatRub(item.recordRub)}).`
      );
    case 'oracle_step':
      return `${capitalize(w.name(item.playerId))} — в одном угаданном победителе от ачивки «${ACHIEVEMENT_META.oracle.title}».`;
  }
}

/** Расклад сезона перед вечером строками; сказать нечего — пусто. С meId — ещё и своё место. */
export function seasonStakeLines(
  season: SeasonStakes,
  nameOf: NameOf,
  meId?: string | null,
): string[] {
  const w = who(nameOf, meId);
  if (season.first)
    return [`Первый вечер сезона: ${formatSeason(season.seasonKey)} начинается с нуля.`];
  const [leader] = season.leaders;
  if (!leader) return [];
  const lines: string[] = [];
  if (season.leaders.length > 1) {
    // Без глагола: «делят ты и Саша» не согласуется.
    lines.push(
      `На первом месте сезона — ${joinNames(season.leaders.map((l) => w.name(l.playerId)))}, ` +
        `по ${formatPointsWithUnit(leader.total)}.`,
    );
  } else {
    const head = `Лидер сезона — ${w.name(leader.playerId)}, ${formatPointsWithUnit(leader.total)}`;
    const [chaser] = season.chasers;
    if (!chaser) lines.push(`${head}.`);
    else {
      const names = joinNames(season.chasers.map((c) => w.name(c.playerId)));
      const gap =
        chaser.gap === 0 ? 'вровень по очкам' : `отставание ${formatPointsWithUnit(chaser.gap)}`;
      lines.push(`${head}; следом — ${names}, ${gap}.`);
    }
  }
  // Своё место — если его не назвали выше.
  if (meId && ![...season.leaders, ...season.chasers].some((r) => r.playerId === meId)) {
    const place = standingPlace(season.rows, meId);
    const row = season.rows.find((r) => r.playerId === meId);
    if (place !== null && row) {
      const gap = Math.round((leader.total - row.total) * 1000) / 1000;
      lines.push(`Ты — на ${place}-м месте, до лидера ${formatPointsWithUnit(gap)}.`);
    }
  }
  return lines;
}

// --- Олл-ины вечера ------------------------------------------------------------------------

/** Пометка победителя: «победа с 13 %». */
export function swingPill(swing: Pick<AllInSwing, 'pct'>): string {
  return `победа с ${pctText(swing.pct)}`;
}

/** Пометка проигравшего фаворита: «фаворит, 87 %». */
export function favoritePill(swing: Pick<AllInSwing, 'favoritePct'>): string {
  return `фаворит, ${pctText(swing.favoritePct)}`;
}

/** Карты текстом: «A♠ A♦». */
export function cardsText(cards: readonly string[]): string {
  return cards.map(cardLabel).join(' ');
}

/**
 * Подпись к голосу из раздачи (шторка голосования, «Олл-ины вечера» как подсказки):
 * «A♠ A♦ против 7♣ 2♥ — стол 7♦ 2♠ K♣ 9♥ 3♦». Только карты: имена номинант видит и так.
 */
export function allInCaption(allIn: Pick<AllIn, 'hands' | 'board'>): string {
  const hands = allIn.hands.map((h) => cardsText(h.cards)).join(' против ');
  return allIn.board.length > 0 ? `${hands} — стол ${cardsText(allIn.board)}` : hands;
}
