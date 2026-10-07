// Главная читается сверху вниз: что дальше (незакрытые расчёты, ближайший вечер — анонс с ответом
// и прогнозом или идущая игра, открытое голосование) → что нового (лента «В клубе») → где я
// (последний вечер с «Твоим вечером», место в сезоне). Регистр — Кобальт (useTheme).
import { useMemo } from 'react';
import {
  useClubHistory,
  useEvenings,
  usePlayers,
  useSettings,
  type Player,
} from '../../shared/api';
import { useAuth, useCurrentPlayer } from '../../shared/auth';
import { paths, useNow } from '../../shared/lib';
import { ButtonLink, ErrorView, Page, PageSkeleton } from '../../shared/ui';
import { FeedSection } from './FeedSection';
import { LastEveningSection, OpenVoting } from './LastEveningSection';
import { pickUpcoming } from './lib';
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

  const upcoming = pickUpcoming(evenings.data ?? [], nowMinute);

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
        />
      )}
      {!upcoming && (
        <NextGame settings={settings.data ?? null} isAdmin={isAdmin} nowMs={nowMinute} />
      )}

      {history.data && <OpenVoting history={history.data} me={me} nowMs={nowMinute} />}

      {history.data && (
        <FeedSection history={history.data} me={me} playersById={playersById} nowMs={nowMinute} />
      )}

      <LastEveningSection history={history} me={me} playersById={playersById} nowMs={nowMinute} />
      {history.data && !me.is_guest && <SeasonSection history={history.data} me={me} />}
    </Page>
  );
}
