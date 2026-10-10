// «Засчитать как настоящий вечер» (миграция 026): вопрос о последствиях, зачёт (promote_training_evening,
// только админ) и сразу пост итогов в группу (notify, как после «Завершить вечер»; не ушёл — добьёт
// cron-tick). Общий для экрана итога тренировки и формы вечера в админке.
import { notifyEveningFinished, usePromoteTrainingEvening } from '../../shared/api';
import { useToast } from '../../shared/ui';
import { promotedToast, promoteQuestion, type PromotePost, type Question } from './nextGame';

export function usePromoteTraining(confirm: (question: Question) => Promise<boolean>) {
  const toast = useToast();
  const promote = usePromoteTrainingEvening();

  /** guestNames — гости за столом тренировки: в вопросе — совет сначала привязать их к профилям. */
  const run = async (eveningId: string, guestNames: readonly string[]): Promise<boolean> => {
    if (!(await confirm(promoteQuestion(guestNames)))) return false;
    try {
      const { gameNo } = await promote.mutateAsync(eveningId);
      let post: PromotePost = 'failed';
      try {
        const outcome = await notifyEveningFinished(eveningId);
        if (outcome === 'posted' || outcome === 'already_posted' || outcome === 'no_group')
          post = outcome;
      } catch {
        post = 'failed';
      }
      const { success, detail } = promotedToast(gameNo, post);
      toast.show(success, { tone: post === 'failed' ? 'caution' : 'positive', detail });
      return true;
    } catch {
      // Тост ошибки — общий для всех мутаций (GlobalMutationErrors).
      return false;
    }
  };

  return { run, pending: promote.isPending };
}
