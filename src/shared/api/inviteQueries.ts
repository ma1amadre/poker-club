// Ссылки-приглашения (миграция 029): опции запроса списка и мутации «создать» — без клиента Supabase,
// их гоняет inviteQueries.test.ts; хуки с RPC — invites.ts.
import {
  queryOptions,
  skipToken,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query';
import { queryKeys } from './keys';

/** Только что созданное приглашение: код — единственный раз, когда он виден. */
export interface CreatedInvite {
  id: string;
  code: string;
  expiresAt: string;
}

/**
 * Список перечитываем раз в минуту, пока раздел на экране (в свёрнутом Mini App — нет): иначе
 * вошедший по ссылке висел бы в «Действуют» с «Отозвать», пока админ не уйдёт и не вернётся. Само
 * «истекло» клиент досчитывает без запроса (inviteStatusAt в pages/admin/invites.ts).
 */
export const INVITES_REFETCH_MS = 60_000;

export function playerInvitesQuery<T>(queryFn: () => Promise<T>, enabled = true) {
  return queryOptions({
    queryKey: queryKeys.playerInvites,
    queryFn,
    enabled,
    staleTime: INVITES_REFETCH_MS,
    refetchInterval: INVITES_REFETCH_MS,
    refetchIntervalInBackground: false,
  });
}

/**
 * Созданная ссылка живёт в кеше запросов, а не в состоянии раздела «Приглашения»: Tabs монтирует
 * только открытую вкладку, и колбэк mutate(…, {onSuccess}) TanStack Query зовёт, лишь пока у
 * observer есть подписчики, — админ ушёл с «Клуба» или нажал «Назад» до ответа сервера, и код,
 * который виден один раз, пропал бы. onSuccess самой мутации срабатывает всегда; шторка откроется,
 * когда раздел снова на экране. gcTime: Infinity — сборщик кеша не уносит ссылку, пока её не закрыли.
 */
export function createdInviteQuery() {
  return queryOptions<CreatedInvite | null>({
    queryKey: queryKeys.createdPlayerInvite,
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function rememberCreatedInvite(client: QueryClient, created: CreatedInvite): void {
  // Умолчания ключа — до записи: setQueryData создаёт запрос с ними, ещё без observer.
  client.setQueryDefaults(queryKeys.createdPlayerInvite, { staleTime: Infinity, gcTime: Infinity });
  client.setQueryData<CreatedInvite | null>(queryKeys.createdPlayerInvite, created);
}

/** Шторку закрыли — ссылку больше не показываем (null, а не removeQueries: observer узнает сразу). */
export function forgetCreatedInvite(client: QueryClient): void {
  client.setQueryData<CreatedInvite | null>(queryKeys.createdPlayerInvite, null);
}

export function readCreatedInvite(client: QueryClient): CreatedInvite | null {
  return client.getQueryData<CreatedInvite | null>(queryKeys.createdPlayerInvite) ?? null;
}

/**
 * «Пригласить игрока»: ссылку запоминаем и список перечитываем на уровне мутации — сработает и после
 * ухода с вкладки. Ошибку показывает общий тост мутаций (app/queryClient.ts) — тоже всегда.
 */
export function createInviteMutation(
  client: QueryClient,
  mutationFn: () => Promise<CreatedInvite>,
): MutationOptions<CreatedInvite, Error, void> {
  return {
    mutationFn,
    onSuccess: (created) => {
      rememberCreatedInvite(client, created);
      void client.invalidateQueries({ queryKey: queryKeys.playerInvites });
    },
  };
}
