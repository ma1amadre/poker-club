// Создание и правка вечера (/admin/evening/new, /admin/evening/:id): дата и время по Москве,
// место, заметка, формат (снимок config в evenings.format — у начатого вечера не меняется),
// банкир (меняется в любой момент), отмена до старта, ссылки на экран вечера и расчёт.
// Если анонс уже в группе, после сохранения бот пишет о переносе, отмене или возврате вечера
// (notify evening_changed; не дошедший вызов добьёт cron-tick).
// Тренировочный вечер (миграция 023, /admin/evening/new?training=1): сегодня через несколько минут,
// банкир — админ; день клуба не занимает, в группу о нём ничего не уходит, отмены нет — только
// «Удалить тренировку» целиком (delete_training_evening). Завершённую тренировку можно засчитать как
// настоящий вечер (promote_training_evening, миграция 026) — та же кнопка, что на экране итога.
// Вторая и следующие игры дня (game_no, миграция 026) — «· игра 2» в шапке; занятые даты формы — по
// номеру игры: у игры 2 дата игры 1 не «занята».
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchEvening,
  isTrainingEvening,
  notifyEveningChanged,
  queryKeys,
  upsertEvening,
  useEvening,
  useEvenings,
  useFormats,
  usePlayers,
  useSettings,
  useDeleteTrainingEvening,
  useEveningEvents,
  useUpsertEvening,
  type Evening,
  type EveningInput,
  type EveningStatus,
  type FormatRow,
  type Player,
  type Settings,
} from '../../shared/api';
import { useCurrentPlayer } from '../../shared/auth';
import {
  capitalize,
  formatDate,
  gameSuffix,
  formatTime,
  formatWeekdayDate,
  moscowToIso,
  paths,
  useNow,
} from '../../shared/lib';
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
  TrainingBadge,
  useConfirm,
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
  trainingEveningDraft,
  type EveningDraft,
  type EveningField,
} from './eveningDraft';
import { formatSummary } from './formatDraft';
import {
  adminErrorText,
  announceChangeText,
  announceReach,
  bankerCandidates,
  cancelConfirmMessage,
  cancelFooter,
  cancelledNoticeText,
  noteHint,
  takenDates,
  trainingDeletedText,
  vacatedSlot,
} from './lib';
import { AdminGuard } from './parts';
import { useFocusInvalid } from './useFocusInvalid';
import { usePromoteTraining } from '../evening/usePromoteTraining';
import { useLeave } from './useLeave';

const EVENINGS_PATH = `${paths.admin}?tab=evenings`;
/** Как check у evenings.cancel_reason (миграция 010). */
const CANCEL_REASON_MAX = 200;

/** «2026-10-08» → полдень этого дня по Москве: подпись даты без сдвига на соседний день. */
const clubNoon = (date: string) => moscowToIso(date, '12:00') ?? date;

const LOCKED_FORMAT_NOTE: Record<EveningStatus, string> = {
  announced: '',
  live: 'Игра уже идёт — формат вечера не меняется.',
  finished: 'Вечер сыгран — формат не меняется.',
  settled: 'Вечер сыгран — формат не меняется.',
  cancelled: 'Вечер отменён. Чтобы сменить формат, сначала верни вечер.',
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
  const [params] = useSearchParams();
  // ?training=1 — только у нового вечера; у существующего пометка — из строки.
  const trainingParam = !id && params.get('training') === '1';
  const evening = useEvening(id);
  const evenings = useEvenings();
  const formats = useFormats();
  const settings = useSettings();
  const players = usePlayers();

  // У /admin/evening/new запроса вечера нет (enabled: false) — он навсегда «pending».
  const queries = [evenings, formats, settings, players, ...(id ? [evening] : [])];
  const failed = queries.find((q) => q.isError);
  const title = id ? 'Вечер' : trainingParam ? 'Тренировочный вечер' : 'Новый вечер';

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
      key={id ?? (trainingParam ? 'new-training' : 'new')}
      evening={evening.data ?? null}
      training={evening.data ? isTrainingEvening(evening.data) : trainingParam}
      evenings={evenings.data ?? []}
      formats={formats.data ?? []}
      settings={settings.data ?? null}
      players={players.data ?? []}
    />
  );
}

interface EveningFormProps {
  evening: Evening | null;
  /** Тренировочный вечер (миграция 023): у нового — из ?training=1, у существующего — из строки. */
  training: boolean;
  evenings: Evening[];
  formats: FormatRow[];
  settings: Settings | null;
  players: Player[];
}

