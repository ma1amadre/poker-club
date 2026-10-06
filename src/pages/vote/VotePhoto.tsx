// Фото к голосу из приватного бакета: временная ссылка useVotePhotoUrl, заглушка Skeleton на
// время загрузки, понятная строка вместо битой картинки.
import { useState } from 'react';
import { useVotePhotoUrl } from '../../shared/api';
import { Icon, Skeleton } from '../../shared/ui';

export interface VotePhotoProps {
  path: string;
  /** Что на фото для скринридера: «Фото к голосу за Сашу». */
  alt: string;
}

export function VotePhoto({ path, alt }: VotePhotoProps) {
  const url = useVotePhotoUrl(path);
  const [broken, setBroken] = useState<string | null>(null);

  if (url.isPending) {
    return (
      <div aria-busy="true" aria-label="Загрузка фото">
        <Skeleton height={200} />
      </div>
    );
  }
  if (url.isError || !url.data || broken === url.data) {
    return (
      <p className="m-small vote-photo-missing">
        <Icon name="alert-circle" size={16} />
        <span>Фото не загрузилось — возможно, его удалили.</span>
      </p>
    );
  }
  return (
    <img
      className="vote-photo"
      src={url.data}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(url.data)}
    />
  );
}
