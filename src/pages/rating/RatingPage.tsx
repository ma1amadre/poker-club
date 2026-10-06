// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function RatingPage() {
  return (
    <Page title="Рейтинг">
      <Empty
        title="Экран в разработке"
        description="Сезон, деньги, всё время, оракул, зал славы."
      />
    </Page>
  );
}
