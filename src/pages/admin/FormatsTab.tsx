import { useFormats, useSettings, type FormatRow } from '../../shared/api';
import { pluralWithNumber } from '../../shared/lib';
import { Badge, Button, Empty, ErrorView, List, ListItem, Section } from '../../shared/ui';
import { formatSummary } from './formatDraft';
import { ListSkeleton } from './parts';

export interface FormatsTabProps {
  /** Открыть редактор: id формата или null — новый. */
  onOpen: (id: string | null) => void;
}

const FORMS = ['формат', 'формата', 'форматов'] as const;

/** Вкладка «Форматы»: пресеты турнира строками списка, архив отдельно, «Создать формат». */
export function FormatsTab({ onOpen }: FormatsTabProps) {
  const formats = useFormats();
  const settings = useSettings();

  if (formats.isPending) return <ListSkeleton rows={2} label="Загрузка форматов" />;
  if (formats.isError)
    return (
      <ErrorView
        error={formats.error}
        title="Не удалось загрузить форматы"
        onRetry={() => void formats.refetch()}
      />
    );

  const defaultId = settings.data?.default_format_id ?? null;
  const active = formats.data.filter((f) => !f.is_archived);
  const archived = formats.data.filter((f) => f.is_archived);

  const row = (f: FormatRow) => (
    <ListItem
      key={f.id}
      title={
        f.id === defaultId ? (
          <span className="adm-title-badge">
            {f.name}
            <Badge>По умолчанию</Badge>
          </span>
        ) : (
          f.name
        )
      }
      subtitle={formatSummary(f.config)}
      onClick={() => onOpen(f.id)}
      chevron
    />
  );

  const create = (
    <Button variant="primary" icon="plus" block onClick={() => onOpen(null)}>
      Создать формат
    </Button>
  );

  return (
    <div className="adm-tab">
      {active.length === 0 ? (
        <Empty
          icon="layers"
          title="Создайте первый формат"
          description="Пока своих форматов нет, вечера идут по встроенному клубному: 500 ₽ за вход, уровни по 40 минут."
          action={create}
        />
      ) : (
        <>
          <Section
            title="Форматы"
            aside={pluralWithNumber(active.length, FORMS)}
            footer="Правка формата не меняет уже созданные вечера: у каждого вечера своя копия формата."
          >
            <List aria-label="Форматы турнира">{active.map(row)}</List>
          </Section>
          {create}
        </>
      )}
      {archived.length > 0 && (
        <Section
          title="Архив"
          aside={pluralWithNumber(archived.length, FORMS)}
          footer="Архивный формат нельзя выбрать для нового вечера. Вернуть его можно в редакторе."
        >
          <List aria-label="Архивные форматы">{archived.map(row)}</List>
        </Section>
      )}
    </div>
  );
}
