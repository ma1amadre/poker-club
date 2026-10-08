// Расчёт /evening/:id/settle: кто сколько внёс и выиграл, сколько осталось перевести через банкира.
// Деньги — только домен: computeMoney + settlement по платежам журнала (paymentsFromEvents).
// Банкир или админ записывает и отменяет платежи; «Закрыть расчёт» — когда isSettled.
import {
  computeMoney,
  isSettled,
  paymentsFromEvents,
  settlement,
  type SettlementRow,
} from '@domain/money.ts';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMarkSettled, useUnmarkSettled } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { copyText, formatDate, formatNumber, formatRub, formatTime, paths } from '../../shared/lib';
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
  useToast,
  type Tone,
} from '../../shared/ui';
import './evening.css';
import {
  eventPlayerId,
  journalVersion,
  paymentEvents,
  reopenedNotice,
  settleDirection,
  settleLabel,
  settleOrder,
  settleShareText,
  settleTotals,
  settledNotice,
} from './lib';
import { EventRow, StaleNotice } from './parts';
import { PaymentSheet, type PaymentTarget } from './PaymentSheet';
import { ShareTextSheet } from './ShareTextSheet';
import { useEveningActions } from './useEveningActions';
import { useEveningModel, type EveningModel } from './useEveningModel';

const STATUS_TONE: Record<ReturnType<typeof settleDirection>, Tone> = {
  to_banker: 'caution',
  from_banker: 'neutral',
  none: 'positive',
};

export default function SettlePage() {
  const { id } = useParams<{ id: string }>();
  const result = useEveningModel(id);

  if (result.status === 'loading') return <PageSkeleton label="Загрузка расчёта" />;
  if (result.status === 'error') {
    return (
      <Page title="Расчёт" back>
        <ErrorView error={result.error} title="Расчёт не загрузился" onRetry={result.retry} />
      </Page>
    );
  }
  if (result.status === 'not_found') {
    return (
      <Page title="Расчёт" back>
        <Empty
          kind="no-results"
          title="Такого вечера нет"
          description="Ссылка устарела или вечер удалили. Открой вечер из списка на главной."
          action={<ButtonLink to={paths.home}>Открыть главную</ButtonLink>}
        />
      </Page>
    );
  }
  return <SettleScreen model={result.model} />;
}

