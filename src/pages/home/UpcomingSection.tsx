// Ближайший вечер на главной: анонс (ответ, состав, прогноз), идущая игра или день следующей игры
// по расписанию клуба.
import { scorePrediction } from '@domain/predictions.ts';
import { replay } from '@domain/replay.ts';
import type { EveningEvent } from '@domain/types.ts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  errorMessage,
  queryKeys,
  RSVP_CHOICES,
  RSVP_STATUS_META,
  useEveningEvents,
  usePredictions,
  useRsvps,
  useSetRsvp,
  type Evening,
  type Player,
  type Rsvp,
  type RsvpStatus,
  type Settings,
} from '../../shared/api';
import {
  capitalize,
  formatBlinds,
  formatClock,
  formatDateTime,
  formatRub,
  formatTime,
  formatWeekdayDate,
  keepNumbersTogether,
  nextGameAt,
  paths,
  plural,
  pluralWithNumber,
  useNow,
} from '../../shared/lib';
import {
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  ButtonLink,
  Card,
  Empty,
  FieldGroup,
  Icon,
  List,
  ListItem,
  Notice,
  Section,
  Segmented,
  Skeleton,
  useToast,
  type IconName,
  type SegmentedOption,
} from '../../shared/ui';
import {
  groupRsvps,
  nameWithMe,
  playerName,
  type RsvpGroups,
  STALE_ANNOUNCE_MS,
  UNKNOWN_PLAYER,
  upsertRsvp,
} from './lib';
// Блок прогноза — тот же, что на экране вечера (туда ведут кнопки анонса).
import { PredictionSection } from '../evening/PredictionSection';

type PlayersById = ReadonlyMap<string, Player>;

/** «Четверг, 8 октября, 19:00» по Москве. */
function whenTitle(iso: string): string {
  return keepNumbersTogether(`${capitalize(formatWeekdayDate(iso))}, ${formatTime(iso)}`);
}

/** Строка факта с иконкой: место, взнос, банкир. */
function Fact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li>
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </li>
  );
}

function feeText(format: Evening['format']): string {
  const fee = formatRub(format.buyInRub);
  return format.rebuyLimit === 0 ? `Вход — ${fee}` : `Вход и ребай — ${fee}`;
}

// --- Анонс -----------------------------------------------------------------------------------

// Порядок вариантов — общий с экраном вечера (RSVP_CHOICES), чтобы палец не промахивался.
const RSVP_OPTIONS: readonly SegmentedOption<RsvpStatus | ''>[] = RSVP_CHOICES.map((status) => ({
  value: status,
  label: RSVP_STATUS_META[status].title,
}));

export interface AnnouncedEveningProps {
  evening: Evening;
  me: Player;
  isAdmin: boolean;
  players: readonly Player[];
  playersById: PlayersById;
  nowMs: number;
}

