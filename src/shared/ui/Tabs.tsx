import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { haptic } from '../telegram';
import { MateriaSegmented, MateriaTabs } from './materia';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /** Счётчик рядом с подписью. */
  count?: ReactNode;
  /** Содержимое панели; рендерится только у выбранной вкладки. */
  content: ReactNode;
}

export interface TabsProps<T extends string = string> {
  tabs: readonly TabItem<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (id: T) => void;
  /** Подпись списка вкладок для скринридера. */
  label?: string;
  className?: string;
}

/**
 * Tabs «Материи» (WAI-ARIA: стрелки, Home, End): разные виды одного объекта — сезон / деньги /
 * всё время в рейтинге. 2–6 вкладок, при нехватке ширины список прокручивается. Вкладки не ведут
 * на другие экраны. Режим одного вида (период, сортировка) — Segmented.
 */
export function Tabs<T extends string>({ tabs, onChange, ...rest }: TabsProps<T>) {
  // Выбранная вкладка (например, «Зал славы» из ссылки) может оказаться за краем прокручиваемого
  // списка — докручиваем список до неё. Только по горизонтали: страницу не дёргаем.
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = rest.value;
  useEffect(() => {
    const list = boxRef.current?.querySelector<HTMLElement>('[role=tablist]');
    const tab = list?.querySelector<HTMLElement>('[role=tab][aria-selected=true]');
    if (!list || !tab) return;
    const listRect = list.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    if (tabRect.right > listRect.right) list.scrollLeft += tabRect.right - listRect.right;
    else if (tabRect.left < listRect.left) list.scrollLeft -= listRect.left - tabRect.left;
  }, [selected]);

  return (
    <div ref={boxRef} className="ui-tabs">
      <MateriaTabs
        {...rest}
        tabs={[...tabs]}
        onChange={(id) => {
          haptic.selection();
          onChange?.(id as T);
        }}
      />
    </div>
  );
}

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string = string> {
  options: readonly SegmentedOption<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  /** Подпись группы для скринридера. */
  label?: string;
  /** Растянуть на всю ширину, варианты поровну (телефон). */
  block?: boolean;
  className?: string;
}

/** Segmented «Материи»: 2–5 коротких взаимоисключающих вариантов, применяется сразу. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  block,
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <MateriaSegmented
      {...rest}
      value={value}
      options={[...options]}
      className={cn(block && 'ui-seg--block', className)}
      onChange={(next) => {
        if (next === value) return;
        haptic.selection();
        onChange?.(next as T);
      }}
    />
  );
}
