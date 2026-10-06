import { MutationCache, QueryClient } from '@tanstack/react-query';

// Ошибки мутаций показываются одним тостом на всё приложение (GlobalMutationErrors в App):
// страницам не нужно дублировать onError, а пользователь не останется без объяснения.
type ErrorHandler = (error: unknown) => void;
let mutationErrorHandler: ErrorHandler | null = null;

export function setMutationErrorHandler(handler: ErrorHandler | null): void {
  mutationErrorHandler = handler;
}

function isPermanent(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = cause?.code;
  // Нет прав / нет такой функции или таблицы / неверный ввод — повтор не поможет.
  return (
    code === '42501' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    code === '22023' ||
    code === '22P02'
  );
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    // meta.silent — у мутации свой тост ошибки с контекстом («Голос не сохранён»): без этого
    // пользователь получал два тоста и двойную вибрацию.
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      mutationErrorHandler?.(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Мобильная сеть в квартире с игрой бывает нестабильной: пара повторов, но не для ошибок прав.
      retry: (failureCount, error) => failureCount < 2 && !isPermanent(error),
      // В Telegram «фокус» — возврат в Mini App из чата: данные к этому моменту могли устареть.
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Запись не повторяем сами: повтор add_event мог бы задвоить событие в журнале.
      retry: false,
      // По умолчанию ('online') без сети мутация молча встаёт на паузу: спиннер без конца, шторку не
      // закрыть, пульт серый, а тоста «Нет связи» нет. 'always' — сразу ошибка и понятный тост;
      // повтор банкир делает сам (add_event идемпотентен по ключу повтора).
      networkMode: 'always',
    },
  },
});
