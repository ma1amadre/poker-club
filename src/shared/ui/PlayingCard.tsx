import { cardLabel, cardName, rankLabel, suitOfCode, type SuitCode } from '../lib/poker/cards';
import { cn } from '../lib/cn';
import './showdown.css';

export type PlayingCardSize = 'sm' | 'md' | 'lg';

// Масти — рисованные значки, а не символы шрифта: у шрифтов «Материи» ♠♥♦♣ нет, системный запасной
// шрифт рисует их по-разному (а iOS — иногда эмодзи). Сплошная заливка currentColor, как очко на карте.
const SUIT_PATHS: Readonly<Record<SuitCode, readonly string[]>> = {
  // Пика — перевёрнутое сердце на ножке.
  s: [
    'M12 1.7C9.4 3.6 3 7.6 3 12.35 3 15 5.3 17 8.2 17c1.6 0 3-.65 3.8-1.75.8 1.1 2.2 1.75 3.8 1.75 2.9 0 5.2-2 5.2-4.65C21 7.6 14.6 3.6 12 1.7z',
    'M12 13 9.5 22.5h5z',
  ],
  h: [
    'M12 21.5C9.4 19.3 3 14.6 3 9c0-3.1 2.3-5.5 5.2-5.5 1.6 0 3 .8 3.8 2.1.8-1.3 2.2-2.1 3.8-2.1 2.9 0 5.2 2.4 5.2 5.5 0 5.6-6.4 10.3-9 12.5z',
  ],
  d: ['M12 1.5 20.5 12 12 22.5 3.5 12z'],
  // Трефа — три круга и ножка.
  c: [
    'M7.4 7a4.6 4.6 0 1 0 9.2 0 4.6 4.6 0 1 0-9.2 0z',
    'M2.6 13.4a4.6 4.6 0 1 0 9.2 0 4.6 4.6 0 1 0-9.2 0z',
    'M12.2 13.4a4.6 4.6 0 1 0 9.2 0 4.6 4.6 0 1 0-9.2 0z',
    'M12 10 9.5 22.5h5z',
  ],
};

/** Масть значком: цвет — от родителя (классы ui-card-suit--s/h/d/c или карта). */
export function SuitPip({ suit, className }: { suit: SuitCode; className?: string }) {
  return (
    <svg
      className={cn('ui-suit', className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {SUIT_PATHS[suit].map((d) => (
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

export interface PlayingCardProps {
  /** Карта 'As', 'Td'; null — место пустое (карту ещё не открыли). */
  code: string | null;
  size?: PlayingCardSize;
  /** Подпись пустого места для скринридера: «тёрн не открыт». */
  emptyLabel?: string;
  className?: string;
}

/**
 * Игральная карта. В «Материи» карт нет — собрана из токенов регистра. В «Терминале» (главный
 * регистр) — светлое лицо card-face с рамкой line-strong, моноширинный ранг в углу и две краски:
 * ♠♣ — card-ink, ♥♦ — suit-red (витрина /dev/brand — так же, в регистре «Покер»). Цвета —
 * showdown.css, по регистру. Цвет не единственный носитель смысла: масти различаются и формой
 * значка, он есть всегда.
 */
export function PlayingCard({ code, size = 'md', emptyLabel, className }: PlayingCardProps) {
  if (!code) {
    return (
      <span
        className={cn('ui-card', `ui-card--${size}`, 'ui-card--empty', className)}
        role="img"
        aria-label={emptyLabel ?? 'карта не открыта'}
      />
    );
  }
  const suit = suitOfCode(code);
  return (
    <span
      className={cn('ui-card', `ui-card--${size}`, `ui-card-suit--${suit}`, className)}
      role="img"
      aria-label={cardName(code)}
      title={cardLabel(code)}
    >
      <span className="ui-card__rank" aria-hidden="true">
        {rankLabel(code.charAt(0))}
      </span>
      <SuitPip suit={suit} className="ui-card__suit" />
    </span>
  );
}