export function AnnouncedEvening({
  evening,
  me,
  isAdmin,
  players,
  playersById,
  nowMs,
}: AnnouncedEveningProps) {
  // Подписка на журнал и строку вечера: старт таймера переводит вечер в live у всех сразу.
  useEveningEvents(evening.id);
  const rsvps = useRsvps(evening.id);
  const setRsvp = useSetRsvp(evening.id);
  const queryClient = useQueryClient();
  const toast = useToast();

  const rows = useMemo(() => rsvps.data ?? [], [rsvps.data]);
  const groups = useMemo(() => groupRsvps(players, rows), [players, rows]);
  const myRsvp = rows.find((r) => r.player_id === me.id)?.status ?? null;
  const stale = Date.parse(evening.scheduled_at) < nowMs - STALE_ANNOUNCE_MS;
  const banker = playerName(playersById, evening.banker_id);
  // Пульт «Отметить пришедших / Начать вечер» живёт на экране вечера — банкиру (не админу) туда
  // больше не попасть из приложения: анонсов нет ни в истории, ни во вкладках.
  const canControl = isAdmin || evening.banker_id === me.id;

  const answer = (status: RsvpStatus) => {
    const key = queryKeys.rsvps(evening.id);
    const previous = queryClient.getQueryData<Rsvp[]>(key);
    void queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<Rsvp[]>(key, (old) =>
      upsertRsvp(old ?? [], {
        evening_id: evening.id,
        player_id: me.id,
        status,
        updated_at: new Date().toISOString(),
      }),
    );
    setRsvp.mutate(status, {
      onError: (error) => {
        queryClient.setQueryData(key, previous);
        toast.show('Ответ не сохранён', { tone: 'critical', detail: errorMessage(error) });
      },
    });
  };

  return (
    <>
      <Section title="Ближайший вечер">
        {stale && (
          <Notice
            tone="caution"
            title="Анонс устарел"
            action={
              isAdmin ? (
                <ButtonLink size="sm" to={paths.adminEvening(evening.id)}>
                  Открыть
                </ButtonLink>
              ) : undefined
            }
          >
            {`Игра была назначена на ${formatDateTime(evening.scheduled_at, nowMs)}. `}
            {isAdmin ? 'Отмени вечер или запусти таймер.' : 'Вечер должен отменить админ.'}
          </Notice>
        )}
        <Card>
          <p className="m-eyebrow">Анонс</p>
          <h3 className="m-h3">{whenTitle(evening.scheduled_at)}</h3>
          <ul className="home-facts">
            {evening.location && <Fact icon="map-pin">{evening.location}</Fact>}
            <Fact icon="coins">{feeText(evening.format)}</Fact>
            <Fact icon="user">{banker ? `Банкир — ${banker}` : 'Банкир ещё не назначен'}</Fact>
            {evening.note && <Fact icon="info">{evening.note}</Fact>}
          </ul>
          <hr className="home-rule" />
          {rsvps.isPending ? (
            <div className="home-going" aria-busy="true" aria-label="Загрузка состава">
              <div className="home-going__head">
                <Skeleton circle width={32} height={32} />
                <Skeleton width="40%" height={14} />
              </div>
              <Skeleton width="80%" height={12} />
            </div>
          ) : rsvps.isError ? (
            <Notice
              tone="critical"
              title="Состав не загрузился"
              action={
                <Button size="sm" onClick={() => void rsvps.refetch()}>
                  Повторить
                </Button>
              }
            >
              {errorMessage(rsvps.error)}
            </Notice>
          ) : (
            <Going groups={groups} meId={me.id} />
          )}
        </Card>
        {canControl ? (
          <ButtonLink variant="primary" block icon="user-plus" to={paths.evening(evening.id)}>
            Собрать стол и начать
          </ButtonLink>
        ) : (
          <ButtonLink variant="ghost" block icon="chevron-right" to={paths.evening(evening.id)}>
            Открыть вечер
          </ButtonLink>
        )}
        <FieldGroup
          label="Твой ответ"
          hint={myRsvp ? undefined : 'Ответ нужен банкиру, чтобы собрать список игроков.'}
        >
          <Segmented
            block
            className="home-rsvp"
            label="Твой ответ на анонс"
            value={myRsvp ?? ''}
            options={RSVP_OPTIONS}
            onChange={(value) => value && answer(value)}
          />
        </FieldGroup>
      </Section>
      <PredictionSection
        evening={evening}
        me={me}
        players={players}
        playersById={playersById}
        rsvps={rows}
      />
    </>
  );
}

function Going({ groups, meId }: { groups: RsvpGroups<Player>; meId: string }) {
  const names = (list: readonly Player[]) =>
    list.map((p) => (p.id === meId ? `${p.display_name} (ты)` : p.display_name)).join(', ');
  const going = groups.yes;
  const rest = [
    groups.maybe.length > 0 && `Под вопросом: ${names(groups.maybe)}`,
    groups.no.length > 0 && `Не идут: ${names(groups.no)}`,
    groups.silent.length > 0 && `Без ответа: ${names(groups.silent)}`,
  ].filter(Boolean);

  return (
    <div className="home-going">
      <div className="home-going__head">
        {going.length > 0 && (
          <AvatarGroup
            people={going.map((p) => ({ name: p.display_name, photoUrl: p.photo_url }))}
            max={4}
            label={`Идут: ${going.length}`}
          />
        )}
        <p className="home-going__count">
          {going.length > 0
            ? `${plural(going.length, ['Идёт', 'Идут', 'Идут'])} ${pluralWithNumber(going.length, ['игрок', 'игрока', 'игроков'])}`
            : 'Отметившихся «иду» ещё нет'}
        </p>
      </div>
      {going.length > 0 && <p className="m-small">{names(going)}</p>}
      {rest.map((line) => (
        <p key={String(line)} className="m-small">
          {line}
        </p>
      ))}
    </div>
  );
}

