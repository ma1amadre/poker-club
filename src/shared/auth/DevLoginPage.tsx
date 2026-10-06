// ТОЛЬКО ДЛЯ РАЗРАБОТКИ: вход тестовым игроком вне Telegram. Грузится лениво из ветки
// под import.meta.env.DEV (src/app/AuthGate.tsx) — в прод-сборку не попадает.
import { useState } from 'react';
import { env } from '../supabase';
import { Avatar, Badge, List, ListItem, Notice, Page, Section, Spinner } from '../ui';
import { errorMessage } from '../api/errors';
import { useAuth } from './context';
import { buildDevInitData, DEV_PLAYERS } from './devInitData';

export default function DevLoginPage() {
  const { signInWithInitData } = useAuth();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = env.devBotToken;

  const signIn = async (index: number) => {
    const user = DEV_PLAYERS[index];
    if (!user || !token) return;
    setPendingId(user.id);
    setError(null);
    try {
      // start_param из адреса (?tgWebAppStartParam=e_<id>) — чтобы проверять диплинки и в браузере.
      const startParam =
        new URLSearchParams(window.location.search).get('tgWebAppStartParam') ?? undefined;
      const initData = await buildDevInitData({ user, botToken: token, startParam });
      await signInWithInitData(initData);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Page
      eyebrow="Только для разработки"
      title="Вход тестовым игроком"
      subtitle="Вне Telegram initData подписывается тестовым токеном бота."
    >
      {error && (
        <Notice tone="critical" title="Вход не прошёл">
          {error}
        </Notice>
      )}
      {!token ? (
        <Notice tone="caution" title="Не задан VITE_DEV_BOT_TOKEN">
          Скопируйте .env.example в .env.development.local и укажите тот же фейковый токен, что и
          TELEGRAM_BOT_TOKEN в supabase/functions/.env. Затем перезапустите dev-сервер.
        </Notice>
      ) : (
        <Section
          title="Тестовые игроки"
          footer="Игроки из supabase/seed.sql. Локальный стек и функция tg-auth должны быть запущены."
        >
          <List aria-label="Тестовые игроки">
            {DEV_PLAYERS.map((user, index) => (
              <ListItem
                key={user.id}
                before={<Avatar name={user.first_name} />}
                title={user.first_name}
                subtitle={
                  <span className="m-mono">
                    tg_id {user.id}
                    {user.username ? ` · @${user.username}` : ''}
                  </span>
                }
                after={
                  pendingId === user.id ? (
                    <Spinner label={`Входим как ${user.first_name}`} />
                  ) : user.note ? (
                    <Badge tone="accent">{user.note}</Badge>
                  ) : undefined
                }
                disabled={pendingId !== null}
                onClick={() => void signIn(index)}
              />
            ))}
          </List>
        </Section>
      )}
    </Page>
  );
}
