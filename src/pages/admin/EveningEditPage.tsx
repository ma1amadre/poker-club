// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function EveningEditPage() {
  return (
    <Page title="Вечер" back>
      <Empty title="Экран в разработке" description="Создание и правка вечера." />
    </Page>
  );
}
