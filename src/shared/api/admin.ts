// Админские правки справочников. RLS пускает insert/update в players, settings, formats, evenings
// только is_admin(); для остальных запрос вернёт ошибку прав, и её покажет тост.
import type { TournamentFormat } from '@domain/types.ts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, type TablesInsert, type TablesUpdate } from '../supabase';
import { toError } from './errors';
import { queryKeys } from './keys';
import {
  toEvening,
  toFormatRow,
  type Evening,
  type EveningStatus,
  type FormatRow,
  type Player,
  type Settings,
} from './types';

/** Настройки клуба: строка id = 1 создаётся миграцией, поэтому update, а не insert. */
export async function upsertSettings(
  patch: Omit<TablesUpdate<'settings'>, 'id' | 'updated_at'>,
): Promise<Settings> {
  const { data, error } = await supabase
    .from('settings')
    .update(patch)
    .eq('id', 1)
    .select('*')
    .single();
  if (error) throw toError(error);
  return data;
}

export type FormatInput = Omit<TablesInsert<'formats'>, 'config' | 'created_at'> & {
  config: TournamentFormat;
};

/** Создать (без id) или изменить формат. Конфиг проверяйте validateFormat до сохранения. */
export async function upsertFormat(input: FormatInput): Promise<FormatRow> {
  const { data, error } = await supabase
    .from('formats')
    .upsert({ ...input, config: input.config as unknown as TablesInsert<'formats'>['config'] })
    .select('*')
    .single();
  if (error) throw toError(error);
  return toFormatRow(data);
}

export type PlayerInput = Omit<TablesInsert<'players'>, 'created_at' | 'auth_user_id'>;

/**
 * Создать игрока (гость — без tg_id) или изменить. auth_user_id не трогаем: его проставляет
 * tg-auth при первом входе, а перезапись отвязала бы игрока от его входа.
 */
export async function upsertPlayer(input: PlayerInput): Promise<Player> {
  const { data, error } = await supabase.from('players').upsert(input).select('*').single();
  if (error) throw toError(error);
  return data;
}

export type EveningInput = Omit<
  TablesInsert<'evenings'>,
  'format' | 'status' | 'board_token' | 'created_at'
> & {
  format: TournamentFormat;
  status?: EveningStatus;
};

/**
 * Создать или изменить вечер. Формат — снимок (копия config выбранного формата), чтобы правка
 * пресета не переписывала уже сыгранные вечера. Статусы live/finished/settled меняют RPC —
 * сюда передавайте status только для отмены ('cancelled') или возврата отменённого ('announced').
 */
export async function upsertEvening(input: EveningInput): Promise<Evening> {
  const { data, error } = await supabase
    .from('evenings')
    .upsert({ ...input, format: input.format as unknown as TablesInsert<'evenings'>['format'] })
    .select('*')
    .single();
  if (error) throw toError(error);
  return toEvening(data);
}

export function useUpsertSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
      // От настроек зависят очки (ko_points, win_bonus) и зачёт лучших N вечеров.
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useUpsertFormat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertFormat,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.formats }),
  });
}

export function useUpsertPlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertPlayer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
      // Гость ↔ постоянный игрок меняет рейтинг и ачивки.
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

/**
 * Удалить тренировочный вечер целиком (миграция 023, только админ; обычный вечер сервер не даст):
 * журнал, ответы, прогнозы и гостей, которых завели на нём. Возвращает, сколько гостей удалено.
 */
export async function deleteTrainingEvening(eveningId: string): Promise<{ guestsDeleted: number }> {
  const { data, error } = await supabase.rpc('delete_training_evening', { p_evening: eveningId });
  if (error) throw toError(error);
  const guests = (data as { guestsDeleted?: unknown } | null)?.guestsDeleted;
  return { guestsDeleted: typeof guests === 'number' ? guests : 0 };
}

export function useDeleteTrainingEvening() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTrainingEvening,
    onSuccess: (_result, eveningId) => {
      queryClient.removeQueries({ queryKey: queryKeys.evening(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.players });
    },
  });
}

/**
 * Засчитать завершённую тренировку как настоящий вечер (миграция 026, только админ, в одну сторону):
 * вечер попадает в историю, рейтинг, ачивки и ленту, голосование открыто 24 ч с момента зачёта.
 * Номер игры в дне — следующий свободный на дату вечера. Пост итогов в группу клиент просит сразу
 * (notify), не дошедший добьёт cron-tick.
 */
export async function promoteTrainingEvening(
  eveningId: string,
): Promise<{ gameNo: number; votingClosesAt: string | null }> {
  const { data, error } = await supabase.rpc('promote_training_evening', { p_evening: eveningId });
  if (error) throw toError(error);
  const row = (data ?? {}) as { gameNo?: unknown; votingClosesAt?: unknown };
  return {
    gameNo: typeof row.gameNo === 'number' ? row.gameNo : 1,
    votingClosesAt: typeof row.votingClosesAt === 'string' ? row.votingClosesAt : null,
  };
}

export function usePromoteTrainingEvening() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: promoteTrainingEvening,
    onSuccess: (_result, eveningId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.evening(eveningId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningsAll });
      // Вечер вошёл в историю: рейтинг, ачивки, лента, расчёты.
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}

export function useUpsertEvening() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: upsertEvening,
    onSuccess: (evening) => {
      queryClient.setQueryData(queryKeys.evening(evening.id), evening);
      void queryClient.invalidateQueries({ queryKey: queryKeys.eveningsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clubHistory });
    },
  });
}
