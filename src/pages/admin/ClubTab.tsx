import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  useFormats,
  useSettings,
  useUpsertSettings,
  type FormatRow,
  type Settings,
} from '../../shared/api';
import {
  announceMoment,
  formatDateTime,
  formatPoints,
  moscowToIso,
  NBSP,
  nextGameSlot,
  useNow,
  WEEKDAYS,
} from '../../shared/lib';
import {
  Accordion,
  Button,
  Empty,
  ErrorView,
  Field,
  Notice,
  Section,
  Select,
  useToast,
} from '../../shared/ui';
import { useClosingConfirmation } from '../../shared/telegram';
import { BotUsernameAction, GroupActions, GroupHelp } from './BotSetup';
import { adminErrorText } from './lib';
import { ListSkeleton } from './parts';
import { useFocusInvalid } from './useFocusInvalid';
import {
  ANNOUNCE_HOURS_MAX,
  draftFromSettings,
  parseSettingsDraft,
  scoringChangeNote,
  settingsDirty,
  type SettingsDraft,
  type SettingsField,
} from './settingsDraft';

export interface ClubTabProps {
  /** Черновик живёт в AdminPage: переход на другую вкладку не теряет правки. null — правок нет. */
  draft: SettingsDraft | null;
  onDraftChange: (draft: SettingsDraft | null) => void;
}

/** Вкладка «Клуб»: группа и бот, расписание, очки рейтинга — одна форма с «Сохранить настройки». */
export function ClubTab({ draft, onDraftChange }: ClubTabProps) {
  const settings = useSettings();
  const formats = useFormats();

  if (settings.isPending || formats.isPending)
    return <ListSkeleton rows={3} label="Загрузка настроек" />;
  if (settings.isError)
    return (
      <ErrorView
        error={settings.error}
        title="Не удалось загрузить настройки"
        onRetry={() => void settings.refetch()}
      />
    );
  if (formats.isError)
    return (
      <ErrorView
        error={formats.error}
        title="Не удалось загрузить форматы"
        onRetry={() => void formats.refetch()}
      />
    );
  if (!settings.data)
    return (
      <Empty
        kind="error"
        title="Настроек клуба нет в базе"
        description="Строку настроек создаёт миграция 001_schema.sql. Примени миграции и обнови страницу."
      />
    );

  return (
    <ClubForm
      settings={settings.data}
      formats={formats.data}
      draft={draft}
      onDraftChange={onDraftChange}
    />
  );
}

interface ClubFormProps extends ClubTabProps {
  settings: Settings;
  formats: FormatRow[];
}

