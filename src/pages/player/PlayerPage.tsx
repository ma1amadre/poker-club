// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function PlayerPage() {
  return (
    <Page title="Игрок" back>
      <Empty title="Экран в разработке" description="Карточка игрока: статистика и ачивки." />
    </Page>
  );
}
