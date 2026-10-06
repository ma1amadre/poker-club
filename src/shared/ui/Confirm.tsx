import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackButton } from '../telegram';
import { Button } from './Button';
import { Dialog } from './materia';

export interface ConfirmOptions {
  /** Вопрос с объектом: «Отменить вылет Саши?». Не «Ты уверен?». */
  title: ReactNode;
  /** Последствия: что пропадёт и можно ли вернуть. */
  message?: ReactNode;
  /** Тот же глагол, что в заголовке: «Отменить вылет». Не «ОК». */
  confirmText?: string;
  cancelText?: string;
  /** Необратимое действие: alertdialog и кнопка danger. */
  danger?: boolean;
}

export interface ConfirmProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Подтверждение уже выполняется — кнопки заблокированы, окно не закрыть. */
  loading?: boolean;
}

/**
 * Подтверждение — Dialog «Материи» (ловушка фокуса, Esc, возврат фокуса) + кнопка «Назад»
 * Telegram закрывает окно. Обратимое действие не подтверждают: выполняют и дают тост «Отменить».
 */
export function Confirm({
  open,
  title,
  message,
  confirmText = 'Подтвердить',
  cancelText = 'Отмена',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  useBackButton({ enabled: open, onBack: () => !loading && onCancel() });
  if (!open) return null;
  // Портал: position: fixed слоя Dialog не должен зависеть от трансформаций предков.
  return createPortal(
    <Dialog
      open
      size="sm"
      alert={danger}
      title={title}
      description={message}
      dismissible={!loading}
      onClose={loading ? undefined : onCancel}
      className="ui-confirm"
      actions={[
        <Button key="cancel" variant="ghost" disabled={loading} onClick={onCancel}>
          {cancelText}
        </Button>,
        <Button
          key="confirm"
          variant={danger ? 'danger' : 'primary'}
          loading={loading}
          onClick={onConfirm}
        >
          {confirmText}
        </Button>,
      ]}
    />,
    document.body,
  );
}