function SettleScreen({ model }: { model: EveningModel }) {
  const { evening, state, events, nameOf, playersById, canControl, nowMs } = model;
  const { player } = useAuth();
  const actions = useEveningActions(model);
  const toast = useToast();
  const markSettled = useMarkSettled();
  const unmarkSettled = useUnmarkSettled();
  const [target, setTarget] = useState<PaymentTarget | null>(null);
  // Текст расчёта, который не удалось положить в буфер: шторка с выделенным текстом.
  const [shareText, setShareText] = useState<string | null>(null);

  const money = computeMoney(evening.format, state);
  const table = settlement(money, paymentsFromEvents(events));
  const ids = settleOrder(state, Object.keys(table));
  const totals = settleTotals(money, table);
  const allSettled = ids.length > 0 && isSettled(table);
  const payments = paymentEvents(events);
  const status = evening.status;
  const finished = status === 'finished' || status === 'settled';
  const canPay = canControl && status !== 'cancelled';
  const reopened = reopenedNotice(evening, canControl, Boolean(player && state.players[player.id]));
  const settled = settledNotice(
    allSettled,
    canControl,
    evening.settled_at
      ? `${formatDate(evening.settled_at, nowMs)} в ${formatTime(evening.settled_at)}`
      : null,
  );

  const close = async () => {
    try {
      // Какой журнал видел банкир: если с тех пор его правили, сервер откажет (миграция 010).
      await markSettled.mutateAsync({ eveningId: evening.id, ...journalVersion(events) });
      toast.show('Расчёт закрыт', { tone: 'positive' });
    } catch {
      // тост с причиной показал глобальный обработчик мутаций
    }
  };

  const reopen = async () => {
    const ok = await actions.confirm({
      title: 'Открыть расчёт заново?',
      message:
        'Вечер вернётся в статус «Игра окончена»: долги снова появятся на главной у должников, а расчёт нужно будет закрыть заново. Записи журнала не изменятся.',
      confirmText: 'Открыть расчёт',
      cancelText: 'Оставить закрытым',
    });
    if (!ok) return;
    try {
      await unmarkSettled.mutateAsync(evening.id);
      toast.show('Расчёт открыт заново');
    } catch {
      // тост показал глобальный обработчик
    }
  };

  const playerPayments = (playerId: string) =>
    payments.filter((ev) => eventPlayerId(ev) === playerId);

  // «Скопировать расчёт»: остатки settlement домена текстом для чата; буфер недоступен — шторка.
  const copySettle = async () => {
    const text = settleShareText({
      dateLabel: formatDate(evening.scheduled_at, nowMs),
      bankerId: evening.banker_id,
      ids,
      table,
      nameOf,
      formatRub,
    });
    if (await copyText(text))
      toast.show('Расчёт скопирован — вставь его в чат', { tone: 'positive' });
    else setShareText(text);
  };

  return (
    <Page
      back
      eyebrow={`Вечер ${formatDate(evening.scheduled_at, nowMs)}`}
      title="Расчёт"
      subtitle={
        evening.banker_id
          ? `Деньги идут через банкира: ${nameOf(evening.banker_id)}`
          : 'Банкир не назначен — платежи записывает админ'
      }
    >
      {model.stale && <StaleNotice updatedAt={model.updatedAt} onRetry={model.retry} />}
      {status === 'announced' || status === 'live' ? (
        <Notice tone="info" title="Игра ещё не окончена">
          Сейчас видны только взносы. Призы появятся после завершения вечера.
        </Notice>
      ) : status === 'settled' ? (
        <Notice tone={settled.tone} title={settled.title}>
          {settled.text}
        </Notice>
      ) : reopened ? (
        <Notice tone="caution" title={reopened.title}>
          {reopened.text}
        </Notice>
      ) : status === 'cancelled' ? (
        <Notice tone="info" title="Вечер отменён">
          Игры не было, рассчитываться не за что.
        </Notice>
      ) : null}

      <Stats>
        <Stat label="Взносы" value={formatNumber(totals.inRub)} unit="₽" />
        <Stat
          label="Выплаты"
          value={formatNumber(totals.outRub)}
          unit="₽"
          note={finished ? 'призы по местам' : 'после завершения вечера'}
        />
        <Stat
          label="У банкира"
          value={formatNumber(totals.bankerHoldsRub)}
          unit="₽"
          note="получено минус выдано"
        />
      </Stats>

      <Section
        title="Кто кому должен"
        footer={canPay ? 'Нажми на игрока, чтобы записать платёж.' : undefined}
      >
        {ids.length === 0 ? (
          <Empty
            title="Игроков ещё нет"
            description="Расчёт появится, когда банкир посадит игроков за стол."
            action={<ButtonLink to={paths.evening(evening.id)}>Открыть вечер</ButtonLink>}
          />
        ) : (
          <List aria-label="Расчёт по игрокам">
            {ids.map((playerId) => {
              const row: SettlementRow | undefined = table[playerId];
              const m = money[playerId];
              if (!row) return null;
              const direction = settleDirection(row);
              return (
                <ListItem
                  key={playerId}
                  before={
                    <Avatar
                      name={nameOf(playerId)}
                      photoUrl={playersById.get(playerId)?.photo_url}
                      size="lg"
                    />
                  }
                  title={nameOf(playerId)}
                  subtitle={
                    <span className="ev-settle-sub">
                      <span className="ev-subline">
                        <span>внёс {formatRub(m?.owesRub ?? 0)}</span>
                        {finished && <span>приз {formatRub(m?.prizeRub ?? 0)}</span>}
                      </span>
                      <Badge tone={STATUS_TONE[direction]} dot={direction === 'none'}>
                        {settleLabel(row, formatRub)}
                      </Badge>
                    </span>
                  }
                  after={
                    finished && m ? (
                      <span className="ev-row-after">
                        <span className="m-small">итог</span>
                        <Amount value={m.netRub} icon />
                      </span>
                    ) : undefined
                  }
                  onClick={canPay ? () => setTarget({ playerId, row }) : undefined}
                  chevron={canPay}
                />
              );
            })}
          </List>
        )}
      </Section>

      {finished && ids.length > 0 && (
        <Button block variant="secondary" icon="copy" onClick={() => void copySettle()}>
          Скопировать расчёт
        </Button>
      )}

      {canControl && status === 'finished' && (
        <div className="ev-actions">
          <Button
            variant="primary"
            block
            icon="check-circle"
            loading={markSettled.isPending}
            disabled={!allSettled}
            onClick={() => void close()}
          >
            Закрыть расчёт
          </Button>
          <p className="m-small">
            {allSettled
              ? 'Все в расчёте, у банкира ноль — расчёт можно закрыть.'
              : 'Кнопка заработает, когда у каждого игрока остаток станет нулевым.'}
          </p>
        </div>
      )}

      {/* Банкир тоже: unmark_settled ему разрешён (ARCHITECTURE.md), а после закрытия он может
          отменить платёж — без этой кнопки вечер застрял бы в «Расчёт закрыт» с долгом. */}
      {canControl && status === 'settled' && (
        <Button
          block
          icon="rotate-ccw"
          loading={unmarkSettled.isPending}
          onClick={() => void reopen()}
        >
          Открыть расчёт заново
        </Button>
      )}

      <Section
        title="Платежи"
        footer={canPay && payments.length > 0 ? 'Чтобы отменить платёж, нажми на него.' : undefined}
      >
        {payments.length === 0 ? (
          <p className="m-small">Платежей пока нет.</p>
        ) : (
          <List aria-label="Платежи вечера">
            {payments.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                nameOf={nameOf}
                format={evening.format}
                onSelect={canPay ? (e) => void actions.voidWithConfirm(e) : undefined}
              />
            ))}
          </List>
        )}
      </Section>

      <ButtonLink to={paths.evening(evening.id)} variant="ghost" icon="arrow-left">
        Вернуться к вечеру
      </ButtonLink>

      <PaymentSheet
        target={
          target ? { playerId: target.playerId, row: table[target.playerId] ?? target.row } : null
        }
        onClose={() => setTarget(null)}
        model={model}
        actions={actions}
        payments={target ? playerPayments(target.playerId) : []}
      />
      <ShareTextSheet text={shareText} onClose={() => setShareText(null)} title="Расчёт для чата" />
      {actions.confirmElement}
    </Page>
  );
}
