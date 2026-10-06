// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function AdminPage() {
  return (
    <Page title="Админка">
      <Empty title="Экран в разработке" description="Настройки клуба, игроки, форматы, вечера." />
    </Page>
  );
}