function EveningForm({
  evening,
  training,
  evenings,
  formats,
  settings,
  players,
}: EveningFormProps) {
  const me = useCurrentPlayer();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow(60_000);
  const save = useUpsertEvening();
  const removeTraining = useDeleteTrainingEvening();
  // Зачёт завершённой тренировки (миграция 026): в вопросе — гости за её столом.
  const promotable =
    evening !== null && training && (evening.status === 'finished' || evening.status === 'settled');
  const trainingEvents = useEveningEvents(promotable ? evening.id : undefined).data ?? [];
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusInvalid(formRef);
  const [checking, setChecking] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<EveningField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  // Причина отмены для поста в группу — отдельно от заметки анонса (evenings.cancel_reason).
  const [cancelReason, setCancelReason] = useState('');

  // Тренировка день клуба не занимает — для неё занятых дат нет.
  const taken = useMemo(
    () => (training ? new Set<string>() : takenDates(evenings, evening?.id, evening?.game_no ?? 1)),
    [training, evenings, evening?.id, evening?.game_no],
  );
  const [initial] = useState<EveningDraft>(() =>
    evening
      ? draftFromEvening(evening)
      : training
        ? trainingEveningDraft(Date.now(), settings, formats, me.id)
        : newEveningDraft(Date.now(), settings, formats, taken),
  );
  // После сохранения «исходное» — то, что теперь в базе.
  const baseline = evening ? draftFromEvening(evening) : initial;
  const [draft, setDraft] = useState<EveningDraft>(initial);
  const dirty = eveningDirty(draft, { ...baseline, formatChoice: initial.formatChoice });

  const { leave, confirmElement } = useLeave(EVENINGS_PATH, dirty, 'вечера');
  const { confirm, confirmElement: cancelConfirmElement } = useConfirm();
  const promote = usePromoteTraining(confirm);
  const promoteTraining = () => {
    if (!evening) return;
    const seated = new Set(
      trainingEvents
        .filter((e) => e.type === 'join' && !e.voided)
        .map((e) => (e.payload as { playerId?: unknown }).playerId),
    );
    const guests = players.filter((p) => p.is_guest && seated.has(p.id)).map((p) => p.display_name);
    void promote.run(evening.id, guests);
  };

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
  // Узнает ли группа об отмене или возврате: о прошедшем вечере сервер молчит.
  const reach = evening ? announceReach(evening, now) : 'none';
  // Перенос на другой день: день по расписанию останется за этим вечером (slot_date) пустым.
  const vacated =
    evening && status === 'announced' && !training
      ? vacatedSlot(evening, draft.date, settings?.game_weekday, now)
      : null;

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

  /**
   * Сохранили вечер, анонс которого уже в группе, — пусть бот скажет группе о переносе, отмене или
   * возврате (сервер сам сравнит с тем, что группа знает). Тост один: «сохранено» и что ушло в группу.
   */
  const savedToast = async (saved: Evening, text: string, quietDetail?: string) => {
    if (!saved.announce_posted_at) {
      toast.success(text);
      return;
    }
    try {
      const { outcome, change, move } = await notifyEveningChanged(saved.id);
      if (outcome === 'posted' && change)
        toast.success(text, { detail: announceChangeText(change, move) });
      else if (outcome === 'no_group')
        toast.show(text, {
          tone: 'caution',
          detail: 'Группа клуба не подключена — пост о правке не отправлен.',
        });
      else toast.success(text, quietDetail ? { detail: quietDetail } : undefined);
    } catch {
      // Снимок на сервере не сдвинулся — cron-tick повторит пост сам.
      toast.show(text, {
        tone: 'caution',
        detail: 'Пост в группу пока не ушёл — бот отправит его сам в течение 15 минут.',
      });
    }
    invalidate();
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
      ...(evening
        ? { id: evening.id }
        : { created_by: me.id, ...(training ? { is_training: true } : {}) }),
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
          void savedToast(saved, 'Вечер сохранён');
        } else if (training) {
          // Тренировку создают, чтобы сразу прогнать пульт: открываем экран вечера.
          toast.success('Тренировка создана', {
            detail:
              'Посади игроков и запусти таймер — табло и голос работают как в настоящей игре.',
          });
          navigate(paths.evening(saved.id), { replace: true });
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
      ...(next === 'announced' ? { cancel_reason: null } : {}),
    });

  const cancelEvening = async () => {
    if (!evening) return;
    try {
      if (!(await stillAnnounced())) return;
    } catch (error) {
      toast.error(adminErrorText(error));
      return;
    }
    // Причина — только для поста в группу; заметку анонса отмена не трогает.
    const cancelReach = announceReach(evening, Date.now());
    const reason = cancelReach === 'group' ? cancelReason.trim() : '';
    if (cancelReach === 'group') {
      // Пост в группу не отзовёшь — подтверждение. Без поста отмена обратима: «Вернуть» рядом.
      const ok = await confirm({
        title: `Отменить вечер ${formatDate(evening.scheduled_at, now)}?`,
        message: cancelConfirmMessage(reason),
        confirmText: 'Отменить вечер',
        cancelText: 'Не отменять',
        danger: true,
      });
      if (!ok) return;
    }
    save.mutate(
      {
        id: evening.id,
        scheduled_at: evening.scheduled_at,
        format: evening.format,
        cancel_reason: reason || null,
        status: 'cancelled',
      },
      {
        onSuccess: (saved) => {
          setCancelReason('');
          if (saved.announce_posted_at) {
            // Снимок анонса обновит notify; о прошедшем вечере — молча.
            void savedToast(
              saved,
              'Вечер отменён',
              cancelReach === 'past'
                ? 'Время вечера уже прошло — в группу ничего не ушло.'
                : undefined,
            );
            return;
          }
          toast.show('Вечер отменён', {
            durationMs: 8000,
            action: {
              label: 'Вернуть',
              onClick: () =>
                void writeStatus(saved, 'announced')
                  .then(invalidate)
                  .catch((error: unknown) => toast.error(adminErrorText(error))),
            },
          });
        },
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
        cancel_reason: null,
        status: 'announced',
      },
      {
        onSuccess: (saved) => void savedToast(saved, 'Вечер снова в анонсе'),
        onError: (error) => toast.error(adminErrorText(error)),
      },
    );
  };

  /** Удалить тренировку целиком — без возврата, поэтому через подтверждение. */
  const deleteTraining = async () => {
    if (!evening) return;
    const ok = await confirm({
      title: 'Удалить тренировку?',
      message:
        'Журнал, ответы и гости, которых завели на этой тренировке, удалятся без возврата. На историю клуба и рейтинг это не влияет.',
      confirmText: 'Удалить тренировку',
      cancelText: 'Не удалять',
      danger: true,
    });
    if (!ok) return;
    removeTraining.mutate(evening.id, {
      onSuccess: ({ guestsDeleted }) => {
        toast.success(trainingDeletedText(guestsDeleted));
        navigate(EVENINGS_PATH, { replace: true });
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  const titleText = evening
    ? `${capitalize(formatWeekdayDate(evening.scheduled_at))}${training ? '' : gameSuffix(evening.game_no)}`
    : training
      ? 'Тренировочный вечер'
      : 'Новый вечер';

  return (
    <Page
      className="adm-page"
      eyebrow={evening ? 'Вечер клуба' : 'Админка'}
      title={titleText}
      subtitle={
        evening ? (
          <span className="adm-subtitle">
            <EveningStatusBadge status={evening.status} />
            {training && <TrainingBadge />}
            <span>
              {[formatTime(evening.scheduled_at), evening.location].filter(Boolean).join(' · ')}
            </span>
          </span>
        ) : undefined
      }
      back={{ onBack: () => void leave(), fallback: EVENINGS_PATH }}
    >
      {confirmElement}
      {cancelConfirmElement}

      {training && (
        <Notice tone="info" title={evening ? 'Тренировочный вечер' : 'Как устроена тренировка'}>
          Прогон пульта, табло и голоса. Вечер не попадёт в историю, рейтинг, сезон, ачивки, ленту и
          посты бота, голосования у него нет, день клуба он не занимает.{' '}
          {evening
            ? 'Когда прогон закончен, удали его целиком — кнопка внизу. Сыграли всерьёз — завершённую тренировку можно засчитать как настоящий вечер.'
            : 'После прогона его удаляют целиком здесь же, в форме вечера.'}
        </Notice>
      )}

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
          {cancelledNoticeText(evening?.cancel_reason ?? null, reach)}
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
          {moved && status === 'announced' && (
            <Notice tone="info" title="Анонс уже в группе">
              {check.past
                ? 'Новое время уже прошло — о переносе бот в группу писать не будет.'
                : 'После сохранения бот напишет в группу, что вечер перенесён, с новым временем и местом.'}
            </Notice>
          )}
          {vacated && (
            <Notice
              tone="caution"
              title={`${formatDate(clubNoon(vacated), now)} останется без вечера`}
            >
              Этот вечер закреплён за днём по расписанию, поэтому бот не создаст на него новый. Если
              в этот день тоже нужна игра, создай вечер отдельно.
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
            hint={
              training
                ? 'Видна только на экране тренировки — в группу ничего не уходит.'
                : noteHint(status, Boolean(evening?.announce_posted_at))
            }
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
                hints={{ [me.id]: 'это ты' }}
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
            {evening ? 'Сохранить вечер' : training ? 'Создать тренировку' : 'Создать вечер'}
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

      {promotable && (
        <Section
          title="Зачёт"
          footer="Сыграли всерьёз — засчитай тренировку: места, очки, ачивки и деньги войдут в историю клуба, в группу уйдёт пост итогов, голосование откроется на 24 часа. Обратно в тренировку вечер не вернуть."
        >
          <Button
            variant="danger"
            icon="check"
            block
            loading={promote.pending}
            onClick={promoteTraining}
          >
            Засчитать как настоящий вечер
          </Button>
        </Section>
      )}

      {evening && training && (
        <Section
          title="Удаление"
          footer="Тренировку не отменяют, а удаляют целиком: журнал, ответы и гостей, которых завели на ней."
        >
          <Button
            variant="danger"
            icon="trash"
            block
            loading={removeTraining.isPending}
            onClick={() => void deleteTraining()}
          >
            Удалить тренировку
          </Button>
        </Section>
      )}

      {evening && status === 'announced' && !training && (
        <Section title="Отмена" footer={cancelFooter(reach)}>
          {reach === 'group' && (
            <Field
              label="Причина для группы"
              autoComplete="off"
              maxLength={CANCEL_REASON_MAX}
              placeholder="Не собирается состав"
              hint="Необязательно. Бот добавит её в пост об отмене, заметка анонса не изменится."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          )}
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
