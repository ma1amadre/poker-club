// Фото к голосам: приватный бакет vote-photos (2 МБ, jpeg/webp). Путь задан контрактом:
// {evening_id}/{player_id}/{category}-{random}.jpg — политика Storage пускает загрузку только
// в папку, где второй сегмент равен current_player_id().
import type { VoteCategory } from '@domain/votes.ts';
import { useQuery } from '@tanstack/react-query';
import { compressImage } from '../lib/image';
import { supabase } from '../supabase';
import { toError } from './errors';
import { queryKeys } from './keys';

export const VOTE_PHOTOS_BUCKET = 'vote-photos';

export interface VotePhotoTarget {
  eveningId: string;
  /** Текущий игрок (useCurrentPlayer().id) — иначе Storage отклонит загрузку. */
  playerId: string;
  category: VoteCategory;
}

function randomSuffix(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Сжимает фото (длинная сторона ≤ 1600, JPEG 0.8, ≤ 2 МБ) и загружает его. Возвращает путь
 * для castVote({ photoPath }).
 */
export async function uploadVotePhoto(file: Blob, target: VotePhotoTarget): Promise<string> {
  const blob = await compressImage(file);
  const path = `${target.eveningId}/${target.playerId}/${target.category}-${randomSuffix()}.jpg`;
  const { error } = await supabase.storage.from(VOTE_PHOTOS_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw toError(error);
  return path;
}

/** Удалить своё фото (или любое — админ), например после отзыва голоса или замены фото. */
export async function removeVotePhoto(path: string): Promise<void> {
  const { error } = await supabase.storage.from(VOTE_PHOTOS_BUCKET).remove([path]);
  if (error) throw toError(error);
}

const SIGNED_URL_TTL_S = 60 * 60;

/** Временная ссылка на фото из приватного бакета (живёт час, кешируется чуть меньше). */
export function useVotePhotoUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.votePhoto(path ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(VOTE_PHOTOS_BUCKET)
        .createSignedUrl(path ?? '', SIGNED_URL_TTL_S);
      if (error) throw toError(error);
      return data.signedUrl;
    },
    enabled: Boolean(path),
    staleTime: (SIGNED_URL_TTL_S - 5 * 60) * 1000,
    gcTime: (SIGNED_URL_TTL_S - 5 * 60) * 1000,
  });
}
