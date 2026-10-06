import type { ReactNode } from 'react';
import { errorMessage } from '../api/errors';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { AlertIcon, ChipIcon } from './icons';

export interface EmptyProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Пустое состояние: «Вечеров пока не было» + что сделать дальше. */
export function Empty({ icon, title, description, action, className }: EmptyProps) {
  return (
    <div className={cn('ui-empty', className)}>
      <span className="ui-empty__icon">{icon ?? <ChipIcon size={40} />}</span>
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

export interface ErrorViewProps {
  error: unknown;
  title?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

/** Ошибка загрузки данных с кнопкой «Повторить» — для isError у запросов. */
export function ErrorView({
  error,
  title = 'Не удалось загрузить',
  onRetry,
  className,
}: ErrorViewProps) {
  return (
    <div className={cn('ui-empty', 'ui-empty--error', className)} role="alert">
      <span className="ui-empty__icon">
        <AlertIcon size={40} />
      </span>
      <p className="ui-empty__title">{title}</p>
      <p className="ui-empty__description">{errorMessage(error)}</p>
      {onRetry && (
        <div className="ui-empty__action">
          <Button variant="secondary" onClick={onRetry}>
            Повторить
          </Button>
        </div>
      )}
    </div>
  );
}
