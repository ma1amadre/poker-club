// Админка клуба (/admin): вкладки «Клуб», «Форматы», «Игроки», «Вечера». Вкладка и открытый
// формат живут в адресе (?tab=…, ?format=<id>|new): «Назад» с экрана вечера возвращает на ту же
// вкладку, а редактор формата закрывается кнопкой «Назад» Telegram. Без ?tab (и с неизвестной
// вкладкой) открываются «Вечера» — с ними админ работает каждую неделю.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page, Tabs } from '../../shared/ui';
import './admin.css';
import { ClubTab } from './ClubTab';
import { EveningsTab } from './EveningsTab';
import { FormatEditor } from './FormatEditor';
import { FormatsTab } from './FormatsTab';
import { adminTab, type AdminTabId as TabId } from './lib';
import { AdminGuard } from './parts';
import { PlayersTab } from './PlayersTab';
import type { SettingsDraft } from './settingsDraft';

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminScreen />
    </AdminGuard>
  );
}

function AdminScreen() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = adminTab(tabParam);
  const formatParam = params.get('format');
  // Черновик настроек — здесь, а не во вкладке: Tabs монтирует только открытую панель.
  const [clubDraft, setClubDraft] = useState<SettingsDraft | null>(null);

  if (formatParam) return <FormatEditor formatId={formatParam === 'new' ? null : formatParam} />;

  return (
    <Page title="Управление клубом" className="adm-page">
      <Tabs<TabId>
        label="Разделы управления"
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        tabs={[
          {
            id: 'club',
            label: 'Клуб',
            content: <ClubTab draft={clubDraft} onDraftChange={setClubDraft} />,
          },
          {
            id: 'formats',
            label: 'Форматы',
            content: (
              <FormatsTab onOpen={(id) => setParams({ tab: 'formats', format: id ?? 'new' })} />
            ),
          },
          { id: 'players', label: 'Игроки', content: <PlayersTab /> },
          { id: 'evenings', label: 'Вечера', content: <EveningsTab /> },
        ]}
      />
    </Page>
  );
}
