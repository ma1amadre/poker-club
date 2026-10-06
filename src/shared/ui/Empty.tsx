import type { ReactNode } from 'react';
import { errorMessage } from '../api/errors';
import { Button } from './Button';
import { EmptyState, type MateriaIconName } from './materia';

export interface EmptyProps {
  /**
   * zero — ещё ничего нет (заголовок-приглашение и действие, которое создаёт первый элемент),
   * no-results — фильтр ничего не нашёл, error — не удалось загрузить (лучше ErrorView).
   */
  kind?: 'zero' | 'no-results' | 'error';
  /** Иконка из набора «Материи» вместо стандартной для kind. */
  icon?: MateriaIconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
}

/**
 * Пустое состояние — EmptyState «Материи»: объясняет себя и предлагает следующий шаг
 * («Вечеров ещё не было» → «Назначить вечер»). Без «Здесь пока пусто».
 */
export function Empty({ kind = 'zero', description, ...rest }: EmptyProps) {
  return <EmptyState kind={kind} text={description} {...rest} />;
}

export interface ErrorViewProps {
  error: unknown;
  title?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

/** Ошибка загрузки данных (isError у запроса): что случилось и «Повторить загрузку». */
export function ErrorView({
  error,
  title = 'Не удалось загрузить данные',
  onRetry,
  className,
}: ErrorViewProps) {
  return (
    <EmptyState
      kind="error"
      title={title}
      text={errorMessage(error)}
      className={className}
      action={
        onRetry ? (
          <Button icon="refresh-cw" onClick={onRetry}>
            Повторить загрузку
          </Button>
        ) : undefined
      }
    />
  );
}
