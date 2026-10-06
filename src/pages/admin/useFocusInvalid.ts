import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Фокус на первое поле с ошибкой после неудачной отправки формы. Через эффект, а не
 * requestAnimationFrame: эффект срабатывает после того, как ошибки отрисованы, и в фоновой
 * вкладке, где кадры не идут, тоже.
 */
export function useFocusInvalid(formRef: RefObject<HTMLFormElement | null>): () => void {
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (request === 0) return;
    const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center' });
  }, [request, formRef]);

  return useCallback(() => setRequest((n) => n + 1), []);
}
