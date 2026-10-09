import { computeAchievements, titles } from '@domain/achievements.ts';
import { achievementProgress } from '@domain/progress.ts';
import { recordsTable, type RecordKind } from '@domain/records.ts';
import { allTimeStandings, hallOfFame, seasonStandings } from '@domain/season.ts';
import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useClubHistory, useSetMySpectator, type ClubHistory, type Player } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import {
  cn,
  countedSummary,
  eveningsCount,
  formatDate,
  formatNumber,
  formatPoints,
  formatPointsWithUnit,
  formatRubSigned,
  formatSeason,
  isVoiced,
  kosCount,
  paths,
  placeLabel,
  plural,
  requestWelcome,
  SPECTATOR_EVENING_NOTE_SELF,
  SPECTATOR_NOTE,
} from '../../shared/lib';
import {
  Amount,
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Empty,
  ErrorView,
  List,
  ListItem,
  Notice,
  Page,
  PageSkeleton,
  Section,
  Stat,
  Stats,
  Switch,
  useToast,
} from '../../shared/ui';
import { reigningChampions, standingPlaces } from '../rating/stats';
import { Achievements } from './Achievements';
import { FormStrip } from './FormStrip';
import { NetChart } from './NetChart';
import { Numbers } from './Numbers';
import './player.css';
import { progressView } from './progress';
import { RenameSheet } from './RenameSheet';
import { Rivals } from './Rivals';
import { SpokenNameSheet } from './SpokenNameSheet';
import {
  achievementsForPlayer,
  cumulativeNet,
  headToHead,
  nemesisOf,
  paidPlaces,
  playerEvenings,
  playerNumbers,
  recentForm,
  standingPosition,
} from './stats';

const BACK = { fallback: paths.rating } as const;

/** /player/:id — карточка игрока: место и деньги, график нетто, форма, ачивки, соперники, вечера. */
export default function PlayerPage() {
  const { id = '' } = useParams();
  const query = useClubHistory();

  if (query.isPending) return <PageSkeleton label="Загружаем карточку игрока" />;
  if (query.isError) {
    return (
      <Page back={BACK} documentTitle="Игрок">
        <ErrorView
          error={query.error}
          title="Карточка игрока не загрузилась"
          onRetry={() => void query.refetch()}
        />
      </Page>
    );
  }

  const player = query.data.players.find((p) => p.id === id);
  if (!player) {
    return (
      <Page back={BACK} documentTitle="Игрок не найден">
        <Empty
          kind="no-results"
          icon="user"
          title="Такого игрока в клубе нет"
          description="Ссылка устарела или игрок удалён. Найди его в рейтинге."
          action={<ButtonLink to={paths.rating}>Открыть рейтинг</ButtonLink>}
        />
      </Page>
    );
  }
  return <PlayerCard history={query.data} player={player} />;
}

