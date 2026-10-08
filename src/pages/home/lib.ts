// Чистые помощники главной: какой вечер показать, кто идёт, остались ли вечера в сезоне и незакрытые
// расчёты.
// Следующая игра по расписанию — nextGameAt из shared/lib/clubTime. Деньги и места — только доменными функциями.
import { computeMoney, isSettled, paymentsFromEvents, settlement } from '@domain/money.ts';
import { replay } from '@domain/replay.ts';
import { seasonKey } from '@domain/season.ts';
import { spectatesEvening } from '@domain/spectators.ts';
import type { EveningSummary } from '@domain/summary.ts';
import type { EveningEvent, PlayerId, TournamentFormat } from '@domain/types.ts';
import type { EveningStatus, Player, Rsvp } from '../../shared/api';

// --- Ближайший вечер -------------------------------------------------------------------------

export interface UpcomingLike {
  status: EveningStatus;
  scheduled_at: string;
  started_at: string | null;
}

/** Анонс, время которого прошло больше чем на столько, считаем забытым (его должен отменить админ). */
export const STALE_ANNOUNCE_MS = 12 * 60 * 60 * 1000;

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Какой вечер показать на главной: идущая игра важнее анонса; среди анонсов — самый ранний
 * из не забытых. Если остались только забытые анонсы — последний из них, чтобы админ его увидел.
 */
export function pickUpcoming<T extends UpcomingLike>(
  evenings: readonly T[],
  nowMs: number,
): T | null {
  const live = evenings
    .filter((e) => e.status === 'live')
    .sort((a, b) => ms(b.started_at ?? b.scheduled_at) - ms(a.started_at ?? a.scheduled_at));
  if (live[0]) return live[0];

  const announced = evenings
    .filter((e) => e.status === 'announced')
    .sort((a, b) => ms(a.scheduled_at) - ms(b.scheduled_at));
  const fresh = announced.find((e) => ms(e.scheduled_at) >= nowMs - STALE_ANNOUNCE_MS);
  return fresh ?? announced[announced.length - 1] ?? null;
}

/**
 * Тренировка для главной (миграция 023): идущая (последняя начатая) или объявленная, время которой
 * ещё не прошло больше чем на STALE_ANNOUNCE_MS. Забытую тренировку всем не показываем — её удаляет
 * админ. На вход — только тренировки (ближайший настоящий вечер выбирает pickUpcoming без них).
 */
export function pickTraining<T extends UpcomingLike>(
  trainings: readonly T[],
  nowMs: number,
): T | null {
  const live = trainings
    .filter((e) => e.status === 'live')
    .sort((a, b) => ms(b.started_at ?? b.scheduled_at) - ms(a.started_at ?? a.scheduled_at));
  if (live[0]) return live[0];
  return (
    trainings
      .filter((e) => e.status === 'announced' && ms(e.scheduled_at) >= nowMs - STALE_ANNOUNCE_MS)
      .sort((a, b) => ms(a.scheduled_at) - ms(b.scheduled_at))[0] ?? null
  );
}

// --- Состав ----------------------------------------------------------------------------------

export type PlayerLike = Pick<
  Player,
  'id' | 'display_name' | 'photo_url' | 'is_guest' | 'is_active' | 'is_spectator'
>;
export type RsvpLike = Pick<Rsvp, 'player_id' | 'status'>;

export interface RsvpGroups<P> {
  yes: P[];
  maybe: P[];
  no: P[];
  /** Постоянные участники клуба, которые ещё не ответили (кроме болельщиков). */
  silent: P[];
}

/**
 * Ответы на анонс по группам; внутри группы — в порядке ответов (rsvps приходят по updated_at).
 * Болельщика (миграция 024) в «Без ответа» нет, пока его не посадили за стол (`seated` — seatedIds
 * журнала): то же правило, что у поста дня игры (gamedayRoster, сверяет gameday.test.ts).
 */
export function groupRsvps<P extends PlayerLike>(
  players: readonly P[],
  rsvps: readonly RsvpLike[],
  seated: ReadonlySet<string> = new Set(),
): RsvpGroups<P> {
  const byId = new Map(players.map((p) => [p.id, p]));
  const groups: RsvpGroups<P> = { yes: [], maybe: [], no: [], silent: [] };
  const answered = new Set<string>();
  for (const r of rsvps) {
    const p = byId.get(r.player_id);
    if (!p || answered.has(p.id)) continue;
    answered.add(p.id);
    groups[r.status].push(p);
  }
  groups.silent = players
    .filter(
      (p) =>
        p.is_active &&
        !p.is_guest &&
        !answered.has(p.id) &&
        !spectatesEvening({ spectator: p.is_spectator, seated: seated.has(p.id) }),
    )
    .sort(byName);
  return groups;
}

function byName(a: PlayerLike, b: PlayerLike): number {
  return a.display_name.localeCompare(b.display_name, 'ru') || (a.id < b.id ? -1 : 1);
}

/**
 * Оптимистичный ответ на анонс: моя строка заменяется и уходит в конец (rsvps приходят по
 * updated_at, поэтому порядок «кто ответил раньше» сохраняется так же, как после перезапроса).
 */
export function upsertRsvp<R extends RsvpLike & { updated_at: string }>(
  rows: readonly R[],
  mine: R,
): R[] {
  return [...rows.filter((r) => r.player_id !== mine.player_id), mine];
}

// --- Сезон -----------------------------------------------------------------------------------

