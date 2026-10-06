import type { ReactNode } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Опасное действие (отмена события, удаление) — красная кнопка. */
  danger?: boolean;
}

export interface ConfirmProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Подтверждение уже выполняется — кнопки заблокированы, шторку не закрыть. */
  loading?: boolean;
}

/** Подтверждение необратимого или заметного действия — шторкой, чтобы палец не промахнулся. */
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
  return (
    <Sheet open={open} onClose={onCancel} title={title} dismissible={!loading}>
      {message && <div className="ui-confirm__message">{message}</div>}
      <div className="ui-confirm__actions">
        <Button
          variant={danger ? 'danger' : 'primary'}
          size="lg"
          block
          loading={loading}
          onClick={onConfirm}
        >
          {confirmText}
        </Button>
        <Button variant="plain" block disabled={loading} onClick={onCancel}>
          {cancelText}
        </Button>
      </div>
    </Sheet>
  );
}
