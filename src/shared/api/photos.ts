// Фото к голосам: приватный бакет vote-photos (2 МБ, jpeg/webp). Путь задан контрактом:
// {evening_id}/{player_id}/{12 hex}.jpg — политика Storage (миграция 007) пускает загрузку только
// в свою папку, только участнику вечера при открытом голосовании и только по этому шаблону имени.
// Номинации в имени нет: до закрытия голосования путь не должен выдавать, кто в какой голосовал.
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

/** 12 случайных hex-символов — шаблон имени в политике загрузки. */
function randomName(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Сжимает фото (длинная сторона ≤ 1600, JPEG 0.8, ≤ 2 МБ) и загружает его. Возвращает путь
 * для castVote({ photoPath }).
 */
export async function uploadVotePhoto(file: Blob, target: VotePhotoTarget): Promise<string> {
  const blob = await compressImage(file);
  const path = `${target.eveningId}/${target.playerId}/${randomName()}.jpg`;
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
