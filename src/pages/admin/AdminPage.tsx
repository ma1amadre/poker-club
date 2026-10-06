// Админка клуба (/admin): вкладки «Клуб», «Форматы», «Игроки», «Вечера». Вкладка и открытый
// формат живут в адресе (?tab=…, ?format=<id>|new): «Назад» с экрана вечера возвращает на ту же
// вкладку, а редактор формата закрывается кнопкой «Назад» Telegram.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page, Tabs } from '../../shared/ui';
import './admin.css';
import { ClubTab } from './ClubTab';
import { EveningsTab } from './EveningsTab';
import { FormatEditor } from './FormatEditor';
import { FormatsTab } from './FormatsTab';
import { AdminGuard } from './parts';
import { PlayersTab } from './PlayersTab';
import type { SettingsDraft } from './settingsDraft';

type TabId = 'club' | 'formats' | 'players' | 'evenings';
const TAB_IDS: readonly TabId[] = ['club', 'formats', 'players', 'evenings'];
const isTab = (value: string | null): value is TabId => TAB_IDS.includes(value as TabId);

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
  const tab: TabId = isTab(tabParam) ? tabParam : 'club';
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
