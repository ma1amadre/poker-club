import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { useBackButton } from '../telegram';
import { IconButton } from './Button';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Заголовок — что делаем: «Вылет игрока», «Ребай». */
  title?: ReactNode;
  /** Пояснение под заголовком (m-small). */
  description?: ReactNode;
  children?: ReactNode;
  /** Кнопки внизу шторки, прилипают к краю: главное действие — одна primary, отмена — ghost. */
  actions?: ReactNode;
  /** Запретить закрытие (идёт сохранение): нет крестика, фон и «Назад» не закрывают. */
  dismissible?: boolean;
  className?: string;
}

// Сколько шторок открыто: прокрутку страницы под ними возвращаем, только когда закрыта последняя.
let openSheets = 0;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Нижняя шторка для телефона — в «Материи» её нет, собрана по анатомии Dialog: scrim, слой
 * z-modal, surface, радиус и shadow-float регистра, появление за dur-calm от scale-enter снизу
 * (со стороны «триггера» — края экрана), ловушка фокуса, Esc, возврат фокуса. Закрывается кнопкой
 * «Назад» Telegram (поверх кнопки экрана — у useBackButton стек), тапом по фону и крестиком.
 * Для решения «да/нет» — Confirm (Dialog), для формы или выбора на телефоне — Sheet.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  dismissible = true,
  className,
}: SheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useBackButton({ enabled: open, onBack: () => dismissible && onClose() });

  // Через useEffectEvent: родители передают onClose стрелкой, и эффект с ней в зависимостях
  // перезапускался бы каждый рендер — фокус прыгал бы из полей ввода на панель.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const panel = panelRef.current;
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      onClose();
    }
    if (event.key === 'Tab' && panel) {
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Фокус на панель, а не на первое поле: на телефоне иначе сразу выезжает клавиатура.
    panelRef.current?.focus();
    openSheets += 1;
    document.body.style.overflow = 'hidden';
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      openSheets -= 1;
      if (openSheets === 0) document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="ui-sheet-layer">
      <div className="ui-sheet-scrim" onClick={() => dismissible && onClose()} aria-hidden="true" />
      <div
        ref={panelRef}
        className={cn('ui-sheet', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        {(title || dismissible) && (
          <div className="ui-sheet__head">
            <div className="ui-sheet__titles">
              {title && (
                <h2 id={titleId} className="m-h3">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="m-small">
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <IconButton label="Закрыть" icon="x" className="ui-sheet__close" onClick={onClose} />
            )}
          </div>
        )}
        <div className={cn('ui-sheet__body', actions != null && 'ui-sheet__body--with-actions')}>
          {children}
        </div>
        {actions != null && <div className="ui-sheet__actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}
