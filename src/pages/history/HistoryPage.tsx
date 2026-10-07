import { clubMoments } from '@domain/feed.ts';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  clubFeedInput,
  momentsNowMs,
  type ClubHistory,
  type Evening,
  type EveningStatus,
  useClubHistory,
  useEveningEvents,
  useEvenings,
} from '../../shared/api';
import { useAuth } from '../../shared/auth';
import {
  eveningsCount,
  formatDate,
  formatRub,
  formatSeason,
  NBSP,
  paths,
  playersCount,
  useNow,
} from '../../shared/lib';
import {
  ButtonLink,
  Empty,
  ErrorView,
  EveningStatusBadge,
  List,
  ListItem,
  Page,
  PageSkeleton,
  Section,
  Tabs,
  type TabItem,
} from '../../shared/ui';
import './history.css';
import { openVotings } from './moments';
import { MomentsTab } from './MomentsTab';
import { eveningTotals, groupHistory, type EveningTotals } from './stats';

type HistoryTab = 'evenings' | 'moments';

/**
 * Вкладка в адресе (#/history?tab=moments): «Назад» с голосования возвращает на «Моменты».
 * Переключение — replace, чтобы вкладки не копили историю.
 */
function useHistoryTab(): [HistoryTab, (tab: HistoryTab) => void] {
  const [params, setParams] = useSearchParams();
  const tab: HistoryTab = params.get('tab') === 'moments' ? 'moments' : 'evenings';
  const set = (next: HistoryTab) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set('tab', next);
        return out;
      },
      { replace: true },
    );
  return [tab, set];
}

/** В истории — идущий вечер и прошедшие; анонсы показывает главная. */
const HISTORY_STATUSES = [
  'live',
  'finished',
  'settled',
  'cancelled',
] as const satisfies readonly EveningStatus[];

/**
 * /history — «Вечера»: вечера клуба по сезонам, новые сверху, идущий — отдельно сверху;
 * «Моменты»: победители номинаций всех вечеров (clubMoments домена).
 */
export default function HistoryPage() {
  const evenings = useEvenings({ status: HISTORY_STATUSES });
  const history = useClubHistory();

  if (evenings.isPending || history.isPending) return <PageSkeleton label="Загружаем историю" />;
  if (evenings.isError || history.isError) {
    return (
      <Page title="История">
        <ErrorView
          error={evenings.error ?? history.error}
          title="История не загрузилась"
          onRetry={() => {
            if (evenings.isError) void evenings.refetch();
            if (history.isError) void history.refetch();
          }}
        />
      </Page>
    );
  }
  return <History evenings={evenings.data} history={history.data} />;
}

