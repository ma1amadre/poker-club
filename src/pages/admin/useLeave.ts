import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useConfirm } from '../../shared/ui';

/**
 * Уйти с экрана редактора: назад по истории, а если экран открыт первым (прямая ссылка, истории
 * нет) — на fallback. При несохранённых правках сначала спросить. Правило то же, что у
 * useBackButton, но с подтверждением: кнопку «Назад» Telegram и свою в шапке ведёт Page.
 */
export function useLeave(fallback: string, dirty: boolean, what: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const { confirm, confirmElement } = useConfirm();

  const leaveNow = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate(fallback, { replace: true });
  }, [location.key, navigate, fallback]);

  /** true — можно уходить: правок нет или человек согласился их потерять. */
  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: 'Выйти без сохранения?',
      message: `Правки ${what} пропадут.`,
      confirmText: 'Выйти без сохранения',
      cancelText: 'Остаться',
      danger: true,
    });
  }, [confirm, dirty, what]);

  const leave = useCallback(async () => {
    if (await confirmDiscard()) leaveNow();
  }, [confirmDiscard, leaveNow]);

  // Закрытие вкладки или перезагрузка с правками — браузер спросит сам (вне Telegram).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return { leave, leaveNow, confirmDiscard, confirmElement };
}
