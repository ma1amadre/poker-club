import {
  environmentManager,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createdInviteQuery,
  createInviteMutation,
  forgetCreatedInvite,
  INVITES_REFETCH_MS,
  playerInvitesQuery,
  readCreatedInvite,
  type CreatedInvite,
} from './inviteQueries';
import { queryKeys } from './keys';

const CREATED: CreatedInvite = {
  id: 'inv-1',
  code: 'AbCdEfGhIjKlMnOpQrStUvWxYz01-_9Z',
  expiresAt: '2026-11-01T19:10:00Z',
};

// Под Node query-core считает себя сервером и не ставит таймеры (staleTime, refetchInterval, сборка
// кеша по умолчанию) — ведём себя как WebView.
const wasServer = environmentManager.isServer();
beforeAll(() => environmentManager.setIsServer(() => false));
afterAll(() => environmentManager.setIsServer(() => wasServer));
afterEach(() => vi.useRealTimers());

/** Запрос, который отвечает, когда скажут: раздел успевает размонтироваться. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Как useMutation в размонтированном разделе: observer был подписан и отписался до ответа. */
function unmountedObserver(client: QueryClient, fn: () => Promise<CreatedInvite>) {
  const observer = new MutationObserver(client, createInviteMutation(client, fn));
  observer.subscribe(() => {})();
  return observer;
}

describe('«Пригласить игрока» — ссылка не теряется при уходе с вкладки', () => {
  it('колбэк вызова mutate без подписчиков не срабатывает — поэтому ссылку пишет сама мутация', async () => {
    const client = new QueryClient();
    const reply = deferred<CreatedInvite>();
    const observer = unmountedObserver(client, () => reply.promise);
    const onCall = vi.fn();
    const done = observer.mutate(undefined, { onSuccess: onCall });
    reply.resolve(CREATED);
    await done;
    expect(onCall).not.toHaveBeenCalled(); // так было: шторка не открывалась, код пропадал
    expect(readCreatedInvite(client)).toEqual(CREATED);
  });

  it('вернулись на вкладку — шторка видит ссылку; закрыли — ссылка забыта', async () => {
    const client = new QueryClient();
    await unmountedObserver(client, async () => CREATED).mutate();
    const section = new QueryObserver(client, createdInviteQuery());
    const seen = vi.fn();
    const unsubscribe = section.subscribe(seen);
    expect(section.getCurrentResult().data).toEqual(CREATED);
    forgetCreatedInvite(client);
    // Подписчиков query-core оповещает пачкой на следующем тике.
    await vi.waitFor(() =>
      expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ data: null })),
    );
    expect(readCreatedInvite(client)).toBeNull();
    unsubscribe();
  });

  it('сборщик кеша не уносит ссылку, пока админ в другом разделе', async () => {
    vi.useFakeTimers();
    // Как в приложении: запрос без observer живёт gcTime (по умолчанию 5 минут), потом удаляется.
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 1_000 } } });
    await unmountedObserver(client, async () => CREATED).mutate();
    client.setQueryData(['other'], 1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(client.getQueryData(['other'])).toBeUndefined();
    expect(readCreatedInvite(client)).toEqual(CREATED);
  });

  it('после создания список приглашений перечитывается', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await unmountedObserver(client, async () => CREATED).mutate();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.playerInvites });
  });

  it('ошибка — ссылки нет', async () => {
    const client = new QueryClient();
    await expect(
      unmountedObserver(client, () => Promise.reject(new Error('нет прав'))).mutate(),
    ).rejects.toThrow('нет прав');
    expect(readCreatedInvite(client)).toBeNull();
  });
});

describe('список приглашений на экране перечитывается сам', () => {
  it('раз в минуту, пока раздел открыт: вошедший по ссылке уходит из «Действуют»', async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const fetch = vi.fn(async () => []);
    const section = new QueryObserver(client, playerInvitesQuery(fetch));
    const unsubscribe = section.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Одного staleTime мало: он только помечает данные устаревшими, запрос не идёт.
    await vi.advanceTimersByTimeAsync(INVITES_REFETCH_MS + 10);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INVITES_REFETCH_MS);
    expect(fetch).toHaveBeenCalledTimes(3);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(5 * INVITES_REFETCH_MS);
    expect(fetch).toHaveBeenCalledTimes(3); // раздел закрыт — не ходим
  });

  it('в свёрнутом Mini App — не ходим', () => {
    expect(playerInvitesQuery(async () => []).refetchIntervalInBackground).toBe(false);
  });
});
