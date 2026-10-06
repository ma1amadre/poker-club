// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function SettlePage() {
  return (
    <Page title="Расчёт" back>
      <Empty title="Экран в разработке" description="Кто кому сколько должен через банкира." />
    </Page>
  );
}