function ClubForm({ settings, formats, draft: lifted, onDraftChange }: ClubFormProps) {
  const draft = lifted ?? draftFromSettings(settings);
  const save = useUpsertSettings();
  const toast = useToast();
  const now = useNow(60_000);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusInvalid(formRef);
  const [touched, setTouched] = useState<ReadonlySet<SettingsField>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const { patch, errors } = parseSettingsDraft(draft);
  const dirty = settingsDirty(draft, settings);
  // Закрыть Mini App с несохранёнными настройками — только через вопрос Telegram.
  useClosingConfirmation(dirty);
  // Правила подсчёта не переписывают прошлое (миграция 013) — пометка говорит, на что они повлияют.
  const scoringNote = scoringChangeNote(draft, settings);
  const errorOf = (field: SettingsField) =>
    submitted || touched.has(field) ? errors[field] : undefined;

  const bind = (field: SettingsField) => ({
    value: draft[field],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onDraftChange({ ...draft, [field]: event.target.value }),
    onBlur: () => setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field))),
    error: errorOf(field),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (Object.keys(errors).length > 0) {
      setSubmitted(true);
      focusInvalid();
      return;
    }
    save.mutate(patch, {
      onSuccess: () => {
        onDraftChange(null);
        setTouched(new Set());
        setSubmitted(false);
        toast.success('Настройки сохранены');
      },
      onError: (error) => toast.error(adminErrorText(error)),
    });
  };

  // --- Пояснения из того, что сейчас в форме ---
  const groupConnected = patch.group_chat_id !== null && !errors.groupChatId;
  const scheduleOk = !errors.weekday && !errors.time;
  const slot = scheduleOk ? nextGameSlot(now, patch.game_weekday, patch.game_time) : null;
  const slotIso = slot ? moscowToIso(slot.date, slot.time) : null;
  const announce =
    scheduleOk && !errors.announceHours
      ? announceMoment(patch.game_weekday, patch.game_time, patch.announce_hours_before)
      : null;

  const activeFormats = formats.filter((f) => !f.is_archived || f.id === draft.formatId);
  const formatOptions = [
    { value: '', label: 'Встроенный клубный' },
    ...activeFormats.map((f) => ({
      value: f.id,
      label: f.is_archived ? `${f.name} (в архиве)` : f.name,
    })),
  ];

  return (
    <form ref={formRef} className="adm-form" onSubmit={onSubmit} noValidate>
      <Section title="Группа и бот">
        {settings.group_chat_id === null && (
          <Notice tone="caution" title="Группа клуба не подключена">
            Пока ID группы пуст, войти в приложение может только админ, а посты бота никуда не
            уходят.
          </Notice>
        )}
        <Field
          label="Имя бота"
          prefix="@"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="poker_club_bot"
          hint="Без @, как в BotFather. По нему строятся кнопки «Открыть» в постах; без имени посты уйдут без кнопки."
          {...bind('botUsername')}
        />
        <div className="adm-actions__row adm-bot-actions">
          <BotUsernameAction settings={settings} draft={lifted} onDraftChange={onDraftChange} />
        </div>
        <Field
          label="ID группы"
          autoComplete="off"
          spellCheck={false}
          placeholder="-1001234567890"
          hint="Найди группу кнопкой ниже — ID подставится сам. Без группы в клуб пускают только админа."
          {...bind('groupChatId')}
        />
        <GroupActions settings={settings} draft={lifted} onDraftChange={onDraftChange} />
        <Accordion
          headingLevel="h3"
          items={[
            {
              id: 'chat-id',
              title: 'Если группа не находится',
              content: <GroupHelp />,
            },
          ]}
        />
      </Section>

      <Section
        title="Расписание"
        footer={
          slotIso ? (
            <>
              Ближайшая игра — {formatDateTime(slotIso, now)}.{' '}
              {announce
                ? `Бот создаст вечер ${WEEKDAYS[announce.weekday - 1]?.on ?? ''} в ${announce.time}–${plusQuarter(announce.time)}, за ${patch.announce_hours_before}${NBSP}ч до игры`
                : `Бот создаст вечер за ${patch.announce_hours_before}${NBSP}ч до игры`}
              {groupConnected
                ? ' и опубликует анонс в группе.'
                : '; анонса не будет, пока группа не подключена.'}
            </>
          ) : undefined
        }
      >
        <div className="adm-grid-2">
          <Select
            label="День игры"
            options={WEEKDAYS.map((d) => ({ value: String(d.value), label: d.title }))}
            {...bind('weekday')}
          />
          <Field label="Начало, МСК" type="time" step={300} {...bind('time')} />
        </div>
        <Field
          label="Анонс за"
          suffix="ч"
          inputMode="numeric"
          autoComplete="off"
          hint={`От 1 до ${ANNOUNCE_HOURS_MAX} часов до начала игры.`}
          {...bind('announceHours')}
        />
        <Field
          label="Место по умолчанию"
          autoComplete="off"
          placeholder="У Жени"
          hint="Подставляется в новые вечера и в анонс."
          {...bind('location')}
        />
        <Select
          label="Формат по умолчанию"
          options={formatOptions}
          hint="Его берёт бот для вечеров по расписанию и форма нового вечера."
          {...bind('formatId')}
        />
      </Section>

      <Section
        title="Очки рейтинга"
        footer={
          !errors.koPoints && !errors.winBonus && !errors.bestN
            ? `За вечер: N${NBSP}−${NBSP}место, где N — число игроков, плюс ${formatPoints(patch.ko_points)} за каждый нокаут и ${formatPoints(patch.win_bonus)} за победу. В сезон идут ${patch.season_best_n} лучших вечеров игрока.`
            : undefined
        }
      >
        <Field
          label="Лучших вечеров в зачёт сезона"
          inputMode="numeric"
          autoComplete="off"
          {...bind('bestN')}
        />
        {scoringNote && (
          <Notice tone="info" title="Прошлое не пересчитается">
            {scoringNote}
          </Notice>
        )}
        <div className="adm-grid-2">
          <Field
            label="Очки за нокаут"
            inputMode="decimal"
            autoComplete="off"
            {...bind('koPoints')}
          />
          <Field
            label="Бонус за победу"
            inputMode="decimal"
            autoComplete="off"
            {...bind('winBonus')}
          />
        </div>
      </Section>

      <div className="adm-actions">
        <Button type="submit" variant="primary" block loading={save.isPending} disabled={!dirty}>
          Сохранить настройки
        </Button>
        {dirty ? (
          <div className="adm-actions__row">
            <p className="m-small adm-muted">Есть несохранённые изменения.</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDraftChange(null);
                setTouched(new Set());
                setSubmitted(false);
              }}
            >
              Сбросить правки
            </Button>
          </div>
        ) : (
          <p className="m-small adm-muted">Изменений нет.</p>
        )}
      </div>
    </form>
  );
}

/** «19:00» → «19:15»: cron-tick проверяет расписание раз в 15 минут. */
function plusQuarter(time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const total = (h * 60 + m + 15) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
