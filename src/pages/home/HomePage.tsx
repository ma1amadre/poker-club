// Главная читается сверху вниз: что дальше (незакрытые расчёты, ближайший вечер — анонс с ответом
// и прогнозом или идущая игра, открытое голосование) → что нового (лента «В клубе») → где я
// (последний вечер с «Твоим вечером», место в сезоне). Регистр — Кобальт (useTheme).
// Тренировочный вечер (миграция 023) не «ближайший вечер» клуба: он — отдельной строкой «Тренировка»
// под ним, пока объявлен или идёт; в долги, ленту и сезон не попадает (история клуба без тренировок).
// Вопрос «Играешь или следишь?» (миграция 024) — под ближайшим вечером, пока человек не выбрал.
// Сезон как событие: последний вечер квартала в анонсе помечен «Финал сезона» (isSeasonFinale домена),
// первые две недели нового квартала — карточка «Итоги сезона» (над лентой). Внизу — «Гонка сезона»:
// место, очки до соседей и лидера, вечера в зачёте и игровые дни до конца квартала (пока вечер сезона
// объявлен или идёт, «игр больше нет» не пишет).
import { isSeasonFinale, type CalendarEvening } from '@domain/seasonCalendar.ts';
import { seasonKey } from '@domain/season.ts';
import { useMemo } from 'react';
import {
  isTrainingEvening,
  useClubHistory,
  useEvenings,
  usePlayers,
  useSettings,
  withoutTraining,
  type Evening,
  type Player,
  type Settings,
} from '../../shared/api';
import { useAuth, useCurrentPlayer } from '../../shared/auth';
import { formatDateTime, paths, useNow } from '../../shared/lib';
import {
  ButtonLink,
  ErrorView,
  List,
  ListItem,
  Page,
  PageSkeleton,
  Section,
} from '../../shared/ui';
import { FeedSection } from './FeedSection';
import { LastEveningSection, OpenVoting } from './LastEveningSection';
import { pickTraining, pickUpcoming, seasonEveningPending } from './lib';
import { RoleQuestion } from './RoleQuestion';
import { SeasonResultsSection } from './SeasonResultsSection';
import { SeasonSection } from './SeasonSection';
import { SettlementNotices } from './SettlementNotices';
import { AnnouncedEvening, LiveEvening, NextGame } from './UpcomingSection';
import './home.css';

export default function HomePage() {
  const me = useCurrentPlayer();
  const { isAdmin } = useAuth();
  const evenings = useEvenings();
  const players = usePlayers();
  const settings = useSettings();
  const history = useClubHistory();
  // Минутной точности хватает: выбор вечера и «голосование открыто» не меняются посекундно.
  const nowMinute = useNow(60_000);

  const playersById = useMemo(
    () => new Map<string, Player>((players.data ?? []).map((p) => [p.id, p])),
    [players.data],
  );

  // Ждём и историю: долги и итоги стоят выше сгиба, их появление позже сдвигало бы экран.
  if (evenings.isPending || players.isPending || settings.isPending || history.isPending) {
    return <PageSkeleton label="Загрузка главной" />;
  }

  const failed = [evenings, players, settings].find((q) => q.isError);
  if (failed) {
    return (
      <Page title="Покерный клуб" documentTitle="Главная">
        <ErrorView
          error={failed.error}
          title="Главная не загрузилась"
          onRetry={() => {
            void evenings.refetch();
            void players.refetch();
            void settings.refetch();
            void history.refetch();
          }}
        />
      </Page>
    );
  }

  const all = evenings.data ?? [];
  const real = withoutTraining(all);
  const upcoming = pickUpcoming(real, nowMinute);
  const training = pickTraining(all.filter(isTrainingEvening), nowMinute);
  const finaleSeasonKey =
    upcoming?.status === 'announced' ? finaleOf(upcoming, real, settings.data ?? null) : null;

  return (
    <Page
      title="Покерный клуб"
      documentTitle="Главная"
      actions={
        // Своя карточка (там же «Сменить имя») — иначе новичку без вечеров в рейтинге до неё не дойти.
        <ButtonLink size="sm" variant="ghost" icon="user" to={paths.player(me.id)}>
          Моя карточка
        </ButtonLink>
      }
    >
      {history.data && (
        <SettlementNotices history={history.data} me={me} playersById={playersById} />
      )}

      {upcoming?.status === 'live' && (
        <LiveEvening evening={upcoming} me={me} playersById={playersById} />
      )}
      {upcoming?.status === 'announced' && (
        <AnnouncedEvening
          evening={upcoming}
          me={me}
          isAdmin={isAdmin}
          players={players.data ?? []}
          playersById={playersById}
          nowMs={nowMinute}
          finaleSeasonKey={finaleSeasonKey}
        />
      )}
      {!upcoming && (
        <NextGame settings={settings.data ?? null} isAdmin={isAdmin} nowMs={nowMinute} />
      )}
      {training && <TrainingRow evening={training} playersById={playersById} nowMs={nowMinute} />}
      {me.is_spectator === null && !me.is_guest && <RoleQuestion />}

      {history.data && <OpenVoting history={history.data} me={me} nowMs={nowMinute} />}

      {history.data && (
        <SeasonResultsSection
          history={history.data}
          me={me}
          playersById={playersById}
          nowMs={nowMinute}
        />
      )}

      {history.data && (
        <FeedSection history={history.data} me={me} playersById={playersById} nowMs={nowMinute} />
      )}

      <LastEveningSection history={history} me={me} playersById={playersById} nowMs={nowMinute} />
      {history.data && !me.is_guest && (
        <SeasonSection
          history={history.data}
          me={me}
          settings={settings.data ?? null}
          eveningPending={seasonEveningPending(real, history.data.currentSeasonKey, nowMinute)}
          nowMs={nowMinute}
        />
      )}
    </Page>
  );
}

/** Вечер для календаря сезона (домен): отменённый держит свой слот расписания. */
function calendarEvening(e: Evening): CalendarEvening {
  return {
    id: e.id,
    scheduledAt: e.scheduled_at,
    slotDate: e.slot_date,
    cancelled: e.status === 'cancelled',
  };
}

/**
 * Сезон, финал которого объявленный вечер (последний вечер квартала), или null. Вечера — настоящие,
 * в любом статусе; расписание — из настроек клуба (нет — только по вечерам).
 */
function finaleOf(
  evening: Evening,
  evenings: readonly Evening[],
  settings: Pick<Settings, 'game_weekday' | 'game_time'> | null,
): string | null {
  const schedule = settings ? { weekday: settings.game_weekday, time: settings.game_time } : null;
  return isSeasonFinale(calendarEvening(evening), evenings.map(calendarEvening), schedule)
    ? seasonKey(evening.scheduled_at)
    : null;
}

/** Тренировка — строкой со ссылкой на экран вечера: прогон пульта, табло и голоса. */
function TrainingRow({
  evening,
  playersById,
  nowMs,
}: {
  evening: Evening;
  playersById: Map<string, Player>;
  nowMs: number;
}) {
  const banker = evening.banker_id ? playersById.get(evening.banker_id)?.display_name : null;
  const subtitle = [
    evening.status === 'live' ? 'идёт' : formatDateTime(evening.scheduled_at, nowMs),
    banker ? `банкир ${banker}` : null,
    'не попадёт в историю и рейтинг',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Section title="Тренировка">
      <List aria-label="Тренировочный вечер">
        <ListItem
          title="Прогон пульта, табло и голоса"
          subtitle={subtitle}
          to={paths.evening(evening.id)}
        />
      </List>
    </Section>
  );
}
