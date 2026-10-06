// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
// Табло публичное и рендерится ВНЕ AuthProvider: useAuth здесь недоступен, данные — только
// через useBoardState(token) (RPC board_state для anon, опрос раз в 3 с).
import { useParams } from 'react-router-dom';
import { Empty, Page } from '../../shared/ui';

export default function BoardPage() {
  const { token } = useParams<{ token: string }>();
  return (
    <Page title="Табло">
      <Empty
        title="Экран в разработке"
        description={token ? `Табло вечера по ссылке ${token.slice(0, 8)}…` : 'Нет токена табло.'}
      />
    </Page>
  );
}