// --- Идёт игра -------------------------------------------------------------------------------

export interface LiveEveningProps {
  evening: Evening;
  me: Player;
  playersById: PlayersById;
}

export function LiveEvening({ evening, me, playersById }: LiveEveningProps) {
  const events = useEveningEvents(evening.id);
  const queryClient = useQueryClient();

  // До старта RLS отдавал только мой прогноз; после старта открыты все — перечитываем кеш анонса.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.predictions(evening.id) });
  }, [queryClient, evening.id]);

  return (
    <>
      <Section title="Сейчас">
        {events.isPending ? (
          <Card>
            <div aria-busy="true" aria-label="Загрузка вечера" className="home-skeleton">
              <Skeleton width="40%" height={12} />
              <Skeleton width="70%" height={28} />
              <Skeleton width="55%" height={40} />
            </div>
          </Card>
        ) : events.isError ? (
          <Notice
            tone="critical"
            title="Идёт игра, но журнал вечера не загрузился"
            action={
              <Button size="sm" onClick={() => void events.refetch()}>
                Повторить
              </Button>
            }
          >
            {errorMessage(events.error)}
          </Notice>
        ) : (
          <LiveCard evening={evening} events={events.data ?? []} />
        )}
      </Section>
      <LivePredictions
        evening={evening}
        events={events.data ?? null}
        me={me}
        playersById={playersById}
      />
    </>
  );
}

function LiveCard({ evening, events }: { evening: Evening; events: readonly EveningEvent[] }) {
  // Таймер считается на клиенте от событий журнала — раз в секунду, синхронно с табло.
  const now = useNow(1000);
  const state = useMemo(() => replay(evening.format, events, now), [evening.format, events, now]);
  const { timer, currentLevel, nextLevel } = state;
  const level = timer.levelIndex + 1;
  const trigger = currentLevel.trigger;

  let clock: ReactNode = null;
  if (timer.status === 'not_started') {
    clock = <p className="m-small">Таймер ещё не запущен</p>;
  } else if (!nextLevel) {
    clock = <p className="m-small">Последний уровень — блайнды больше не растут</p>;
  } else if (trigger.type === 'time' && timer.levelRemainingMs !== null) {
    clock = (
      <p className="home-clock">
        <span className="m-figure m-mono">{formatClock(timer.levelRemainingMs)}</span>
        <span className="m-small">до уровня {level + 1}</span>
      </p>
    );
  } else if (trigger.type === 'eliminations') {
    const left = Math.max(0, trigger.count - timer.bustsInLevel);
    clock = (
      <p className="m-small">
        До уровня {level + 1}: {pluralWithNumber(left, ['вылет', 'вылета', 'вылетов'])}
      </p>
    );
  } else if (trigger.type === 'hands') {
    const left = Math.max(0, trigger.count - timer.handsInLevel);
    clock = (
      <p className="m-small">
        До уровня {level + 1}: {pluralWithNumber(left, ['раздача', 'раздачи', 'раздач'])}
      </p>
    );
  }

  return (
    <Card to={paths.evening(evening.id)} variant="raised">
      <div className="home-live__head">
        <p className="m-eyebrow">{capitalize(formatWeekdayDate(evening.scheduled_at))}</p>
        {timer.status === 'paused' && <Badge tone="caution">Пауза</Badge>}
      </div>
      <h3 className="m-h2">{`Идёт игра\u00a0· уровень ${level}`}</h3>
      {clock}
      <ul className="home-facts">
        <Fact icon="layers">
          Блайнды {formatBlinds(currentLevel)}
          {nextLevel ? `, дальше ${formatBlinds(nextLevel)}` : ''}
        </Fact>
        <Fact icon="users">
          В игре {state.aliveCount} из {state.joinOrder.length} · фонд{' '}
          {formatRub(state.prizePoolRub)}
        </Fact>
        <Fact icon="rotate-ccw">
          {state.rebuysOpen
            ? `Ребаи открыты до конца ${evening.format.rebuyUntilLevel}-го уровня`
            : 'Ребаи закрыты'}
        </Fact>
      </ul>
      <span className="home-card-link">
        Открыть вечер
        <Icon name="chevron-right" size={16} />
      </span>
    </Card>
  );
}

