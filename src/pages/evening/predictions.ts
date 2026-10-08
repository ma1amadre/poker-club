// Прогнозы вечера — чистые помощники: кого можно назвать в прогнозе (шторка прогноза на экране
// вечера и на главной) и раскладка прогнозов после финала (блок «Прогнозы вечера» на экране итога).
// Очки считает домен (scorePrediction), здесь только порядок строк и подписи.
import { PREDICTION_POINTS, scorePrediction, type PredictionOutcome } from '@domain/predictions.ts';
import { spectatesEvening } from '@domain/spectators.ts';
import type { PlayerId } from '@domain/types.ts';
// Только чистое форматирование, без React: модуль тестируется в node.
import { NBSP, plural } from '../../shared/lib/format';
import { RSVP_ORDER, type RsvpStatus } from '../../shared/api/types';

// --- Кандидаты в прогноз ---------------------------------------------------------------------

export interface CandidatePlayer {
  id: string;
  display_name: string;
  is_guest: boolean;
  is_active: boolean;
  /** Болельщик (миграция 024); нет поля — игрок. */
  is_spectator?: boolean | null;
}

export interface Candidate<P> {
  player: P;
  rsvp: RsvpStatus | null;
  /** Болельщик на этот вечер (в списке только из сохранённого прогноза) — подпись «болельщик». */
  spectator?: boolean;
}

function byName(a: CandidatePlayer, b: CandidatePlayer): number {
  return a.display_name.localeCompare(b.display_name, 'ru') || (a.id < b.id ? -1 : 1);
}

/**
 * Кого можно назвать в прогнозе: все активные игроки — сначала постоянные (идут, под вопросом,
 * не ответили, не идут; внутри — по имени), за ними гости по имени. Гость на анонс не отвечает
 * (войти в приложение он не может), поэтому ставить на него можно всегда. Болельщика (миграция 024)
 * в списке нет, пока он не ответил «иду» / «под вопросом» и не сидит за столом (`seated` —
 * seatedIds журнала): играть он не собирается. Игроки из уже сохранённого прогноза остаются в
 * списке, даже если перестали подходить.
 */
export function predictionCandidates<P extends CandidatePlayer>(
  players: readonly P[],
  rsvps: readonly { player_id: string; status: RsvpStatus }[],
  keepIds: readonly (string | null | undefined)[] = [],
  seated: ReadonlySet<string> = new Set(),
): Candidate<P>[] {
  const status = new Map<string, RsvpStatus>();
  for (const r of rsvps) status.set(r.player_id, r.status);
  const keep = new Set(keepIds.filter((id): id is string => Boolean(id)));
  const spectates = (p: P) =>
    spectatesEvening({
      spectator: p.is_spectator,
      rsvp: status.get(p.id),
      seated: seated.has(p.id),
    });
  return players
    .filter((p) => (p.is_active && !spectates(p)) || keep.has(p.id))
    .map((player) => ({
      player,
      rsvp: status.get(player.id) ?? null,
      spectator: spectates(player),
    }))
    .sort(
      (a, b) =>
        Number(a.player.is_guest) - Number(b.player.is_guest) ||
        (a.player.is_guest ? 0 : RSVP_ORDER[a.rsvp ?? 'none'] - RSVP_ORDER[b.rsvp ?? 'none']) ||
        byName(a.player, b.player),
    );
}

/**
 * Подпись к кандидату в прогнозе: гость — «гость», постоянный — как ответил на анонс; болельщик,
 * оставшийся в списке из сохранённого прогноза, — «болельщик».
 */
export function candidateHint(candidate: Candidate<CandidatePlayer>): string {
  if (candidate.player.is_guest) return 'гость';
  const hint = rsvpHint(candidate.rsvp);
  return candidate.spectator ? `болельщик · ${hint}` : hint;
}

/** Подпись к игроку в прогнозе: как он ответил на анонс. */
export function rsvpHint(status: RsvpStatus | null): string {
  if (status === 'yes') return 'идёт';
  if (status === 'maybe') return 'под вопросом';
  if (status === 'no') return 'не идёт';
  return 'без ответа';
}

/** Строка шторки прогноза: очки прогнозов не смешиваются с очками сезона. */
export const ORACLE_NOTE = 'Очки Оракула — отдельная таблица, в сезон не идут.';

