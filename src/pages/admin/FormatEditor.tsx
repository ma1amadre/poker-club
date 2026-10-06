import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  queryKeys,
  upsertFormat,
  useFormats,
  useSettings,
  useUpsertFormat,
  type FormatInput,
  type FormatRow,
} from '../../shared/api';
import { cn, formatNumber, formatPoints, NBSP, paths, pluralWithNumber } from '../../shared/lib';
import {
  Button,
  Card,
  Empty,
  ErrorView,
  Field,
  Icon,
  IconButton,
  Menu,
  Notice,
  Page,
  PageSkeleton,
  Section,
  Select,
  Stat,
  Stats,
  useToast,
} from '../../shared/ui';
import {
  appendLevel,
  changeTrigger,
  checkDraft,
  doublePrevious,
  draftFromFormat,
  formatGameClock,
  moveLevel,
  newFormatDraft,
  payoutSum,
  poolPerEntryRub,
  previewFormat,
  removeLevel,
  sameDraft,
  TRIGGER_META,
  TRIGGER_TYPES,
  type FormatDraft,
  type FormatField,
  type FormatPreview,
  type LevelDraft,
  type LevelField,
  type LevelProblem,
  type TriggerType,
} from './formatDraft';
import { adminErrorText } from './lib';
import { useFocusInvalid } from './useFocusInvalid';
import { useLeave } from './useLeave';

const FORMATS_PATH = `${paths.admin}?tab=formats`;
const percent = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** Редактор формата турнира (поверх вкладок админки, ?format=<id> или ?format=new). */
export function FormatEditor({ formatId }: { formatId: string | null }) {
  const formats = useFormats();
  const settings = useSettings();

  if (formats.isPending) return <PageSkeleton label="Загрузка формата" />;
  if (formats.isError)
    return (
      <Page title="Формат турнира" back={{ fallback: FORMATS_PATH }}>
        <ErrorView
          error={formats.error}
          title="Не удалось загрузить формат"
          onRetry={() => void formats.refetch()}
        />
      </Page>
    );

  const row = formatId ? (formats.data.find((f) => f.id === formatId) ?? null) : null;
  if (formatId && !row)
    return (
      <Page title="Формат не найден" back={{ fallback: FORMATS_PATH }}>
        <Empty
          kind="no-results"
          title="Такого формата нет"
          description="Ссылка устарела или формат открыт в другом клубе."
        />
      </Page>
    );

  return (
    <FormatForm
      key={row?.id ?? 'new'}
      row={row}
      isDefault={row !== null && settings.data?.default_format_id === row.id}
    />
  );
}

type TopField = Exclude<FormatField, 'payouts'>;
const FIELD_KEYS: Record<TopField, keyof FormatDraft> = {
  name: 'name',
  buyIn: 'buyIn',
  chips: 'chips',
  bounty: 'bounty',
  rebuyUntil: 'rebuyUntil',
  rebuyLimit: 'rebuyLimit',
};

