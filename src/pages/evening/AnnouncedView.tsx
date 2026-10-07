// Вечер в анонсе: формат, кто идёт, свой ответ; у банкира и админа — сбор стола и старт.
import { useState } from 'react';
import {
  type Rsvp,
  RSVP_CHOICES,
  RSVP_ORDER,
  RSVP_STATUS_META,
  type RsvpStatus,
  useRsvps,
  useSetRsvp,
} from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { pluralWithNumber } from '../../shared/lib';
import {
  Avatar,
  Badge,
  Button,
  Empty,
  List,
  ListItem,
  Notice,
  Section,
  Segmented,
  type SegmentedOption,
  Skeleton,
  type Tone,
} from '../../shared/ui';
import { eventPlayerId, rsvpSegmentValue } from './lib';
import { FormatSummary, PlayersList } from './parts';
import { PayoutSheet } from './PayoutSheet';
import { SeatSheet } from './SeatSheet';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

const RSVP_TONE: Record<RsvpStatus, Tone> = { yes: 'positive', maybe: 'caution', no: 'neutral' };

export interface AnnouncedViewProps {
  model: EveningModel;
  actions: EveningActions;
}

export function AnnouncedView({ model, actions }: AnnouncedViewProps) {
  const { evening, state, nameOf, playersById, canControl } = model;
  const rsvpsQuery = useRsvps(evening.id);
  const rsvps = rsvpsQuery.data ?? [];
  const [seatOpen, setSeatOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const goingCount = rsvps.filter((r) => r.status === 'yes').length;

  const seated = state.joinOrder.length;
  const startProblem =
    seated < 2 ? 'Нужно хотя бы два игрока за столом.' : actions.check('timer_start');

  const start = async () => {
    const ok = await actions.confirm({
      title: 'Начать вечер?',
      message: `За столом ${pluralWithNumber(seated, ['игрок', 'игрока', 'игроков'])}. Запустится таймер первого уровня, ответы на анонс и прогнозы закроются. Опоздавших можно посадить, пока открыта регистрация.`,
      confirmText: 'Начать вечер',
      cancelText: 'Подождать',
    });
    if (!ok) return;
    setStarting(true);
    await actions.send('timer_start', {}, { success: 'Вечер начался' });
    setStarting(false);
  };

  // Отменить посадку за стол до старта — через ту же отмену записи журнала.
  const unseat = (playerId: string) => {
    const join = [...model.events]
      .reverse()
      .find((e) => e.type === 'join' && !e.voided && eventPlayerId(e) === playerId);
    if (!join) return;
    // До старта ленты на экране нет, мест и денег ещё нет — говорим языком стола, а не журнала.
    const name = nameOf(playerId);
    void actions.voidWithConfirm(join, {
      title: `Убрать ${name} из-за стола?`,
      message: 'Посадить снова можно до старта вечера.',
      confirmText: 'Убрать из-за стола',
      successText: `${name} больше не за столом`,
    });
  };

  return (
    <>
      {canControl && (
        <Section title="Стол" aside={pluralWithNumber(seated, ['игрок', 'игрока', 'игроков'])}>
          {seated > 0 ? (
            <PlayersList
              state={state}
              format={evening.format}
              nameOf={nameOf}
              playersById={playersById}
              label="За столом"
              onSelect={(p) => unseat(p.playerId)}
              chevron={false}
            />
          ) : (
            <p className="m-small">
              Перед стартом отметь, кто пришёл: ответившие «иду» будут уже выбраны.
            </p>
          )}
          <div className="ev-actions">
            {seated >= 2 ? (
              <>
                <Button
                  variant="primary"
                  block
                  icon="play"
                  loading={starting}
                  disabled={Boolean(startProblem) || actions.busy}
                  onClick={() => void start()}
                >
                  Начать вечер
                </Button>
                <Button block icon="user-plus" onClick={() => setSeatOpen(true)}>
                  Посадить ещё игроков
                </Button>
              </>
            ) : (
              <Button variant="primary" block icon="user-plus" onClick={() => setSeatOpen(true)}>
                Отметить пришедших
              </Button>
            )}
          </div>
          {seated > 0 && (
            <p className="m-small">Чтобы убрать игрока из-за стола, нажми на его строку.</p>
          )}
        </Section>
      )}

      {!canControl && seated > 0 && (
        <Section title="За столом" aside={pluralWithNumber(seated, ['игрок', 'игрока', 'игроков'])}>
          <PlayersList
            state={state}
            format={evening.format}
            nameOf={nameOf}
            playersById={playersById}
            label="За столом"
          />
        </Section>
      )}

      <MyRsvp eveningId={evening.id} rsvps={rsvps} loaded={rsvpsQuery.isSuccess} />

      <Section
        title="Кто идёт"
        aside={
          rsvpsQuery.isSuccess
            ? goingCount > 0
              ? pluralWithNumber(goingCount, ['идёт', 'идут', 'идут'])
              : 'никто не идёт'
            : undefined
        }
      >
        {rsvpsQuery.isPending ? (
          <div aria-busy="true" className="stack">
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : rsvpsQuery.isError ? (
          <Notice
            tone="critical"
            title="Ответы на анонс не загрузились"
            action={
              <Button size="sm" onClick={() => void rsvpsQuery.refetch()}>
                Повторить
              </Button>
            }
          >
            Проверь интернет — список обновится сам, когда связь вернётся.
          </Notice>
        ) : rsvps.length === 0 ? (
          <Empty
            title="Пока никто не ответил"
            description="Ответы «иду», «не иду» и «под вопросом» появятся здесь, как только игроки нажмут кнопку в анонсе."
          />
        ) : (
          <List aria-label="Ответы на анонс">
            {[...rsvps]
              .sort(
                (a, b) =>
                  RSVP_ORDER[a.status] - RSVP_ORDER[b.status] ||
                  nameOf(a.player_id).localeCompare(nameOf(b.player_id), 'ru'),
              )
              .map((r) => (
                <ListItem
                  key={r.player_id}
                  before={
                    <Avatar
                      name={nameOf(r.player_id)}
                      photoUrl={playersById.get(r.player_id)?.photo_url}
                      size="lg"
                    />
                  }
                  title={nameOf(r.player_id)}
                  after={
                    <Badge tone={RSVP_TONE[r.status]} dot={r.status === 'yes'}>
                      {RSVP_STATUS_META[r.status].other}
                    </Badge>
                  }
                />
              ))}
          </List>
        )}
      </Section>

      <FormatSummary format={evening.format} />
      {canControl && (
        <div className="ev-actions">
          <Button block icon="coins" onClick={() => setPayoutOpen(true)}>
            Изменить призовые
          </Button>
          <p className="m-small">
            Сейчас {evening.format.payoutPct.join(' / ')} % — до старта доли можно поменять под
            число пришедших.
          </p>
        </div>
      )}

      <PayoutSheet
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        eveningId={evening.id}
        payoutPct={evening.format.payoutPct}
      />

      <SeatSheet
        open={seatOpen}
        onClose={() => setSeatOpen(false)}
        model={model}
        actions={actions}
        rsvps={rsvps}
        mode="start"
      />
    </>
  );
}

// Порядок вариантов — общий с главной (RSVP_CHOICES), чтобы палец не промахивался.
const RSVP_OPTIONS: readonly SegmentedOption<RsvpStatus | ''>[] = RSVP_CHOICES.map((status) => ({
  value: status,
  label: RSVP_STATUS_META[status].title,
}));

/**
 * Свой ответ на анонс: применяется сразу (Segmented), гостям не показывается. Сюда ведут кнопки
 * анонса и поста в день игры, поэтому у не ответившего не выбрано ничего — и пока ответы грузятся.
 */
function MyRsvp({
  eveningId,
  rsvps,
  loaded,
}: {
  eveningId: string;
  rsvps: readonly Rsvp[];
  loaded: boolean;
}) {
  const { player } = useAuth();
  const setRsvp = useSetRsvp(eveningId);
  if (!player || player.is_guest) return null;
  const mine = loaded ? (rsvps.find((r) => r.player_id === player.id)?.status ?? null) : undefined;
  const value = rsvpSegmentValue(mine, setRsvp.isPending ? setRsvp.variables : null);
  return (
    <Section title="Твой ответ">
      <Segmented<RsvpStatus | ''>
        label="Твой ответ на анонс"
        block
        value={value}
        options={RSVP_OPTIONS}
        onChange={(status) => {
          if (status) setRsvp.mutate(status);
        }}
      />
      {loaded && value === '' && (
        <p className="m-small">Ответ нужен банкиру, чтобы собрать список игроков.</p>
      )}
    </Section>
  );
}