/**
 * Остался ли в сезоне key несыгранный вечер: идущий или объявленный (кроме забытых анонсов старше
 * STALE_ANNOUNCE_MS — их отменяет админ). Пока он есть, «Гонка сезона» не пишет «Игр в сезоне по
 * расписанию больше нет», даже если слотов расписания в сезоне не осталось: финал в разгаре или
 * перенесён с последнего слота на другой день. На вход — настоящие вечера (без тренировок).
 */
export function seasonEveningPending(
  evenings: readonly UpcomingLike[],
  key: string,
  nowMs: number,
): boolean {
  return evenings.some(
    (e) =>
      seasonKey(e.scheduled_at) === key &&
      (e.status === 'live' ||
        (e.status === 'announced' && ms(e.scheduled_at) >= nowMs - STALE_ANNOUNCE_MS)),
  );
}

// --- Незакрытые расчёты ----------------------------------------------------------------------

export interface SettleEveningLike {
  id: string;
  status: EveningStatus;
  scheduled_at: string;
  banker_id: string | null;
  format: TournamentFormat;
  /** Закрытый расчёт открылся сам из-за правки журнала (миграция 008). */
  settle_reopened_at?: string | null;
}

export interface MyDebt {
  eveningId: string;
  scheduledAt: string;
  bankerId: string | null;
  /** owe — я должен банкиру, await — банкир должен мне. */
  kind: 'owe' | 'await';
  amountRub: number;
  /** Расчёт уже закрывали, но журнал поправили — долг появился снова. */
  reopened: boolean;
}

export interface BankerDuty {
  eveningId: string;
  scheduledAt: string;
  /** Сколько игроков (кроме самого банкира) ещё не рассчитались. */
  pending: number;
  /**
   * Остаток своей строки банкира: по конвенции клуба банкир записывает и свой выигрыш (−) или
   * проигрыш (+) — пока он не ноль, «Закрыть расчёт» неактивна.
   */
  selfRemainingRub: number;
  /** Все строки, включая свою, в нуле — осталось нажать «Закрыть расчёт». */
  allSettled: boolean;
  /** Расчёт уже закрывали, но журнал поправили — закрыть заново. */
  reopened: boolean;
}

export interface OpenSettlements {
  debts: MyDebt[];
  banker: BankerDuty[];
}

/**
 * Мои незакрытые расчёты по вечерам «игра окончена» (не settled): settlement домена по журналу.
 * Банкиру вместо долга — напоминание, пока вечер не «Расчёт закрыт»: сколько игроков ещё не
 * рассчитано, своя строка (её тоже нужно свести в ноль — так её считает экран расчёта) и что
 * осталось нажать «Закрыть расчёт».
 */
export function openSettlements(
  evenings: readonly SettleEveningLike[],
  eventsByEvening: ReadonlyMap<string, readonly EveningEvent[]>,
  meId: PlayerId,
): OpenSettlements {
  const out: OpenSettlements = { debts: [], banker: [] };
  for (const evening of evenings) {
    if (evening.status !== 'finished') continue;
    const events = eventsByEvening.get(evening.id) ?? [];
    const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
    const state = replay(evening.format, events, lastMs);
    if (!state.finished) continue;
    const table = settlement(computeMoney(evening.format, state), paymentsFromEvents(events));

    if (evening.banker_id === meId) {
      const pending = Object.entries(table).filter(
        ([id, row]) => id !== meId && row.status !== 'settled',
      ).length;
      out.banker.push({
        eveningId: evening.id,
        scheduledAt: evening.scheduled_at,
        pending,
        selfRemainingRub: table[meId]?.remainingRub ?? 0,
        allSettled: isSettled(table),
        reopened: Boolean(evening.settle_reopened_at),
      });
      continue;
    }
    const row = table[meId];
    if (!row || row.status === 'settled') continue;
    out.debts.push({
      eveningId: evening.id,
      scheduledAt: evening.scheduled_at,
      bankerId: evening.banker_id,
      kind: row.status === 'owes' ? 'owe' : 'await',
      amountRub: Math.abs(row.remainingRub),
      reopened: Boolean(evening.settle_reopened_at),
    });
  }
  return out;
}

// --- Мой итог вечера -------------------------------------------------------------------------

export interface MyEveningResult {
  /** Место; null — по журналу не определено (не должно случаться после finish). */
  place: number | null;
  /** Сколько было участников (гости тоже). */
  of: number;
  points: number;
  netRub: number;
}

/** Мой результат по итогу вечера из summarize; null — я не играл. Ничего не пересчитывает. */
export function myResult(
  summary: Pick<EveningSummary, 'entrants' | 'places' | 'points' | 'netRub'>,
  meId: PlayerId,
): MyEveningResult | null {
  if (!summary.entrants.includes(meId)) return null;
  const index = summary.places.indexOf(meId);
  return {
    place: index >= 0 ? index + 1 : null,
    of: summary.entrants.length,
    points: summary.points[meId] ?? 0,
    netRub: summary.netRub[meId] ?? 0,
  };
}

// --- Текст -----------------------------------------------------------------------------------

export const UNKNOWN_PLAYER = 'Игрок без имени';

/** Имя игрока по id; null — id пустой. Игрок пропал из справочника — нейтральная подпись. */
export function playerName(
  playersById: ReadonlyMap<string, Pick<Player, 'display_name'>>,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return playersById.get(id)?.display_name ?? UNKNOWN_PLAYER;
}

/** «Саша (ты)» — чтобы в списках себя было видно сразу. */
export function nameWithMe(
  playersById: ReadonlyMap<string, Pick<Player, 'display_name'>>,
  id: string,
  meId: string,
): string {
  const name = playerName(playersById, id) ?? UNKNOWN_PLAYER;
  return id === meId ? `${name} (ты)` : name;
}
