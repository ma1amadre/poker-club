import { useState, type CSSProperties } from 'react';
import { cn } from '../lib/cn';

// Аватар — анатомия Avatar «Материи» (m-avatar, m-avatar--{size}); в «Терминале» — плашка с рамкой
// и моноширинными инициалами без заливки (styles/terminal.css). Свой JSX вместо <Avatar> из бандла ради фото из Telegram: без Referer
// (адрес приложения не утекает на t.me) и с откатом на инициалы, если фото не загрузилось.

/** sm 24, md 32, lg 40, xl 56 px — или число в пикселях. */
export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: AvatarSize | number;
  /**
   * По умолчанию аватар декоративный (aria-hidden): по правилам «Материи» рядом всегда стоит имя
   * текстом. false — аватар без подписи рядом, тогда имя читает скринридер.
   */
  decorative?: boolean;
  className?: string;
}

/** «Саша Петров» → «СП», «Миша» → «М», «Вова (гость)» → «В»: слова не с буквы или цифры пропускаем. */
function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  return (
    words
      .slice(0, 2)
      .map((word) => Array.from(word)[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

function sizeProps(size: AvatarSize | number): { className?: string; style?: CSSProperties } {
  if (typeof size === 'number') return { style: { '--_s': `${size}px` } as CSSProperties };
  return { className: `m-avatar--${size}` };
}

/** Аватар игрока: фото из Telegram, а если его нет или оно не загрузилось — инициалы. */
export function Avatar({ name, photoUrl, size = 'lg', decorative = true, className }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showPhoto = Boolean(photoUrl) && failedUrl !== photoUrl;
  const sized = sizeProps(size);

  return (
    <span
      className={cn('m-avatar', sized.className, className)}
      style={sized.style}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      {showPhoto ? (
        <img
          className="m-avatar-img"
          src={photoUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(photoUrl ?? null)}
        />
      ) : (
        <span className="m-avatar-initials">{initials(name)}</span>
      )}
    </span>
  );
}

export interface AvatarGroupProps {
  people: readonly { name: string; photoUrl?: string | null }[];
  /** Сколько аватаров показать до «+N». По умолчанию 4. */
  max?: number;
  size?: AvatarSize;
  /** Подпись группы для скринридера; по умолчанию «Участники: N». */
  label?: string;
  className?: string;
}

/** Стопка аватаров с «+N» (AvatarGroup «Материи»): кто идёт на вечер, кто в игре. */
export function AvatarGroup({ people, max = 4, size = 'md', label, className }: AvatarGroupProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span
      className={cn('m-avatars', className)}
      role="group"
      aria-label={label ?? `Участники: ${people.length}`}
    >
      {shown.map((person, index) => (
        <Avatar key={index} name={person.name} photoUrl={person.photoUrl} size={size} />
      ))}
      {rest > 0 && (
        <span className={cn('m-avatar', `m-avatar--${size}`, 'm-avatar--more')} aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  );
}
