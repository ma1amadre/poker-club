import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Confirm, type ConfirmOptions } from './Confirm';

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Подтверждение в императивном стиле:
 *   const { confirm, confirmElement } = useConfirm();
 *   if (await confirm({ title: 'Отменить событие?', danger: true })) voidEvent.mutate(id);
 *   ...; return <>{confirmElement}...</>;
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmElement: ReactElement;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    // Новый запрос при открытом старом — старый считаем отменённым, чтобы промис не повис.
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const confirmElement = (
    <Confirm
      open={pending !== null}
      title={pending?.title ?? ''}
      message={pending?.message}
      confirmText={pending?.confirmText}
      cancelText={pending?.cancelText}
      danger={pending?.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmElement };
}