function LivePredictions({
  evening,
  events,
  me,
  playersById,
}: {
  evening: Evening;
  events: readonly EveningEvent[] | null;
  me: Player;
  playersById: PlayersById;
}) {
  const predictions = usePredictions(evening.id);

  // Победитель и первый вылет от времени не зависят — берём момент последнего события.
  const outcome = useMemo(() => {
    if (!events) return null;
    const lastMs = events.reduce((m, e) => Math.max(m, Date.parse(e.at) || 0), 0);
    return replay(evening.format, events, lastMs);
  }, [evening.format, events]);

  const rows = useMemo(
    () =>
      [...(predictions.data ?? [])]
        .filter((p) => p.winner_id !== null || p.first_out_id !== null)
        .sort(
          (a, b) =>
            Number(b.player_id === me.id) - Number(a.player_id === me.id) ||
            (playerName(playersById, a.player_id) ?? '').localeCompare(
              playerName(playersById, b.player_id) ?? '',
              'ru',
            ),
        ),
    [predictions.data, me.id, playersById],
  );

  return (
    <Section
      title="Прогнозы"
      aside="приём закрыт"
      footer={
        outcome && !outcome.finished && rows.length > 0
          ? 'Очки за победителя станут известны после финала.'
          : undefined
      }
    >
      {predictions.isPending ? (
        <Skeleton height={64} />
      ) : predictions.isError ? (
        <Notice
          tone="critical"
          title="Прогнозы не загрузились"
          action={
            <Button size="sm" onClick={() => void predictions.refetch()}>
              Повторить
            </Button>
          }
        >
          {errorMessage(predictions.error)}
        </Notice>
      ) : rows.length === 0 ? (
        <p className="m-small">На этот вечер прогнозов не было.</p>
      ) : (
        <List aria-label="Прогнозы на вечер">
          {rows.map((p) => {
            const player = playersById.get(p.player_id);
            const score = outcome
              ? scorePrediction({ winnerId: p.winner_id, firstOutId: p.first_out_id }, outcome)
              : null;
            return (
              <ListItem
                key={p.player_id}
                before={
                  <Avatar
                    name={player?.display_name ?? UNKNOWN_PLAYER}
                    photoUrl={player?.photo_url}
                    size="md"
                  />
                }
                title={nameWithMe(playersById, p.player_id, me.id)}
                subtitle={`Победитель — ${playerName(playersById, p.winner_id) ?? 'не выбран'} · первый вылет — ${playerName(playersById, p.first_out_id) ?? 'не выбран'}`}
                after={
                  score && score.total > 0 ? (
                    <Badge tone="positive">
                      +{score.total} {plural(score.total, ['очко', 'очка', 'очков'])}
                    </Badge>
                  ) : undefined
                }
              />
            );
          })}
        </List>
      )}
    </Section>
  );
}

// --- Вечера нет ------------------------------------------------------------------------------

export interface NextGameProps {
  settings: Settings | null;
  isAdmin: boolean;
  nowMs: number;
}

export function NextGame({ settings, isAdmin, nowMs }: NextGameProps) {
  const at = settings ? nextGameAt(nowMs, settings.game_weekday, settings.game_time) : null;
  const hours = settings?.announce_hours_before ?? 48;

  const description = at
    ? `Анонс появится за ${pluralWithNumber(hours, ['час', 'часа', 'часов'])} до игры.`
    : isAdmin
      ? 'Укажи день и время игры в настройках клуба или создай вечер вручную.'
      : 'Ближайший вечер назначит админ.';

  return (
    <Section title="Ближайший вечер">
      <Empty
        icon="calendar"
        title={
          at
            ? keepNumbersTogether(`Следующая игра — ${formatWeekdayDate(at)}, ${formatTime(at)}`)
            : 'Расписание игр не задано'
        }
        description={description}
        action={
          isAdmin ? (
            <ButtonLink variant="primary" icon="plus" to={paths.adminEveningNew}>
              Создать вечер
            </ButtonLink>
          ) : undefined
        }
      />
    </Section>
  );
}