function History({ evenings, history }: { evenings: Evening[]; history: ClubHistory }) {
  const { isAdmin } = useAuth();
  const layout = useMemo(() => groupHistory(evenings), [evenings]);
  const names = useMemo(
    () => new Map(history.players.map((p) => [p.id, p.display_name])),
    [history.players],
  );
  // Фонд и состав завершённых вечеров — replay домена по журналу из истории клуба.
  const totals = useMemo(() => {
    const map = new Map<string, EveningTotals>();
    for (const e of evenings) {
      const events = history.eventsByEvening.get(e.id);
      if (events) map.set(e.id, eveningTotals(e.format, events));
    }
    return map;
  }, [evenings, history.eventsByEvening]);

  // Моменты — по голосованиям, закрытым к загрузке истории (позже в кеше только свои голоса);
  // закрывшееся голосование подтянет перезапрос истории (useClubHistory). Минутный тик — для
  // плашки идущего голосования.
  const nowMs = useNow(60_000);
  const momentsNow = momentsNowMs(history, nowMs);
  const playersById = useMemo(
    () => new Map(history.players.map((p) => [p.id, p])),
    [history.players],
  );
  const moments = useMemo(
    () => clubMoments(clubFeedInput(history), { nowMs: momentsNow }),
    [history, momentsNow],
  );
  const open = useMemo(() => openVotings(history.evenings, nowMs), [history.evenings, nowMs]);
  const [tab, setTab] = useHistoryTab();

  const empty = layout.live.length === 0 && layout.seasons.length === 0;

  if (empty) {
    return (
      <Page title="История" subtitle="Вечера клуба и лучшие моменты, новые сверху">
        <Empty
          icon="calendar"
          title="Вечеров ещё не было"
          description="Вечер появится здесь, когда банкир запустит таймер, а после игры — с победителем и фондом."
          action={
            isAdmin ? (
              <ButtonLink to={paths.adminEveningNew} icon="plus">
                Назначить вечер
              </ButtonLink>
            ) : undefined
          }
        />
      </Page>
    );
  }

  const eveningsContent = (
    <div className="hs-panel">
      {layout.live.length > 0 && (
        <Section title="Сейчас">
          <List aria-label="Идущие вечера">
            {layout.live.map((e) => (
              <LiveRow key={e.id} evening={e} />
            ))}
          </List>
        </Section>
      )}

      {layout.seasons.map((group) => {
        const played = group.evenings.filter((e) => e.status !== 'cancelled').length;
        return (
          <Section
            key={group.seasonKey}
            title={formatSeason(group.seasonKey)}
            aside={played > 0 ? eveningsCount(played) : undefined}
          >
            <List aria-label={`Вечера сезона «${formatSeason(group.seasonKey)}»`}>
              {group.evenings.map((e) => (
                <ListItem
                  key={e.id}
                  to={paths.evening(e.id)}
                  title={<EveningTitle evening={e} />}
                  subtitle={pastDetails(e, history, names, totals.get(e.id))}
                />
              ))}
            </List>
          </Section>
        );
      })}
    </div>
  );

  const tabs: TabItem<HistoryTab>[] = [
    { id: 'evenings', label: 'Вечера', content: eveningsContent },
    {
      id: 'moments',
      label: 'Моменты',
      count: moments.length > 0 ? moments.length : undefined,
      content: (
        <MomentsTab history={history} moments={moments} open={open} playersById={playersById} />
      ),
    },
  ];

  return (
    <Page title="История" subtitle="Вечера клуба и лучшие моменты, новые сверху">
      <Tabs label="Разделы истории" tabs={tabs} value={tab} onChange={setTab} />
    </Page>
  );
}

function EveningTitle({ evening }: { evening: Evening }) {
  return (
    <span className="hs-title">
      <span className="hs-title__date">{formatDate(evening.scheduled_at)}</span>
      <EveningStatusBadge status={evening.status} />
    </span>
  );
}

/** Строка прошедшего вечера: победитель, участники, фонд; у отменённого — причина отмены. */
function pastDetails(
  evening: Evening,
  history: ClubHistory,
  names: ReadonlyMap<string, string>,
  totals: EveningTotals | undefined,
): string {
  if (evening.status === 'cancelled') return evening.cancel_reason?.trim() || 'Вечер не состоялся';
  const summary = history.summaryById.get(evening.id);
  const parts: string[] = [];
  const winner = summary?.places[0];
  if (winner) parts.push(`Победитель${NBSP}— ${names.get(winner) ?? 'игрок не найден'}`);
  else parts.push('Итог не подсчитан: журнал вечера не сходится');
  const players = summary?.entrants.length ?? totals?.players;
  if (players !== undefined) parts.push(playersCount(players));
  if (totals) parts.push(`фонд${NBSP}${formatRub(totals.prizePoolRub)}`);
  return parts.join(' · ');
}

/** Идущий вечер: состав и фонд по живому журналу (Realtime), чтобы цифры не отставали. */
function LiveRow({ evening }: { evening: Evening }) {
  const events = useEveningEvents(evening.id);
  const totals = useMemo(
    () => (events.data ? eveningTotals(evening.format, events.data) : null),
    [events.data, evening.format],
  );

  let details: string;
  if (events.isError) details = 'Состав не загрузился — открой вечер';
  else if (!totals) details = 'Загружаем состав';
  else if (totals.players === 0) details = 'Игроков ещё нет';
  else
    details = `В игре ${totals.alive} из${NBSP}${totals.players} · фонд${NBSP}${formatRub(totals.prizePoolRub)}`;

  return (
    <ListItem
      to={paths.evening(evening.id)}
      title={<EveningTitle evening={evening} />}
      subtitle={evening.location ? `${evening.location} · ${details}` : details}
    />
  );
}
