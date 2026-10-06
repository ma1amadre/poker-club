// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function HomePage() {
  return (
    <Page title="Главная">
      <Empty
        title="Экран в разработке"
        description="Ближайший вечер, RSVP, прогнозы, текущий вечер."
      />
    </Page>
  );
}
