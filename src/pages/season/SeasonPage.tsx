// /season/:key — «Итоги сезона»: чемпион и подиум, «Твой сезон», лауреаты (Оракул, деньги, охотник,
// сезонные ачивки), рекорды, установленные в сезоне, и итоговые таблицы — очки, деньги, прогнозы. Всё
// считает домен (seasonRecap) по истории клуба; правила очков те же, что во вкладке «Сезон».
// Сюда ведут кнопка поста «Итоги сезона» (s_<сезон>), «Рейтинг → Сезон» и зал славы закрытого сезона,
// карточка «Итоги сезона» на главной.
import { tiedPlaces } from '@domain/placeMoves.ts';
import { RECORD_META } from '@domain/records.ts';
import { playerSeason, seasonRecap, type SeasonRecap } from '@domain/seasonRecap.ts';
import type { PlayerId } from '@domain/types.ts';
import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useClubHistory, type ClubHistory, type Player } from '../../shared/api';
import { useCurrentPlayer } from '../../shared/auth';
import {
  formatDate,
  formatPoints,
  formatSeason,
  formatSeasonGenitive,
  joinNames,
  mySeasonStats,
  paths,
  pointsWord,
  podiumView,
  recordValueText,
  SEASON_KEY_RE,
  seasonAchievementsLine,
  seasonLaureates,
  seasonMetaLine,
  seasonMonths,
  seasonResultsDate,
  standingMeta,
  type SeasonLaureate,
} from '../../shared/lib';
import {
  Amount,
  Avatar,
  ButtonLink,
  Card,
  Empty,
  ErrorView,
  Icon,
  List,
  ListItem,
  Page,
  PageSkeleton,
  SeasonPodium,
  Section,
  Stat,
  Stats,
  type IconName,
} from '../../shared/ui';
import './season.css';

const LAUREATE_ICON: Record<SeasonLaureate['id'], IconName> = {
  oracle: 'eye',
  money: 'coins',
  hunter: 'crosshair',
  rebuy_king: 'rotate-ccw',
  iron_chair: 'calendar',
};

export default function SeasonPage() {
  const { key = '' } = useParams();
  const history = useClubHistory();

  if (!SEASON_KEY_RE.test(key)) {
    return (
      <Page title="Итоги сезона" back>
        <Empty
          kind="no-results"
          title="Такого сезона нет"
          description="Ссылка на итоги сезона устарела или набрана с ошибкой."
          action={
            <ButtonLink to={paths.ratingFame} icon="trophy">
              Открыть зал славы
            </ButtonLink>
          }
        />
      </Page>
    );
  }
  if (history.isPending) return <PageSkeleton label="Загружаем итоги сезона" />;
  if (history.isError) {
    return (
      <Page title="Итоги сезона" back>
        <ErrorView
          error={history.error}
          title="Итоги сезона не загрузились"
          onRetry={() => void history.refetch()}
        />
      </Page>
    );
  }
  return <SeasonResults history={history.data} seasonKey={key} />;
}

function SeasonResults({ history, seasonKey }: { history: ClubHistory; seasonKey: string }) {
  const me = useCurrentPlayer();
  const recap = useMemo(
    () => seasonRecap(history.achievementInput, seasonKey),
    [history.achievementInput, seasonKey],
  );
  const playersById = useMemo(
    () => new Map(history.players.map((p) => [p.id, p])),
    [history.players],
  );
  const subtitle = `${formatSeason(seasonKey)} · ${seasonMonths(seasonKey)}`;
  const tableLink = `${paths.rating}?tab=season&season=${seasonKey}`;

  if (!recap.closed) {
    return (
      <Page title="Итоги сезона" subtitle={subtitle} back>
        <Empty
          icon="calendar"
          title={
            seasonKey === history.currentSeasonKey ? 'Сезон ещё идёт' : 'Этот сезон ещё не начался'
          }
          description={`Итоги ${formatSeasonGenitive(seasonKey)} подведём ${seasonResultsDate(seasonKey)}: подиум, деньги, «Оракул сезона» и рекорды.`}
          action={
            seasonKey === history.currentSeasonKey ? (
              <ButtonLink to={tableLink} icon="trophy">
                Открыть таблицу сезона
              </ButtonLink>
            ) : undefined
          }
        />
      </Page>
    );
  }
  if (recap.eveningIds.length === 0) {
    return (
      <Page title="Итоги сезона" subtitle={subtitle} back>
        <Empty
          icon="calendar"
          title="В этом сезоне вечеров не было"
          description="Итоги появляются у сезонов, где был хотя бы один завершённый вечер."
          action={
            <ButtonLink to={paths.ratingFame} icon="trophy">
              Открыть зал славы
            </ButtonLink>
          }
        />
      </Page>
    );
  }

  const name = (id: PlayerId) => playersById.get(id)?.display_name ?? 'Игрок не найден';
  const mine = playerSeason(recap, me.id);

  return (
    <Page title="Итоги сезона" subtitle={`${subtitle} · ${seasonMetaLine(recap)}`} back>
      <Champion recap={recap} playersById={playersById} meId={me.id} />
      {mine && (
        <Section title="Твой сезон">
          <Card>
            <Stats className="ss-stats">
              {mySeasonStats(mine).map((s) => (
                <Stat key={s.label} label={s.label} value={s.value} unit={s.unit} note={s.note} />
              ))}
            </Stats>
            {mine.achievements.length > 0 && (
              <p className="m-small ss-mine__ach">
                Ачивки сезона: {seasonAchievementsLine(mine.achievements)}
              </p>
            )}
            {/* Без игр «Оракул» уже среди показателей (mySeasonStats). */}
            {mine.oracle && mine.place !== null && (
              <p className="m-small">
                «Оракул сезона» — {mine.oracle.place}-е место, {formatPoints(mine.oracle.total)}{' '}
                {pointsWord(mine.oracle.total)}
              </p>
            )}
          </Card>
        </Section>
      )}
      <Laureates recap={recap} name={name} />
      <Records recap={recap} name={name} />
      <Standings recap={recap} playersById={playersById} meId={me.id} tableLink={tableLink} />
      <Money recap={recap} playersById={playersById} meId={me.id} />
      <Oracle recap={recap} playersById={playersById} meId={me.id} />
    </Page>
  );
}

