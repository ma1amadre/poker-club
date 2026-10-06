import { useEffect, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { isInTelegram, useBackButton, type UseBackButtonOptions } from '../telegram';
import { IconButton } from './Button';
import { BackIcon } from './icons';

export interface PageProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /**
   * Вложенный экран: показывает кнопку «Назад» Telegram (вне Telegram — свою в шапке).
   * Объект — параметры useBackButton (fallback, onBack).
   */
  back?: boolean | UseBackButtonOptions;
  /** Кнопки справа в шапке. */
  actions?: ReactNode;
  /** Заголовок вкладки браузера; по умолчанию — title, если это строка. */
  documentTitle?: string;
  /** Без боковых отступов (табло, полноширинные таблицы). */
  bleed?: boolean;
  className?: string;
  children?: ReactNode;
}

const APP_TITLE = 'Покерный клуб';

/** Экран: шапка с заголовком, отступы под safe-area, ширина 320–480. */
export function Page({
  title,
  subtitle,
  back,
  actions,
  documentTitle,
  bleed,
  className,
  children,
}: PageProps) {
  const backOptions = typeof back === 'object' ? back : {};
  // Хук вызывается всегда (правила хуков), а кнопку включает только back.
  const goBack = useBackButton({
    ...backOptions,
    enabled: Boolean(back) && backOptions.enabled !== false,
  });
  const showOwnBack = Boolean(back) && !isInTelegram();

  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    document.title = tabTitle ? `${tabTitle} · ${APP_TITLE}` : APP_TITLE;
  }, [tabTitle]);

  const hasHeader = Boolean(title || subtitle || actions || showOwnBack);

  return (
    <main className={cn('ui-page', bleed && 'ui-page--bleed', className)}>
      {hasHeader && (
        <header className="ui-page__header">
          {showOwnBack && (
            <IconButton label="Назад" className="ui-page__back" onClick={goBack}>
              <BackIcon />
            </IconButton>
          )}
          <div className="ui-page__titles">
            {title && <h1 className="ui-page__title">{title}</h1>}
            {subtitle && <div className="ui-page__subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="ui-page__actions">{actions}</div>}
        </header>
      )}
      {children}
    </main>
  );
}
