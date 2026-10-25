// Ссылки-приглашения в клуб (миграция 029): создать, список, отозвать — только админ (проверяют RPC).
// Код приглашения сервер отдаёт один раз — в ответе create_player_invite; в базе лежит только хеш.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase } from '../supabase';
import { toError } from './errors';
import {
  createdInviteQuery,
  createInviteMutation,
  forgetCreatedInvite,
  playerInvitesQuery,
  type CreatedInvite,
} from './inviteQueries';
import { queryKeys } from './keys';

export type { CreatedInvite } from './inviteQueries';

export type PlayerInviteStatus = 'active' | 'used' | 'expired' | 'revoked';

/** Строка list_player_invites: статус на момент запроса, кто вошёл (used). */
export interface PlayerInvite {
  id: string;
  status: PlayerInviteStatus;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  /** Имя вошедшего в клубе; null — не вошёл или профиль удалён. */
  usedByName: string | null;
  revokedAt: string | null;
}

const STATUSES: ReadonlySet<string> = new Set(['active', 'used', 'expired', 'revoked']);

export async function createPlayerInvite(): Promise<CreatedInvite> {
  const { data, error } = await supabase.rpc('create_player_invite');
  if (error) throw toError(error);
  const row = (data ?? {}) as { id?: unknown; code?: unknown; expiresAt?: unknown };
  if (
    typeof row.id !== 'string' ||
    typeof row.code !== 'string' ||
    typeof row.expiresAt !== 'string'
  ) {
    throw new Error('Сервер вернул неожиданный ответ. Обнови приложение и попробуй ещё раз.');
  }
  return { id: row.id, code: row.code, expiresAt: row.expiresAt };
}

export async function fetchPlayerInvites(): Promise<PlayerInvite[]> {
  const { data, error } = await supabase.rpc('list_player_invites');
  if (error) throw toError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    status: (STATUSES.has(r.status) ? r.status : 'expired') as PlayerInviteStatus,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    // Генератор типов не знает, что колонки результата бывают null.
    usedAt: (r.used_at as string | null) ?? null,
    usedBy: (r.used_by as string | null) ?? null,
    usedByName: (r.used_by_name as string | null) ?? null,
    revokedAt: (r.revoked_at as string | null) ?? null,
  }));
}

export async function revokePlayerInvite(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_player_invite', { p_id: id });
  if (error) throw toError(error);
}

/**
 * Список приглашений для админки; пока раздел на экране — перечитывается раз в минуту
 * (inviteQueries.ts). Нет RPC (фронт выложен раньше миграции 029, PostgREST PGRST202) — ошибка с
 * этим кодом в cause: раздел её прячет.
 */
export function usePlayerInvites(enabled = true) {
  return useQuery(playerInvitesQuery(fetchPlayerInvites, enabled));
}

/** «Пригласить игрока»: ссылку забирает useCreatedPlayerInvite — и после ухода с вкладки. */
export function useCreatePlayerInvite() {
  const queryClient = useQueryClient();
  return useMutation(createInviteMutation(queryClient, createPlayerInvite));
}

/** Только что созданная ссылка (её код виден один раз) и «закрыть» — забыть её. */
export function useCreatedPlayerInvite(): [CreatedInvite | null, () => void] {
  const queryClient = useQueryClient();
  const { data } = useQuery(createdInviteQuery());
  const forget = useCallback(() => forgetCreatedInvite(queryClient), [queryClient]);
  return [data ?? null, forget];
}

export function useRevokePlayerInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokePlayerInvite,
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.playerInvites }),
  });
}

/** Ошибка — «RPC ещё нет» (миграция 029 не докатилась). */
export function isMissingRpc(error: unknown): boolean {
  return (error as { cause?: { code?: unknown } } | null)?.cause?.code === 'PGRST202';
}
