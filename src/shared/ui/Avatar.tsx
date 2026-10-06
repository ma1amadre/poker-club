import { useState } from 'react';
import { cn } from '../lib/cn';

export interface AvatarProps {
  name: string;
  photoUrl?: string | null;
  /** Диаметр, px. */
  size?: number;
  className?: string;
}

// Палитра аватаров без фото — как у Telegram: цвет стабилен для имени, белые инициалы читаются
// на всех вариантах и в светлой, и в тёмной теме.
const COLORS = ['#e17076', '#eda86c', '#a695e7', '#7bc862', '#6ec9cb', '#65aadd', '#ee7aae'];

function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? '#65aadd';
}

/** «Саша Петров» → «СП», «Миша» → «М». */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** Аватар игрока: фото из Telegram, а если его нет или оно не загрузилось — инициалы. */
export function Avatar({ name, photoUrl, size = 40, className }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;

  return (
    <span
      className={cn('ui-avatar', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: showPhoto ? 'var(--color-fill)' : colorFor(name),
      }}
      aria-hidden="true"
    >
      {showPhoto ? (
        <img
          src={photoUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          // Без Referer: t.me/i/userpic отдаёт картинку и так, а адрес приложения не утекает.
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(photoUrl ?? null)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