function FormatForm({ row, isDefault }: { row: FormatRow | null; isDefault: boolean }) {
  // Исходное состояние — для «есть правки»; после сохранения row приходит заново из запроса.
  const initial = useMemo(
    () => (row ? { ...draftFromFormat(row.config), name: row.name } : newFormatDraft()),
    [row],
  );
  const [draft, setDraft] = useState<FormatDraft>(initial);
  const [touched, setTouched] = useState<ReadonlySet<TopField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const save = useUpsertFormat();
  const queryClient = useQueryClient();
  const toast = useToast();

  const dirty = !sameDraft(draft, initial);
  const { leave, leaveNow, confirmDiscard, confirmElement } = useLeave(
    FORMATS_PATH,
    dirty,
    'формата',
  );

  // Редактор открывается поверх списка — начинаем с его начала.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const { format, problems, ok } = useMemo(() => checkDraft(draft), [draft]);
  const preview = useMemo(() => previewFormat(format), [format]);
  const pool = useMemo(() => (ok ? poolPerEntryRub(format) : null), [format, ok]);
  const sum = payoutSum(draft.payouts);

  const errorOf = (field: TopField) =>
    submitted || touched.has(field) ? problems.fields[field] : undefined;

  const bind = (field: TopField) => ({
    value: draft[FIELD_KEYS[field]] as string,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setDraft((d) => ({ ...d, [FIELD_KEYS[field]]: event.target.value })),
    onBlur: () => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field))),
    error: errorOf(field),
  });

  const setLevels = (update: (levels: LevelDraft[]) => LevelDraft[]) =>
    setDraft((d) => ({ ...d, levels: update(d.levels) }));
  const setLevel = (index: number, patch: Partial<LevelDraft>) =>
    setLevels((levels) => levels.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const setPayouts = (update: (payouts: string[]) => string[]) =>
    setDraft((d) => ({ ...d, payouts: update(d.payouts) }));

  const removeLevelAt = (index: number) => {
    const removed = draft.levels[index];
    if (!removed) return;
    setLevels((levels) => removeLevel(levels, index));
    toast.show(`Уровень ${index + 1} удалён`, {
      durationMs: 6000,
      action: {
        label: 'Вернуть',
        onClick: () =>
          setLevels((levels) => [...levels.slice(0, index), removed, ...levels.slice(index)]),
      },
    });
  };

  const focusFirstError = useFocusInvalid(formRef);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!ok) {
      setSubmitted(true);
      focusFirstError();
      return;
    }
    const input: FormatInput = {
      ...(row ? { id: row.id } : {}),
      name: format.name,
      config: format,
      is_archived: row?.is_archived ?? false,
    };
    save.mutate(input, {
      onSuccess: (saved) => {
        toast.success(row ? 'Формат сохранён' : `Формат «${saved.name}» создан`);
        leaveNow();
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  const setArchived = async (archived: boolean) => {
    if (!row || !(await confirmDiscard())) return;
    const input: FormatInput = {
      id: row.id,
      name: row.name,
      config: row.config,
      is_archived: archived,
    };
    save.mutate(input, {
      onSuccess: () => {
        if (!archived) {
          toast.success(`Формат «${row.name}» снова в списке`);
          return;
        }
        toast.show(`Формат «${row.name}» в архиве`, {
          tone: 'positive',
          durationMs: 8000,
          action: {
            label: 'Вернуть',
            // Экран редактора к этому времени закрыт — пишем напрямую, без хука мутации.
            onClick: () =>
              void upsertFormat({ ...input, is_archived: false })
                .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.formats }))
                .catch((error: unknown) => toast.error(adminErrorText(error))),
          },
        });
        leaveNow();
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  const until = format.rebuyUntilLevel;
  const levelCount = draft.levels.length;

  return (
    <Page
      className="adm-page"
      eyebrow="Формат турнира"
      title={row ? row.name : 'Новый формат'}
      back={{ onBack: () => void leave(), fallback: FORMATS_PATH }}
    >
      {confirmElement}
      {row?.is_archived && (
        <Notice
          tone="info"
          title="Формат в архиве"
          action={
            <Button size="sm" loading={save.isPending} onClick={() => void setArchived(false)}>
              Вернуть
            </Button>
          }
        >
          Его нельзя выбрать для нового вечера.
        </Notice>
      )}

      <form ref={formRef} className="adm-form" onSubmit={onSubmit} noValidate>
        <Field
          label="Название"
          autoComplete="off"
          placeholder="Турбо"
          hint="Его видно в списке форматов и в карточке вечера."
          {...bind('name')}
        />

        <Section title="Взнос и фишки">
          <div className="adm-grid-2">
            <Field
              label="Вход и ребай"
              suffix="₽"
              inputMode="numeric"
              autoComplete="off"
              {...bind('buyIn')}
            />
            <Field
              label="Фишек за вход"
              inputMode="numeric"
              autoComplete="off"
              {...bind('chips')}
            />
          </div>
          <Field
            label="Баунти «за голову»"
            suffix="₽"
            inputMode="numeric"
            autoComplete="off"
            hint={
              pool !== null
                ? `Часть взноса, которая достаётся выбившему. В призовой фонд с каждого входа — ${formatNumber(pool)}${NBSP}₽.`
                : 'Часть взноса, которая достаётся выбившему.'
            }
            {...bind('bounty')}
          />
        </Section>

        <Section title="Ребаи">
          <div className="adm-grid-2">
            <Field
              label="Ребаи до уровня"
              inputMode="numeric"
              autoComplete="off"
              hint="Включительно. 0 — без ребаев и позднего входа."
              {...bind('rebuyUntil')}
            />
            <Field
              label="Лимит на игрока"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Без лимита"
              hint="Пусто — без лимита."
              {...bind('rebuyLimit')}
            />
          </div>
        </Section>

        <Section
          title="Призовые"
          aside={<PayoutSum sum={sum} strict={submitted} />}
          footer="Если игроков меньше, чем призовых мест, доли пересчитываются на тех, кто есть."
        >
          <div className="adm-payouts">
            {draft.payouts.map((value, i) => {
              const bad =
                submitted && (problems.payoutItems.includes(i) || Boolean(problems.fields.payouts));
              return (
                <div key={i} className="adm-payout">
                  <Field
                    label={`${i + 1}-е место`}
                    suffix="%"
                    inputMode="decimal"
                    autoComplete="off"
                    value={value}
                    onChange={(event) =>
                      setPayouts((list) => list.map((p, j) => (j === i ? event.target.value : p)))
                    }
                    className={cn(bad && 'm-field--error')}
                    aria-invalid={bad || undefined}
                  />
                  <IconButton
                    label={`Убрать ${i + 1}-е место`}
                    icon="x"
                    disabled={draft.payouts.length <= 1}
                    onClick={() => setPayouts((list) => list.filter((_, j) => j !== i))}
                  />
                </div>
              );
            })}
          </div>
          {submitted && problems.fields.payouts && (
            <InlineError>{problems.fields.payouts}</InlineError>
          )}
          <div>
            <Button variant="ghost" icon="plus" onClick={() => setPayouts((list) => [...list, ''])}>
              Добавить призовое место
            </Button>
          </div>
        </Section>

        <Section
          title="Уровни блайндов"
          aside={pluralWithNumber(levelCount, ['уровень', 'уровня', 'уровней'])}
          footer="После последнего уровня блайнды больше не растут."
        >
          {levelCount > 0 && (
            <ol className="adm-levels" aria-label="Уровни блайндов">
              {Number.isInteger(until) && until === 0 && (
                <RebuyMarker text="Без ребаев: вход закрывается со стартом таймера" />
              )}
              {draft.levels.map((level, index) => (
                <LevelItems
                  key={level.key}
                  index={index}
                  level={level}
                  count={levelCount}
                  start={preview.levelStarts[index] ?? null}
                  problem={submitted ? problems.levels[index] : undefined}
                  rebuyMarker={rebuyMarkerAfter(preview, index)}
                  onChange={(patch) => setLevel(index, patch)}
                  onTrigger={(trigger) => setLevel(index, changeTrigger(level, trigger))}
                  onDouble={() => setLevels((levels) => doublePrevious(levels, index))}
                  onMove={(delta) => setLevels((levels) => moveLevel(levels, index, delta))}
                  onRemove={() => removeLevelAt(index)}
                />
              ))}
            </ol>
          )}
          <Button icon="plus" block onClick={() => setLevels(appendLevel)}>
            Добавить уровень
          </Button>
          <p className="m-small adm-muted">Новый уровень — блайнды предыдущего ×2.</p>
        </Section>

        <Section title="Предпросмотр">
          <FormatPreviewCard preview={preview} format={format} pool={pool} />
        </Section>

        {submitted && !ok && (
          <Notice
            tone="critical"
            title={`Формат не сохранён: ${pluralWithNumber(problems.count, ['ошибка', 'ошибки', 'ошибок'])}`}
          >
            {problems.other.length > 0
              ? `${problems.other.join('. ')}. Остальное отмечено у полей.`
              : 'Исправьте отмеченные поля и сохраните ещё раз.'}
          </Notice>
        )}

        <div className="adm-actions">
          <Button
            type="submit"
            variant="primary"
            block
            loading={save.isPending}
            disabled={row !== null && !dirty}
          >
            {row ? 'Сохранить формат' : 'Создать формат'}
          </Button>
          {row !== null && !dirty && <p className="m-small adm-muted">Изменений нет.</p>}
        </div>

        {row && !row.is_archived && (
          <Section
            title="Архив"
            footer={
              isDefault
                ? 'Это формат по умолчанию: сначала выберите другой во вкладке «Клуб».'
                : 'Формат пропадёт из выбора для новых вечеров. Сыгранные по нему вечера не изменятся.'
            }
          >
            <Button
              icon="inbox"
              block
              disabled={isDefault || save.isPending}
              onClick={() => void setArchived(true)}
            >
              Перенести в архив
            </Button>
          </Section>
        )}
      </form>
    </Page>
  );
}

function InlineError({ children }: { children: string }) {
  return (
    <p className="adm-error" role="alert">
      <Icon name="alert-circle" size={14} />
      <span>{children}</span>
    </p>
  );
}

function PayoutSum({ sum, strict }: { sum: number | null; strict: boolean }) {
  if (sum === null) return <span className="adm-muted">Сумма — после ввода всех долей</span>;
  const exact = Math.abs(sum - 100) < 1e-9;
  return (
    <span className={cn('adm-sum', exact ? 'adm-sum--ok' : strict ? 'adm-sum--bad' : 'adm-muted')}>
      <Icon name={exact ? 'check-circle' : 'alert-circle'} size={14} />
      {exact ? `Сумма 100${NBSP}%` : `Сумма ${percent.format(sum)}${NBSP}% из 100${NBSP}%`}
    </span>
  );
}

function RebuyMarker({ text }: { text: string }) {
  return (
    <li className="adm-marker">
      <Icon name="clock" size={16} />
      <span>{text}</span>
    </li>
  );
}

/** Отметка «ребаи закрываются» после уровня index (с 0), если ребаи закрываются именно там. */
function rebuyMarkerAfter(preview: FormatPreview, index: number): string | null {
  const r = preview.rebuys;
  if (!r || (r.kind !== 'at' && r.kind !== 'after') || r.level !== index + 1) return null;
  return r.kind === 'at'
    ? `Ребаи закрываются в ${formatGameClock(r.minutes)} игрового времени`
    : 'Ребаи закрываются после этого уровня';
}

interface LevelItemsProps {
  index: number;
  level: LevelDraft;
  count: number;
  start: number | null;
  problem: LevelProblem | undefined;
  rebuyMarker: string | null;
  onChange: (patch: Partial<LevelDraft>) => void;
  onTrigger: (trigger: TriggerType) => void;
  onDouble: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

/** Строка уровня: блайнды, анте, триггер смены; действия — в меню «⋯». */
function LevelItems({
  index,
  level,
  count,
  start,
  problem,
  rebuyMarker,
  onChange,
  onTrigger,
  onDouble,
  onMove,
  onRemove,
}: LevelItemsProps) {
  const n = index + 1;
  const bad = (field: LevelField) => Boolean(problem?.fields.includes(field));
  const invalid = (field: LevelField) => ({
    className: cn(bad(field) && 'm-field--error'),
    'aria-invalid': bad(field) || undefined,
  });
  const input = (field: 'sb' | 'bb' | 'ante' | 'amount') => ({
    value: level[field],
    inputMode: 'numeric' as const,
    autoComplete: 'off',
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange({ [field]: event.target.value }),
    ...invalid(field),
  });

  return (
    <>
      <li className="adm-level">
        <div className="adm-level__head">
          <h3 className="adm-level__title">Уровень {n}</h3>
          <span className="m-small adm-muted adm-level__meta">
            {start !== null ? `старт ${formatGameClock(start)}` : ''}
          </span>
          <Menu
            label={`Действия с уровнем ${n}`}
            iconOnly
            icon="more-horizontal"
            variant="ghost"
            align="end"
            items={[
              {
                label: 'Удвоить предыдущий',
                icon: 'copy',
                disabled: index === 0,
                onSelect: onDouble,
              },
              {
                label: 'Сдвинуть выше',
                icon: 'chevron-up',
                disabled: index === 0,
                onSelect: () => onMove(-1),
              },
              {
                label: 'Сдвинуть ниже',
                icon: 'chevron-down',
                disabled: index === count - 1,
                onSelect: () => onMove(1),
              },
              { separator: true },
              {
                label: 'Удалить уровень',
                icon: 'trash',
                danger: true,
                disabled: count <= 1,
                onSelect: onRemove,
              },
            ]}
          />
        </div>
        <div className="adm-grid-3">
          <Field label="Малый" {...input('sb')} />
          <Field label="Большой" {...input('bb')} />
          <Field label="Анте" placeholder="—" {...input('ante')} />
        </div>
        <div className="adm-grid-trigger">
          <Select
            label="Смена уровня"
            value={level.trigger}
            options={TRIGGER_TYPES.map((t) => ({ value: t, label: TRIGGER_META[t].title }))}
            onChange={(event) => onTrigger(event.target.value as TriggerType)}
            {...invalid('trigger')}
          />
          <Field label={TRIGGER_META[level.trigger].amountLabel} {...input('amount')} />
        </div>
        {problem && problem.messages.length > 0 && (
          <InlineError>{problem.messages.join('. ')}</InlineError>
        )}
      </li>
      {rebuyMarker && <RebuyMarker text={rebuyMarker} />}
    </>
  );
}

interface PreviewProps {
  preview: FormatPreview;
  format: ReturnType<typeof checkDraft>['format'];
  pool: number | null;
}

/** Предпросмотр расписания: только то, что можно посчитать; нет данных — нет плитки. */
function FormatPreviewCard({ preview, format, pool }: PreviewProps) {
  const r = preview.rebuys;
  const first = format.levels[0];
  const tiles = [
    preview.timeLevels > 0 && (
      <Stat
        key="time"
        label="Уровни по времени"
        value={formatGameClock(preview.timeMinutes)}
        unit="ч"
        note={
          (preview.uniformMinutes !== null
            ? `${pluralWithNumber(preview.timeLevels, ['уровень', 'уровня', 'уровней'])} по ${preview.uniformMinutes}${NBSP}мин`
            : pluralWithNumber(preview.timeLevels, ['уровень', 'уровня', 'уровней'])) +
          (preview.otherLevels > 0 ? ` и ${preview.otherLevels} по вылетам или раздачам` : '')
        }
      />
    ),
    r?.kind === 'at' && (
      <Stat
        key="rebuy"
        label="Ребаи закроются"
        value={formatGameClock(r.minutes)}
        unit="ч"
        note={`в конце ${r.level}-го уровня, игровое время без пауз`}
      />
    ),
    preview.startingBb !== null && first && (
      <Stat
        key="bb"
        label="Стек на старте"
        value={formatPoints(preview.startingBb)}
        unit="BB"
        note={`${formatNumber(format.startingChips)} фишек при ${formatNumber(first.sb)}/${formatNumber(first.bb)}`}
      />
    ),
    pool !== null && (
      <Stat
        key="pool"
        label="В фонд с входа"
        value={formatNumber(pool)}
        unit="₽"
        note={`${formatNumber(format.bountyRub)}${NBSP}₽ — за голову`}
      />
    ),
  ].filter(Boolean);

  const rebuyNote =
    r?.kind === 'none'
      ? 'Ребаев нет: вход закрывается со стартом таймера.'
      : r?.kind === 'open'
        ? 'Ребаи открыты до конца турнира.'
        : r?.kind === 'after'
          ? `Ребаи закроются в конце ${r.level}-го уровня — когда, зависит от вылетов и раздач.`
          : null;

  if (tiles.length === 0 && !rebuyNote)
    return <p className="m-small adm-muted">Предпросмотр появится, когда в форме будут числа.</p>;

  return (
    <Card variant="sunken">
      {tiles.length > 0 && <Stats>{tiles}</Stats>}
      {rebuyNote && <p className="m-small">{rebuyNote}</p>}
    </Card>
  );
}