type PlayersById = ReadonlyMap<string, Player>;

/** Чемпион крупно и подиум. */
function Champion({
  recap,
  playersById,
  meId,
}: {
  recap: SeasonRecap;
  playersById: PlayersById;
  meId: string;
}) {
  const steps = podiumView(recap).map((step) => ({
    place: step.place,
    value: step.value,
    people: step.playerIds.map((id) => ({
      id,
      name: playersById.get(id)?.display_name ?? 'Игрок не найден',
      photoUrl: playersById.get(id)?.photo_url,
      to: paths.player(id),
      me: id === meId,
    })),
  }));
  const champions = recap.champions.map((id) => playersById.get(id)?.display_name ?? 'Игрок');
  return (
    <Card variant="raised" className="ss-champion">
      <p className="m-eyebrow ss-champion__eyebrow">
        <Icon name="trophy" size={16} />
        {champions.length > 1 ? 'Чемпионы сезона' : 'Чемпион сезона'}
      </p>
      <p className="m-h2 ui-name ss-champion__name">
        {champions.length > 0 ? joinNames(champions) : 'Без чемпиона'}
      </p>
      {steps.length > 0 ? (
        <SeasonPodium steps={steps} label={`Подиум сезона «${formatSeason(recap.seasonKey)}»`} />
      ) : (
        <p className="m-small">Очков в сезоне никто не набрал — подиума нет.</p>
      )}
    </Card>
  );
}

function Laureates({ recap, name }: { recap: SeasonRecap; name: (id: PlayerId) => string }) {
  const list = seasonLaureates(recap);
  if (list.length === 0) return null;
  return (
    <Section title="Лауреаты сезона">
      <List aria-label="Лауреаты сезона">
        {list.map((l) => (
          <ListItem
            key={l.id}
            before={<Icon name={LAUREATE_ICON[l.id]} size={20} className="ss-icon" />}
            title={l.title}
            subtitle={`${joinNames(l.playerIds.map(name))} · ${l.value}`}
            to={l.playerIds.length === 1 ? paths.player(l.playerIds[0] ?? '') : undefined}
          />
        ))}
      </List>
    </Section>
  );
}

function Records({ recap, name }: { recap: SeasonRecap; name: (id: PlayerId) => string }) {
  if (recap.records.length === 0) return null;
  return (
    <Section
      title="Рекорды сезона"
      footer="Рекорды клуба, которые этот сезон поднял выше, чем было до него."
    >
      <List aria-label="Рекорды клуба, установленные в сезоне">
        {recap.records.map((r) => {
          const first = r.holders[0];
          const players = [
            ...new Set(r.holders.map((h) => h.playerId).filter((id) => id !== null)),
          ];
          const who = players.length > 0 ? `${joinNames(players.map(name))} · ` : '';
          const when = first ? formatDate(first.date) : '';
          const was =
            r.previous !== null ? ` · прежний — ${recordValueText(r.kind, r.previous)}` : '';
          return (
            <ListItem
              key={r.kind}
              before={<Icon name="trending-up" size={20} className="ss-icon" />}
              title={RECORD_META[r.kind].title}
              subtitle={
                <>
                  <span className="ss-record__value">{recordValueText(r.kind, r.value)}</span>
                  {` · ${who}${when}${was}`}
                </>
              }
              to={first ? paths.evening(first.eveningId) : undefined}
            />
          );
        })}
      </List>
    </Section>
  );
}

