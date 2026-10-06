import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackButton } from '../telegram';
import { IconButton } from './Button';
import { CloseIcon } from './icons';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  /** Запретить закрытие тапом по фону (идёт сохранение). */
  dismissible?: boolean;
}

// Сколько шторок открыто: прокрутку страницы под ними возвращаем, только когда закрыта последняя.
let openSheets = 0;

/**
 * Нижняя шторка. Закрывается кнопкой «Назад» Telegram (поверх кнопки экрана — у useBackButton
 * стек), тапом по фону, Escape и крестиком.
 */
export function Sheet({ open, onClose, title, children, dismissible = true }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useBackButton({ enabled: open, onBack: () => dismissible && onClose() });

  // Через useEffectEvent: родители передают onClose стрелкой, и эффект с ней в зависимостях
  // перезапускался бы каждый рендер — фокус прыгал бы из полей ввода на панель.
  const onEscape = useEffectEvent(() => {
    if (dismissible) onClose();
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    openSheets += 1;
    document.body.style.overflow = 'hidden';

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openSheets -= 1;
      if (openSheets === 0) document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="ui-sheet-root">
      <div
        className="ui-sheet__backdrop"
        onClick={() => dismissible && onClose()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="ui-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="ui-sheet__handle" aria-hidden="true" />
        <div className="ui-sheet__header">
          <h2 id={titleId} className="ui-sheet__title">
            {title}
          </h2>
          {dismissible && (
            <IconButton label="Закрыть" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          )}
        </div>
        <div className="ui-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
