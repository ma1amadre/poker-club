// ЗАГЛУШКА каркаса: страницу пишет агент страниц. Маршрут и lazy-импорт — в src/app/routes.tsx.
import { Empty, Page } from '../../shared/ui';

export default function VotePage() {
  return (
    <Page title="Голосование" back>
      <Empty title="Экран в разработке" description="Рука, блеф и бэд-бит вечера." />
    </Page>
  );
}
