import { useEffect, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { isInTelegram, useBackButton, type UseBackButtonOptions } from '../telegram';
import { IconButton } from './Button';

export interface PageProps {
  /** Заголовок экрана — h1 с ролью m-h1. */
  title?: ReactNode;
  /** Строка под заголовком (m-small): дата вечера, место. */
  subtitle?: ReactNode;
  /** Надзаголовок над заголовком (m-eyebrow): «Вечер · 8 октября». */
  eyebrow?: ReactNode;
  /**
   * Вложенный экран: показывает кнопку «Назад» Telegram (вне Telegram — свою в шапке).
   * Объект — параметры useBackButton (fallback, onBack).
   */
  back?: boolean | UseBackButtonOptions;
  /** Кнопки справа в шапке (IconButton). */
  actions?: ReactNode;
  /** Заголовок вкладки браузера; по умолчанию — title, если это строка. */
  documentTitle?: string;
  /** Без боковых отступов (полноширинные таблицы). */
  bleed?: boolean;
  className?: string;
  children?: ReactNode;
}

const APP_TITLE = 'Покерный клуб';

/**
 * Экран: шапка (m-eyebrow, m-h1, m-small), содержимое столбцом с шагом space-6 между группами,
 * поля space-4 плюс safe-area Telegram, ширина до 560 px.
 */
export function Page({
  title,
  subtitle,
  eyebrow,
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

  const hasHeader = Boolean(title || subtitle || eyebrow || actions || showOwnBack);

  return (
    <main className={cn('ui-page', bleed && 'ui-page--bleed', className)}>
      {hasHeader && (
        <header className="ui-page__head">
          {showOwnBack && (
            <IconButton
              label="Назад"
              icon="arrow-left"
              className="ui-page__back"
              onClick={goBack}
            />
          )}
          <div className="ui-page__titles">
            {eyebrow && <p className="m-eyebrow">{eyebrow}</p>}
            {title && <h1 className="m-h1 ui-page__title">{title}</h1>}
            {subtitle && <div className="m-small">{subtitle}</div>}
          </div>
          {actions && <div className="ui-page__actions">{actions}</div>}
        </header>
      )}
      {children}
    </main>
  );
}
