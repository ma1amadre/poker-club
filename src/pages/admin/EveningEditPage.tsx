// Создание и правка вечера (/admin/evening/new, /admin/evening/:id): дата и время по Москве,
// место, заметка, формат (снимок config в evenings.format — у начатого вечера не меняется),
// банкир (меняется в любой момент), отмена до старта, ссылки на экран вечера и расчёт.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchEvening,
  queryKeys,
  upsertEvening,
  useEvening,
  useEvenings,
  useFormats,
  usePlayers,
  useSettings,
  useUpsertEvening,
  type Evening,
  type EveningInput,
  type EveningStatus,
  type FormatRow,
  type Player,
  type Settings,
} from '../../shared/api';
import { useCurrentPlayer } from '../../shared/auth';
import { capitalize, formatTime, formatWeekdayDate, paths, useNow } from '../../shared/lib';
import {
  Button,
  ButtonLink,
  Empty,
  ErrorView,
  EveningStatusBadge,
  Field,
  FieldGroup,
  Icon,
  List,
  ListItem,
  Notice,
  Page,
  PageSkeleton,
  PlayerPicker,
  Section,
  Select,
  useToast,
} from '../../shared/ui';
import './admin.css';
import {
  BUILTIN_FORMAT,
  checkEveningDraft,
  chosenFormat,
  draftFromEvening,
  eveningDirty,
  KEEP_FORMAT,
  newEveningDraft,
  type EveningDraft,
  type EveningField,
} from './eveningDraft';
import { formatSummary } from './formatDraft';
import { adminErrorText, bankerCandidates, takenDates } from './lib';
import { AdminGuard } from './parts';
import { useFocusInvalid } from './useFocusInvalid';
import { useLeave } from './useLeave';

const EVENINGS_PATH = `${paths.admin}?tab=evenings`;

const LOCKED_FORMAT_NOTE: Record<EveningStatus, string> = {
  announced: '',
  live: 'Игра уже идёт — формат вечера не меняется.',
  finished: 'Вечер сыгран — формат не меняется.',
  settled: 'Вечер сыгран — формат не меняется.',
  cancelled: 'Вечер отменён. Чтобы сменить формат, сначала верните вечер.',
};

export default function EveningEditPage() {
  return (
    <AdminGuard>
      <EveningEditScreen />
    </AdminGuard>
  );
}

function EveningEditScreen() {
  const { id } = useParams<{ id: string }>();
  const evening = useEvening(id);
  const evenings = useEvenings();
  const formats = useFormats();
  const settings = useSettings();
  const players = usePlayers();

  // У /admin/evening/new запроса вечера нет (enabled: false) — он навсегда «pending».
  const queries = [evenings, formats, settings, players, ...(id ? [evening] : [])];
  const failed = queries.find((q) => q.isError);
  const title = id ? 'Вечер' : 'Новый вечер';

  if (failed)
    return (
      <Page title={title} back={{ fallback: EVENINGS_PATH }}>
        <ErrorView
          error={failed.error}
          title="Не удалось загрузить вечер"
          onRetry={() => queries.forEach((q) => q.isError && void q.refetch())}
        />
      </Page>
    );
  if (queries.some((q) => q.isPending)) return <PageSkeleton label="Загрузка вечера" />;
  if (id && !evening.data)
    return (
      <Page title="Вечер не найден" back={{ fallback: EVENINGS_PATH }}>
        <Empty
          kind="no-results"
          title="Такого вечера нет"
          description="Ссылка устарела или вечер удалён."
          action={
            <ButtonLink to={EVENINGS_PATH} icon="arrow-left">
              Вернуться к вечерам
            </ButtonLink>
          }
        />
      </Page>
    );

  return (
    <EveningForm
      key={id ?? 'new'}
      evening={evening.data ?? null}
      evenings={evenings.data ?? []}
      formats={formats.data ?? []}
      settings={settings.data ?? null}
      players={players.data ?? []}
    />
  );
}

interface EveningFormProps {
  evening: Evening | null;
  evenings: Evening[];
  formats: FormatRow[];
  settings: Settings | null;
  players: Player[];
}