// --- Прогнозы после финала -------------------------------------------------------------------

export interface PredictionLike {
  player_id: string;
  winner_id: string | null;
  first_out_id: string | null;
}

export interface PredictionResult {
  playerId: PlayerId;
  winnerId: PlayerId | null;
  firstOutId: PlayerId | null;
  winnerHit: boolean;
  firstOutHit: boolean;
  /** Очки Оракула за этот прогноз (домен: 3 за победителя, 2 за первый вылет). */
  points: number;
}

/**
 * Прогнозы вечера с итогом: кто на кого ставил и сколько очков Оракула получил. Пустые прогнозы
 * (сняты до старта) не показываются. Порядок: больше очков — выше, при равенстве — свой прогноз,
 * дальше по имени.
 */
export function predictionResults(
  predictions: readonly PredictionLike[],
  outcome: PredictionOutcome,
  nameOf: (id: PlayerId) => string,
  meId?: PlayerId | null,
): PredictionResult[] {
  return predictions
    .filter((p) => p.winner_id !== null || p.first_out_id !== null)
    .map((p) => {
      const score = scorePrediction({ winnerId: p.winner_id, firstOutId: p.first_out_id }, outcome);
      return {
        playerId: p.player_id,
        winnerId: p.winner_id,
        firstOutId: p.first_out_id,
        winnerHit: score.winner > 0,
        firstOutHit: score.firstOut > 0,
        points: score.total,
      };
    })
    .sort(
      (a, b) =>
        b.points - a.points ||
        Number(b.playerId === meId) - Number(a.playerId === meId) ||
        nameOf(a.playerId).localeCompare(nameOf(b.playerId), 'ru'),
    );
}

/** «(+3)» у угаданной части прогноза — неразрывно с именем, чтобы не уезжать на новую строку. */
function hitMark(hit: boolean, points: number): string {
  return hit ? `${NBSP}(+${points})` : '';
}

/** Вторая строка прогноза: «победитель — Женя (+3) · первый вылет — Дима». */
export function predictionPickLine(
  row: PredictionResult,
  nameOf: (id: PlayerId) => string,
): string {
  const winner = row.winnerId
    ? `победитель — ${nameOf(row.winnerId)}${hitMark(row.winnerHit, PREDICTION_POINTS.winner)}`
    : 'победитель — не выбран';
  const firstOut = row.firstOutId
    ? `первый вылет — ${nameOf(row.firstOutId)}${hitMark(row.firstOutHit, PREDICTION_POINTS.firstOut)}`
    : 'первый вылет — не выбран';
  return `${winner} · ${firstOut}`;
}

/** «+5 очков» / «0 очков» — очки Оракула за прогноз. */
export function oraclePointsText(points: number): string {
  return `${points > 0 ? '+' : ''}${points}${NBSP}${plural(points, ['очко', 'очка', 'очков'])}`;
}

/** Сколько угадали: «угадали 2 из 5», «угадал 1 из 5», «никто не угадал». Без рода: глагол — к числу. */
function guessedText(hits: number, total: number): string {
  if (hits === 0) return 'никто не угадал';
  return `${hits === 1 ? 'угадал' : 'угадали'} ${hits} из ${total}`;
}

/**
 * Сводка над списком: кто победил и кто вылетел первым и сколько прогнозов это угадали.
 * Победитель ещё не известен (вечер правят) — так и пишем.
 */
export function predictionSummary(
  rows: readonly PredictionResult[],
  outcome: PredictionOutcome,
  nameOf: (id: PlayerId) => string,
): { winner: string; firstOut: string } {
  const winnerId = outcome.places[0];
  const winners = rows.filter((r) => r.winnerId !== null);
  const firstOuts = rows.filter((r) => r.firstOutId !== null);
  return {
    winner:
      winnerId === undefined
        ? 'Победитель ещё не определён'
        : `Победитель — ${nameOf(winnerId)}: ${guessedText(
            winners.filter((r) => r.winnerHit).length,
            winners.length,
          )}`,
    firstOut:
      outcome.firstBustPlayerId === null
        ? 'Первого вылета не было'
        : `Первый вылет — ${nameOf(outcome.firstBustPlayerId)}: ${guessedText(
            firstOuts.filter((r) => r.firstOutHit).length,
            firstOuts.length,
          )}`,
  };
}
