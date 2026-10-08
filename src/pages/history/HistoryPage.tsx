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
  withoutTraining,
} from '../../shared/api';
import { useAuth, useCurrentPlayer } from '../../shared/auth';
import {
  eveningsCount,
  formatDate,
  formatRub,
  formatRubSigned,
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
  Segmented,
  Tabs,
  type TabItem,
} from '../../shared/ui';
import './history.css';
import { openVotings } from './moments';
import { MomentsTab } from './MomentsTab';
import {
  eveningTotals,
  groupHistory,
  myHistoryLine,
  myHistoryResult,
  onlyMine,
  type EveningTotals,
  type MyHistoryResult,
} from './stats';

type HistoryTab = 'evenings' | 'moments';
type HistoryFilter = 'all' | 'mine';

const FILTERS = [
  { value: 'all', label: 'Все вечера' },
  { value: 'mine', label: 'Мои вечера' },
] as const;

/**
 * Вкладка и фильтр в адресе (#/history?tab=moments, ?mine=1): «Назад» с голосования или вечера
 * возвращает ту же вкладку и тот же фильтр. Переключение — replace, чтобы не копить историю.
 */
function useHistoryParams(): {
  tab: HistoryTab;
  filter: HistoryFilter;
  set: (patch: { tab?: HistoryTab; filter?: HistoryFilter }) => void;
} {
  const [params, setParams] = useSearchParams();
  const tab: HistoryTab = params.get('tab') === 'moments' ? 'moments' : 'evenings';
  const filter: HistoryFilter = params.get('mine') === '1' ? 'mine' : 'all';
  const set = (patch: { tab?: HistoryTab; filter?: HistoryFilter }) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (patch.tab) out.set('tab', patch.tab);
        if (patch.filter === 'mine') out.set('mine', '1');
        if (patch.filter === 'all') out.delete('mine');
        return out;
      },
      { replace: true },
    );
  return { tab, filter, set };
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
  // Тренировки (миграция 023) — не история клуба: их нет ни в списке, ни в сезонах.
  return <History evenings={withoutTraining(evenings.data)} history={history.data} />;
}

function History({ evenings, history }: { evenings: Evening[]; history: ClubHistory }) {
  const { isAdmin } = useAuth();
  const me = useCurrentPlayer();
  const params = useHistoryParams();
  const allLayout = useMemo(() => groupHistory(evenings), [evenings]);
  // «Мои вечера»: те, где я за столом по итогу домена (summarize) — отменённые и несведённые уходят.
  const layout = useMemo(
    () =>
      params.filter === 'mine'
        ? onlyMine(
            allLayout,
            (id) => myHistoryResult(history.summaryById.get(id), me.id)?.played === true,
          )
        : allLayout,
    [allLayout, params.filter, history.summaryById, me.id],
  );
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

  const empty = allLayout.live.length === 0 && allLayout.seasons.length === 0;

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
      <Segmented
        label="Какие вечера показать"
        options={FILTERS}
        value={params.filter}
        onChange={(filter) => params.set({ filter })}
        block
      />

      {params.filter === 'mine' && layout.seasons.length === 0 && (
        <Empty
          icon="calendar"
          title="Твоих вечеров в истории пока нет"
          description="Здесь будут вечера, где ты за столом: место и сколько они принесли или стоили."
        />
      )}

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
                  subtitle={
                    <PastSubtitle
                      details={pastDetails(e, history, names, totals.get(e.id))}
                      mine={
                        e.status === 'cancelled'
                          ? null
                          : myHistoryResult(history.summaryById.get(e.id), me.id)
                      }
                    />
                  }
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
      <Tabs
        label="Разделы истории"
        tabs={tabs}
        value={params.tab}
        onChange={(tab) => params.set({ tab })}
      />
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

/**
 * Подпись строки вечера: победитель, состав и фонд, ниже — «твоё: 2-е · +300 ₽» или «без тебя».
 * Итога нет (отменён, журнал не свёлся) — только первая строка.
 */
function PastSubtitle({ details, mine }: { details: string; mine: MyHistoryResult | null }) {
  return (
    <span className="hs-sub">
      <span>{details}</span>
      {mine && (
        <span className={mine.played ? 'hs-sub__mine' : undefined}>
          {myHistoryLine(mine, formatRubSigned)}
        </span>
      )}
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