function EveningForm({ evening, evenings, formats, settings, players }: EveningFormProps) {
  const me = useCurrentPlayer();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow(60_000);
  const save = useUpsertEvening();
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusInvalid(formRef);
  const [checking, setChecking] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<EveningField>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const taken = useMemo(() => takenDates(evenings, evening?.id), [evenings, evening?.id]);
  const [initial] = useState<EveningDraft>(() =>
    evening ? draftFromEvening(evening) : newEveningDraft(Date.now(), settings, formats, taken),
  );
  // После сохранения «исходное» — то, что теперь в базе.
  const baseline = evening ? draftFromEvening(evening) : initial;
  const [draft, setDraft] = useState<EveningDraft>(initial);
  const dirty = eveningDirty(draft, { ...baseline, formatChoice: initial.formatChoice });

  const { leave, confirmElement } = useLeave(EVENINGS_PATH, dirty, 'вечера');

  const status = evening?.status ?? 'announced';
  const formatLocked = evening !== null && status !== 'announced';
  const activeFormats = formats.filter((f) => !f.is_archived);
  const format = chosenFormat(draft.formatChoice, formats, evening?.format ?? null);
  const check = checkEveningDraft(draft, { taken, nowMs: now, format });
  const errorOf = (field: EveningField) =>
    submitted || touched.has(field) ? check.errors[field] : undefined;
  const touch = (field: EveningField) =>
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  const set = <K extends keyof EveningDraft>(key: K, value: EveningDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const candidates = bankerCandidates(players, evening?.banker_id ?? null);
  const moved =
    evening !== null &&
    evening.announce_posted_at !== null &&
    check.scheduledAt !== null &&
    Date.parse(check.scheduledAt) !== Date.parse(evening.scheduled_at);

  const formatOptions = [
    ...(evening
      ? [{ value: KEEP_FORMAT, label: `Без изменений — ${evening.format?.name ?? 'снимок'}` }]
      : []),
    ...activeFormats.map((f) => ({ value: f.id, label: f.name })),
    ...(activeFormats.length === 0 ? [{ value: BUILTIN_FORMAT, label: 'Встроенный клубный' }] : []),
  ];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.eveningsAll });
    if (evening) void queryClient.invalidateQueries({ queryKey: queryKeys.evening(evening.id) });
  };

  /** Вечер всё ещё до старта? Пока форма была открыта, банкир мог запустить таймер. */
  const stillAnnounced = async (): Promise<boolean> => {
    if (!evening) return true;
    const fresh = await fetchEvening(evening.id);
    if (fresh?.status === 'announced') return true;
    invalidate();
    toast.error(
      'Вечер уже начался — формат и статус до старта больше не меняются. Данные обновлены.',
    );
    return false;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!check.scheduledAt || Object.keys(check.errors).length > 0 || !format) {
      setSubmitted(true);
      focusInvalid();
      return;
    }
    const changesFormat = evening !== null && draft.formatChoice !== KEEP_FORMAT;
    if (changesFormat) {
      setChecking(true);
      try {
        if (!(await stillAnnounced())) return;
      } catch (error) {
        toast.error(adminErrorText(error));
        return;
      } finally {
        setChecking(false);
      }
    }
    const input: EveningInput = {
      ...(evening ? { id: evening.id } : { created_by: me.id }),
      scheduled_at: check.scheduledAt,
      location: draft.location.trim() || null,
      note: draft.note.trim() || null,
      banker_id: draft.bankerId,
      format,
    };
    save.mutate(input, {
      onSuccess: (saved) => {
        if (evening) {
          // Формат взят снимком — дальше в поле «без изменений» он и есть.
          setDraft((d) => ({ ...d, formatChoice: KEEP_FORMAT }));
          setTouched(new Set());
          setSubmitted(false);
          toast.success('Вечер сохранён');
        } else {
          toast.success('Вечер создан');
          navigate(paths.adminEvening(saved.id), { replace: true });
        }
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  const writeStatus = (target: Evening, next: 'cancelled' | 'announced') =>
    upsertEvening({
      id: target.id,
      scheduled_at: target.scheduled_at,
      format: target.format,
      status: next,
    });

  const cancelEvening = async () => {
    if (!evening) return;
    try {
      if (!(await stillAnnounced())) return;
    } catch (error) {
      toast.error(adminErrorText(error));
      return;
    }
    // Обратимое действие — без подтверждения, с «Вернуть» в тосте (правило «Материи»).
    save.mutate(
      {
        id: evening.id,
        scheduled_at: evening.scheduled_at,
        format: evening.format,
        status: 'cancelled',
      },
      {
        onSuccess: (saved) =>
          toast.show('Вечер отменён', {
            durationMs: 8000,
            action: {
              label: 'Вернуть',
              onClick: () =>
                void writeStatus(saved, 'announced')
                  .then(invalidate)
                  .catch((error: unknown) => toast.error(adminErrorText(error))),
            },
          }),
        onError: (error) => toast.error(adminErrorText(error)),
      },
    );
  };

  const restoreEvening = () => {
    if (!evening) return;
    save.mutate(
      {
        id: evening.id,
        scheduled_at: evening.scheduled_at,
        format: evening.format,
        status: 'announced',
      },
      {
        onSuccess: () => toast.success('Вечер снова в анонсе'),
        onError: (error) => toast.error(adminErrorText(error)),
      },
    );
  };

  const titleText = evening ? capitalize(formatWeekdayDate(evening.scheduled_at)) : 'Новый вечер';

  return (
    <Page
      className="adm-page"
      eyebrow={evening ? 'Вечер клуба' : 'Админка'}
      title={titleText}
      subtitle={
        evening ? (
          <span className="adm-subtitle">
            <EveningStatusBadge status={evening.status} />
            <span>
              {[formatTime(evening.scheduled_at), evening.location].filter(Boolean).join(' · ')}
            </span>
          </span>
        ) : undefined
      }
      back={{ onBack: () => void leave(), fallback: EVENINGS_PATH }}
    >
      {confirmElement}

      {status === 'cancelled' && (
        <Notice
          tone="caution"
          title="Вечер отменён"
          action={
            <Button size="sm" loading={save.isPending} onClick={restoreEvening}>
              Вернуть
            </Button>
          }
        >
          Его нет среди ближайших, бот не создаст новый вечер на этот день.
        </Notice>
      )}
      {status === 'live' && (
        <Notice tone="info" title="Идёт игра">
          Формат уже не меняется. Банкира можно сменить — пульт перейдёт к новому банкиру.
        </Notice>
      )}

      <form ref={formRef} className="adm-form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <Section title="Когда и где">
          <div className="adm-grid-2">
            <Field
              label="Дата"
              type="date"
              value={draft.date}
              onChange={(e) => set('date', e.target.value)}
              onBlur={() => touch('date')}
              error={errorOf('date')}
            />
            <Field
              label="Начало, МСК"
              type="time"
              step={300}
              value={draft.time}
              onChange={(e) => set('time', e.target.value)}
              onBlur={() => touch('time')}
              error={errorOf('time')}
            />
          </div>
          {check.past && status === 'announced' && !errorOf('date') && (
            <p className="m-small adm-note">
              <Icon name="clock" size={14} />
              <span>Это время уже прошло. Так можно внести вечер задним числом.</span>
            </p>
          )}
          {moved && (
            <Notice tone="caution" title="Анонс уже в группе">
              Бот не обновит пост — напишите в группу о новом времени сами.
            </Notice>
          )}
          <Field
            label="Место"
            autoComplete="off"
            placeholder={settings?.default_location ?? 'У Жени'}
            value={draft.location}
            onChange={(e) => set('location', e.target.value)}
          />
          <Field
            label="Заметка"
            multiline
            placeholder="Возьмите наличку на ребаи"
            hint={status === 'announced' ? 'Попадёт в анонс в группе.' : undefined}
            value={draft.note}
            onChange={(e) => set('note', e.target.value)}
          />
        </Section>

        <Section
          title="Формат"
          footer={
            formatLocked
              ? LOCKED_FORMAT_NOTE[status]
              : 'В вечер сохраняется копия формата: поздние правки пресета его не изменят.'
          }
        >
          {formatLocked ? (
            <div className="adm-readonly">
              <p className="m-body adm-strong">{evening?.format?.name ?? 'Без названия'}</p>
              {evening && <p className="m-small adm-muted">{formatSummary(evening.format)}</p>}
            </div>
          ) : (
            <Select
              label="Формат турнира"
              options={formatOptions}
              value={draft.formatChoice}
              onChange={(e) => {
                set('formatChoice', e.target.value);
                touch('format');
              }}
              hint={format ? formatSummary(format) : undefined}
              error={errorOf('format')}
            />
          )}
        </Section>

        <Section title="Банкир">
          {candidates.length > 0 ? (
            <FieldGroup
              label="Кто ведёт учёт"
              hint="Банкир отмечает входы, ребаи, вылеты и деньги. Сменить можно в любой момент; повторный тап снимает выбор."
            >
              <PlayerPicker
                players={candidates}
                value={draft.bankerId ? [draft.bankerId] : []}
                onChange={(ids) => set('bankerId', ids[0] ?? null)}
                max={1}
                min={0}
                hints={{ [me.id]: 'это вы' }}
              />
            </FieldGroup>
          ) : (
            <p className="m-small adm-muted">
              В клубе пока нет активных участников с Telegram — банкира назначить некого.
            </p>
          )}
        </Section>

        <div className="adm-actions">
          <Button
            type="submit"
            variant="primary"
            block
            loading={save.isPending || checking}
            disabled={evening !== null && !dirty}
          >
            {evening ? 'Сохранить вечер' : 'Создать вечер'}
          </Button>
          {evening !== null && !dirty && <p className="m-small adm-muted">Изменений нет.</p>}
          {!evening && (
            <Button variant="ghost" block onClick={() => void leave()}>
              Отменить создание
            </Button>
          )}
        </div>
      </form>

      {evening && (
        <Section title="Ссылки">
          <List aria-label="Экраны вечера">
            <ListItem
              before={<Icon name="play" size={20} />}
              title="Экран вечера"
              subtitle="Таймер, состав и пульт банкира"
              to={paths.evening(evening.id)}
            />
            {(status === 'finished' || status === 'settled') && (
              <ListItem
                before={<Icon name="credit-card" size={20} />}
                title="Расчёт"
                subtitle="Кто кому должен и кто уже рассчитался"
                to={paths.settle(evening.id)}
              />
            )}
          </List>
        </Section>
      )}

      {evening && status === 'announced' && (
        <Section
          title="Отмена"
          footer={
            evening.announce_posted_at
              ? 'Анонс в группе останется — сообщите участникам сами. Вернуть вечер можно здесь же.'
              : 'Вечер пропадёт из ближайших, бот не создаст новый на этот день. Вернуть его можно здесь же.'
          }
        >
          <Button
            variant="danger"
            icon="x"
            block
            disabled={save.isPending}
            onClick={() => void cancelEvening()}
          >
            Отменить вечер
          </Button>
        </Section>
      )}
    </Page>
  );
}
