// Строки БД, суженные до доменных типов. database.types.ts описывает «сырую» схему (text с check —
// просто string, jsonb — Json); здесь эти поля сужаются до того, что реально допускает БД, чтобы
// страницы работали с union-типами и передавали format/события прямо в домен.
import { DEFAULT_SCORING, type ScoringConfig } from '@domain/scoring.ts';
import type { EveningEvent, EventType, TournamentFormat } from '@domain/types.ts';
import type { VoteCategory } from '@domain/votes.ts';
import type { Tables } from '../supabase';

export type EveningStatus = 'announced' | 'live' | 'finished' | 'settled' | 'cancelled';
export type RsvpStatus = 'yes' | 'no' | 'maybe';

export type Player = Tables<'players'>;

export type Settings = Tables<'settings'>;

export type FormatRow = Omit<Tables<'formats'>, 'config'> & { config: TournamentFormat };

export type Evening = Omit<Tables<'evenings'>, 'status' | 'format'> & {
  status: EveningStatus;
  /** Снимок формата на момент создания вечера. */
  format: TournamentFormat;
};

/** Событие журнала: доменная форма (её принимает replay) плюс служебные поля строки. */
export interface EveningEventRecord extends EveningEvent {
  eveningId: string;
  createdBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
}

export type Rsvp = Omit<Tables<'rsvps'>, 'status'> & { status: RsvpStatus };

export type PredictionRow = Tables<'predictions'>;

export type VoteRow = Omit<Tables<'votes'>, 'category'> & { category: VoteCategory };

/** Ответ board_state (табло без входа). Платежей и отменённых событий в нём нет. */
export interface BoardState {
  evening: Pick<
    Evening,
    'id' | 'scheduled_at' | 'location' | 'status' | 'started_at' | 'finished_at'
  >;
  format: TournamentFormat;
  events: EveningEvent[];
  players: { id: string; display_name: string }[];
}

export const EVENING_STATUS_META: Record<EveningStatus, { title: string }> = {
  announced: { title: 'Анонс' },
  live: { title: 'Идёт игра' },
  finished: { title: 'Игра окончена' },
  settled: { title: 'Расчёт закрыт' },
  cancelled: { title: 'Отменён' },
};

/** Порядок ответов в списках: идут, под вопросом, не ответили, не идут. */
export const RSVP_ORDER: Record<RsvpStatus | 'none', number> = { yes: 0, maybe: 1, none: 2, no: 3 };

export const RSVP_STATUS_META: Record<RsvpStatus, { title: string }> = {
  yes: { title: 'Иду' },
  maybe: { title: 'Под вопросом' },
  no: { title: 'Не иду' },
};

/** Вечер завершён (игра окончена или уже рассчитан) — попадает в статистику. */
export function isFinishedStatus(status: EveningStatus): boolean {
  return status === 'finished' || status === 'settled';
}

// --- Приведение строк БД ---------------------------------------------------------------------
// Значения status/category/type ограничены check-констрейнтами в 001_schema.sql, а format/config
// пишет только админка после validateFormat, поэтому приведение без рантайм-проверки безопасно.

export function toEvening(row: Tables<'evenings'>): Evening {
  return {
    ...row,
    status: row.status as EveningStatus,
    format: row.format as unknown as TournamentFormat,
  };
}

export function toFormatRow(row: Tables<'formats'>): FormatRow {
  return { ...row, config: row.config as unknown as TournamentFormat };
}

export function toEventRecord(row: Tables<'evening_events'>): EveningEventRecord {
  return {
    id: row.id,
    type: row.type as EventType,
    payload: row.payload as unknown as EveningEvent['payload'],
    at: row.at,
    voided: row.voided_at !== null,
    eveningId: row.evening_id,
    createdBy: row.created_by,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
  };
}

export function toRsvp(row: Tables<'rsvps'>): Rsvp {
  return { ...row, status: row.status as RsvpStatus };
}

export function toVote(row: Tables<'votes'>): VoteRow {
  return { ...row, category: row.category as VoteCategory };
}

/** Голос в форме домена (voteResults). */
export function toDomainVote(row: VoteRow): {
  voterId: string;
  category: VoteCategory;
  nomineeId: string;
} {
  return { voterId: row.voter_id, category: row.category, nomineeId: row.nominee_id };
}

/** Конфиг очков из настроек клуба; numeric приходит числом, но страхуемся от строки. */
export function scoringFromSettings(settings: Settings | null | undefined): ScoringConfig {
  const koPoints = Number(settings?.ko_points ?? DEFAULT_SCORING.koPoints);
  const winBonus = Number(settings?.win_bonus ?? DEFAULT_SCORING.winBonus);
  return {
    koPoints: Number.isFinite(koPoints) ? koPoints : DEFAULT_SCORING.koPoints,
    winBonus: Number.isFinite(winBonus) ? winBonus : DEFAULT_SCORING.winBonus,
  };
}