function PlayerCard({ history, player }: { history: ClubHistory; player: Player }) {
  const { player: me, isAdmin } = useAuth();
  const isMe = me?.id === player.id;
  const name = isMe && me ? me.display_name : player.display_name;
  const [renaming, setRenaming] = useState(false);
  // Имя для озвучки правят сам игрок (RPC) и админ (форма админа) — миграция 016.
  const spoken = {
    id: player.id,
    display_name: name,
    spoken_name: isMe && me ? me.spoken_name : player.spoken_name,
  };
  const canVoice = isMe || isAdmin;
  const [voicing, setVoicing] = useState(false);

  const playersById = useMemo(
    () => new Map(history.players.map((p) => [p.id, p])),
    [history.players],
  );
  const evenings = useMemo(
    () => playerEvenings(history.summaries, player.id),
    [history.summaries, player.id],
  );
  const net = useMemo(() => cumulativeNet(evenings), [evenings]);

  // Место и очки текущего сезона — таблица домена, место с дележом как на экране рейтинга.
  const season = useMemo(() => {
    const rows = seasonStandings(history.summaries, {
      bestN: history.bestN,
      excluded: history.excluded,
      seasonKey: history.currentSeasonKey,
    });
    return standingPosition(rows, standingPlaces(rows), player.id);
  }, [history, player.id]);

  // Нетто за всё время — строка allTimeStandings домена (гости включены: у них тоже есть деньги).
  const allTimeNet = useMemo(
    () =>
      allTimeStandings(history.summaries, { excluded: new Set() }).find(
        (r) => r.playerId === player.id,
      )?.netRub ?? null,
    [history.summaries, player.id],
  );

  const clubTitles = useMemo(() => titles(history.achievementInput), [history]);
  const achievements = useMemo(() => computeAchievements(history.achievementInput), [history]);
  const views = useMemo(
    () =>
      achievementsForPlayer(
        achievements,
        player.id,
        (eveningId) => history.summaryById.get(eveningId)?.date,
      ),
    [achievements, player.id, history.summaryById],
  );
  const reigning = useMemo(
    () =>
      reigningChampions(
        hallOfFame(history.summaries, {
          bestN: history.bestN,
          excluded: history.excluded,
          currentSeasonKey: history.currentSeasonKey,
          bestNBySeason: history.bestNBySeason,
        }),
        history.currentSeasonKey,
      ),
    [history],
  );
  const rivals = useMemo(
    () => headToHead(history.summaries, player.id),
    [history.summaries, player.id],
  );
  const victims = useMemo(() => nemesisOf(clubTitles.nemesis, player.id), [clubTitles, player.id]);

  // Прогресс до неполученных ачивок и гонка сезона — achievementProgress домена; у гостя пусто.
  const progress = useMemo(() => {
    const nameOf = (id: string) => playersById.get(id)?.display_name ?? 'игрок не найден';
    return achievementProgress(history.achievementInput, player.id).map((p) =>
      progressView(p, { isMe, self: player.id, nameOf }),
    );
  }, [history.achievementInput, player.id, playersById, isMe]);

  // Цифры: личные рекорды, призы, среднее место. Призовые места — по формату вечера и выплатам домена.
  const numbers = useMemo(() => {
    const formats = new Map(history.evenings.map((e) => [e.id, e.format]));
    return playerNumbers(evenings, (eveningId) => {
      const format = formats.get(eveningId);
      const summary = history.summaryById.get(eveningId);
      if (!format || !summary) return undefined;
      return paidPlaces(format.payoutPct, summary.entrants.length, summary.prizePoolRub ?? 0);
    });
  }, [evenings, history.evenings, history.summaryById]);
  const clubRecords = useMemo(() => {
    const held = new Set<RecordKind>();
    for (const r of recordsTable(history.summaries, { excluded: history.excluded }))
      if (r.holders.some((h) => h.playerId === player.id)) held.add(r.kind);
    return held;
  }, [history.summaries, history.excluded, player.id]);

  const isGuest = player.is_guest;
  const isChampion = Boolean(reigning?.champions.includes(player.id));
  const badges: ReactNode[] = [];
  // Режим своей карточки — из контекста входа: он меняется здесь же, раньше, чем история клуба.
  const spectator = (isMe && me ? me.is_spectator : player.is_spectator) === true;
  if (isGuest) badges.push(<Badge key="guest">Гость</Badge>);
  if (!player.is_active) badges.push(<Badge key="off">Отключён</Badge>);
  if (spectator && !isGuest) badges.push(<Badge key="fan">Болельщик</Badge>);
  if (isChampion && reigning)
    badges.push(
      <Badge key="champion" tone="accent">
        Чемпион
      </Badge>,
    );
  if (clubTitles.form === player.id) badges.push(<Badge key="form">Форма</Badge>);

  const last = evenings.at(-1);

  return (
    <Page back={BACK} documentTitle={name}>
      <header className="pl-head">
        <Avatar name={name} photoUrl={player.photo_url} size="xl" />
        <div className="pl-head__text">
          <h1 className="m-h1 ui-name pl-head__name">{name}</h1>
          {badges.length > 0 && <div className="pl-head__badges">{badges.slice(0, 2)}</div>}
          {canVoice && (
            <div className="pl-head__actions">
              {isMe && (
                <Button size="sm" variant="ghost" icon="pencil" onClick={() => setRenaming(true)}>
                  Сменить имя
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="volume-2" onClick={() => setVoicing(true)}>
                Имя на табло
              </Button>
              {/* Шторка «Добро пожаловать» ещё раз: держит её раскладка (WelcomeHost). */}
              {isMe && (
                <Button size="sm" variant="ghost" icon="info" onClick={requestWelcome}>
                  Как всё устроено
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {isMe && !isVoiced(spoken) && (
        <Notice
          title="Табло не назовёт тебя по имени"
          action={
            <Button size="sm" onClick={() => setVoicing(true)}>
              Задать имя
            </Button>
          }
        >
          Голос читает только кириллицу. Напиши, как произносить твоё имя, — и табло назовёт тебя
          при нокауте и победе.
        </Notice>
      )}

      {isMe && !isGuest && <SpectatorSwitch spectator={spectator} />}

      {isGuest && (
        <Notice title="Гость не входит в рейтинг">
          Его вечера видны в истории, но очки сезона, ачивки, звания и рекорды игроков гостям не
          начисляются.
        </Notice>
      )}

      {evenings.length === 0 ? (
        <Empty
          icon="calendar"
          title="Сыгранных вечеров пока нет"
          description="Место, деньги, график и ачивки появятся после первого завершённого вечера с участием игрока."
        />
      ) : (
        <>
          <Stats>
            {season && (
              <Stat
                label="Место в сезоне"
                value={String(season.place)}
                unit={`из ${season.of}`}
                note={formatSeason(history.currentSeasonKey)}
              />
            )}
            {season && (
              <Stat
                label="Очки сезона"
                value={formatPoints(season.row.total)}
                note={countedSummary(season.row.counted.length, season.row.played)}
              />
            )}
            {allTimeNet !== null && (
              <Stat
                className="pl-stat--wide"
                label="Нетто за всё время"
                value={
                  <span
                    className={cn(
                      allTimeNet > 0 && 'pl-net--plus',
                      allTimeNet < 0 && 'pl-net--minus',
                    )}
                  >
                    {allTimeNet > 0 ? '+' : ''}
                    {formatNumber(allTimeNet)}
                  </span>
                }
                unit="₽"
                delta={
                  last && Math.round(last.netRub) !== 0 ? formatRubSigned(last.netRub) : undefined
                }
                deltaNote="за последний вечер"
                good="up"
              />
            )}
            {!season && (
              <Stat
                label="Вечеров сыграно"
                value={String(evenings.length)}
                note={
                  isGuest
                    ? `В сезоне «${formatSeason(history.currentSeasonKey)}» — ${evenings.filter((e) => e.seasonKey === history.currentSeasonKey).length}; гости в рейтинг не входят`
                    : `В сезоне «${formatSeason(history.currentSeasonKey)}» вечеров нет`
                }
              />
            )}
          </Stats>

          <Section
            title="Накопленный нетто"
            aside={<Amount value={net.at(-1)?.cumulativeRub ?? 0} />}
          >
            <NetChart points={net} />
          </Section>

          <FormStrip evenings={recentForm(evenings, 5)} />

          <Numbers numbers={numbers} clubRecords={clubRecords} />

          {!isGuest && (
            <Achievements views={views} progress={progress} seasonKey={history.currentSeasonKey} />
          )}

          {rivals.length > 0 && (
            <Rivals
              playersById={playersById}
              rows={rivals}
              nemesis={isGuest ? null : (clubTitles.nemesis[player.id] ?? null)}
              victims={isGuest ? [] : victims}
              isMe={isMe}
            />
          )}

          <Section title="Вечера" aside={eveningsCount(evenings.length)}>
            <List aria-label="Вечера игрока, новые сверху">
              {[...evenings].reverse().map((e) => (
                <ListItem
                  key={e.eveningId}
                  to={paths.evening(e.eveningId)}
                  title={formatDate(e.date)}
                  subtitle={[
                    placeLabel(e.place, e.entrants),
                    formatPointsWithUnit(e.points),
                    e.kos > 0 ? kosCount(e.kos) : null,
                    e.rebuys > 0
                      ? `${e.rebuys} ${plural(e.rebuys, ['ребай', 'ребая', 'ребаев'])}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  after={<Amount value={e.netRub} />}
                />
              ))}
            </List>
          </Section>
        </>
      )}

      {isMe && renaming && (
        <RenameSheet open currentName={name} onClose={() => setRenaming(false)} />
      )}
      {canVoice && voicing && (
        <SpokenNameSheet
          player={spoken}
          mode={isMe ? 'self' : 'admin'}
          onClose={() => setVoicing(false)}
        />
      )}
    </Page>
  );
}

/**
 * Свой режим «болельщик» (миграция 024): переключатель сохраняется сразу (set_my_spectator). Админ
 * меняет чужой режим во вкладке «Игроки».
 */
function SpectatorSwitch({ spectator }: { spectator: boolean }) {
  const save = useSetMySpectator();
  const toast = useToast();
  const shown = save.isPending && save.variables !== undefined ? save.variables : spectator;
  return (
    <Section title="Участие в играх">
      <Switch
        label="Слежу, не играю"
        description={`${SPECTATOR_NOTE} ${SPECTATOR_EVENING_NOTE_SELF}`}
        checked={shown}
        disabled={save.isPending}
        onChange={(value) =>
          save.mutate(value, {
            onSuccess: (saved) =>
              toast.success(saved ? 'Ты болельщик клуба' : 'Ты в составе игроков'),
          })
        }
      />
    </Section>
  );
}
