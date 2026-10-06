import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { haptic } from '../telegram';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * Сегментированный переключатель. При нехватке ширины (5 вкладок рейтинга на 320px)
 * прокручивается по горизонтали, а не сжимает подписи.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  ...rest
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const select = (next: T) => {
    if (next === value) return;
    haptic.selection();
    onChange(next);
  };

  // Стрелки влево/вправо — по паттерну WAI-ARIA tabs.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = items.findIndex((item) => item.value === value);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = items[(index + delta + items.length) % items.length];
    if (!next) return;
    event.preventDefault();
    select(next.value);
    const button = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-value="${CSS.escape(next.value)}"]`,
    );
    button?.focus();
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      className={cn('ui-tabs', className)}
      onKeyDown={onKeyDown}
      {...rest}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            data-value={item.value}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="ui-tabs__tab"
            onClick={() => select(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