function PlaceAvatar({ place, player }: { place: number; player: Player | undefined }) {
  return (
    <span className="ss-rank">
      <span className="ss-place m-mono">
        <span className="sr-only">Место </span>
        {place}
      </span>
      <Avatar name={player?.display_name ?? '?'} photoUrl={player?.photo_url} size="md" />
    </span>
  );
}

/** Очки справа в строке: число табличными цифрами и слово под ним — как в рейтинге. */
function Score({ value }: { value: number }) {
  return (
    <span className="ss-score">
      <span className="ss-score__num m-mono">{formatPoints(value)}</span>
      <span className="ss-score__unit">{pointsWord(value)}</span>
    </span>
  );
}

/** Имя в строке таблицы; своя строка — с меткой «[ ТЫ ]» (ui-me-tag). */
const withMe = (player: Player | undefined, id: string, meId: string): ReactNode => (
  <>
    {player?.display_name ?? 'Игрок не найден'}
    {id === meId && (
      <>
        {' '}
        <span className="ui-me-tag">ты</span>
      </>
    )}
  </>
);

function Standings({
  recap,
  playersById,
  meId,
  tableLink,
}: {
  recap: SeasonRecap;
  playersById: PlayersById;
  meId: string;
  tableLink: string;
}) {
  return (
    <Section
      title="Таблица сезона"
      aside={recap.eveningIds.length > recap.bestN ? `в зачёт — лучшие ${recap.bestN}` : undefined}
      footer="При равенстве очков выше тот, у кого больше побед, потом — нокаутов."
    >
      <List aria-label={`Итоговая таблица сезона «${formatSeason(recap.seasonKey)}»`}>
        {recap.standings.map((row, i) => (
          <ListItem
            key={row.playerId}
            before={
              <PlaceAvatar
                place={recap.places[i] ?? i + 1}
                player={playersById.get(row.playerId)}
              />
            }
            title={withMe(playersById.get(row.playerId), row.playerId, meId)}
            subtitle={standingMeta(row)}
            after={<Score value={row.total} />}
            to={paths.player(row.playerId)}
          />
        ))}
      </List>
      <ButtonLink to={tableLink} variant="ghost" size="sm" iconAfter="arrow-right">
        Вечера в зачёте — в рейтинге
      </ButtonLink>
    </Section>
  );
}

function Money({
  recap,
  playersById,
  meId,
}: {
  recap: SeasonRecap;
  playersById: PlayersById;
  meId: string;
}) {
  if (recap.money.length === 0) return null;
  const places = tiedPlaces(recap.money, (a, b) => a.netRub === b.netRub);
  return (
    <Section title="Деньги сезона" footer="Нетто — призовые минус входы и ребаи. Гости не входят.">
      <List aria-label="Денежный зачёт сезона">
        {recap.money.map((row, i) => (
          <ListItem
            key={row.playerId}
            before={
              <PlaceAvatar place={places[i] ?? i + 1} player={playersById.get(row.playerId)} />
            }
            title={withMe(playersById.get(row.playerId), row.playerId, meId)}
            after={<Amount value={row.netRub} icon />}
            to={paths.player(row.playerId)}
          />
        ))}
      </List>
    </Section>
  );
}

function Oracle({
  recap,
  playersById,
  meId,
}: {
  recap: SeasonRecap;
  playersById: PlayersById;
  meId: string;
}) {
  if (recap.oracle.length === 0) return null;
  const places = tiedPlaces(
    recap.oracle,
    (a, b) => a.total === b.total && a.winnerHits === b.winnerHits,
  );
  return (
    <Section
      title="«Оракул сезона»"
      footer="Очки прогнозов: угаданный победитель — 3, первый вылет — 2. В сезон не идут."
    >
      <List aria-label="«Оракул сезона»">
        {recap.oracle.map((row, i) => (
          <ListItem
            key={row.playerId}
            before={
              <PlaceAvatar place={places[i] ?? i + 1} player={playersById.get(row.playerId)} />
            }
            title={withMe(playersById.get(row.playerId), row.playerId, meId)}
            subtitle={`угадано победителей: ${row.winnerHits}, первых вылетов: ${row.firstOutHits}`}
            after={<Score value={row.total} />}
            to={paths.player(row.playerId)}
          />
        ))}
      </List>
    </Section>
  );
}
