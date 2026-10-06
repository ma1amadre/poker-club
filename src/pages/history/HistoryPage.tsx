// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function HistoryPage() {
  return (
    <Page title="История">
      <Empty title="Экран в разработке" description="Прошедшие вечера клуба." />
    </Page>
  );
}
