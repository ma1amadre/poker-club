// Незакрытые расчёты: мой долг банкиру или долг банкира мне (settlement домена по журналу),
// а банкиру — сколько игроков ему ещё рассчитать. Каждое сообщение ведёт на экран расчёта.
import { useMemo } from 'react';
import type { ClubHistory, Player } from '../../shared/api';
import { formatDate, formatRub, gameSuffix, paths, pluralWithNumber } from '../../shared/lib';
import { ButtonLink, Notice } from '../../shared/ui';
import { openSettlements, type BankerDuty } from './lib';

export interface SettlementNoticesProps {
  history: ClubHistory;
  me: Player;
  playersById: ReadonlyMap<string, Player>;
}

export function SettlementNotices({ history, me, playersById }: SettlementNoticesProps) {
  const open = useMemo(
    () => openSettlements(history.evenings, history.eventsByEvening, me.id),
    [history, me.id],
  );
  if (open.debts.length === 0 && open.banker.length === 0) return null;

  const action = (eveningId: string) => (
    <ButtonLink size="sm" to={paths.settle(eveningId)}>
      Открыть
    </ButtonLink>
  );

  return (
    <div className="home-notices">
      {open.debts.map((debt) => {
        const banker = debt.bankerId ? playersById.get(debt.bankerId)?.display_name : null;
        const where =
          `Вечер ${formatDate(debt.scheduledAt)}${gameSuffix(debt.gameNo)}${banker ? ` · банкир — ${banker}` : ''}.` +
          (debt.reopened ? ' Журнал изменился после закрытия расчёта.' : '');
        return debt.kind === 'owe' ? (
          <Notice
            key={debt.eveningId}
            tone="caution"
            title={`Твой долг банкиру — ${formatRub(debt.amountRub)}`}
            action={action(debt.eveningId)}
          >
            {where}
          </Notice>
        ) : (
          <Notice
            key={debt.eveningId}
            tone="info"
            title={`Банкир должен тебе ${formatRub(debt.amountRub)}`}
            action={action(debt.eveningId)}
          >
            {where}
          </Notice>
        );
      })}
      {open.banker.map((duty) => (
        <Notice
          key={duty.eveningId}
          tone={duty.reopened ? 'caution' : 'info'}
          title={
            duty.reopened
              ? `Расчёт за ${formatDate(duty.scheduledAt)}${gameSuffix(duty.gameNo)} снова открыт`
              : `Расчёт за ${formatDate(duty.scheduledAt)}${gameSuffix(duty.gameNo)} не закрыт`
          }
          action={action(duty.eveningId)}
        >
          {bankerDutyText(duty)}
        </Notice>
      ))}
    </div>
  );
}

/** Что осталось сделать банкиру вечера; при открывшемся заново расчёте — сначала почему. */
function bankerDutyText(duty: BankerDuty): string {
  const why = duty.reopened ? 'Журнал изменился после закрытия расчёта. ' : '';
  if (duty.pending > 0) {
    return `${why}Ты банкир вечера. Осталось рассчитать ${pluralWithNumber(duty.pending, ['игрока', 'игроков', 'игроков'])}.`;
  }
  if (duty.selfRemainingRub < 0) {
    return `${why}Остальные рассчитались. Запиши свой выигрыш — ${formatRub(-duty.selfRemainingRub)} — и закрой расчёт.`;
  }
  if (duty.selfRemainingRub > 0) {
    return `${why}Остальные рассчитались. Запиши свой взнос — ${formatRub(duty.selfRemainingRub)} — и закрой расчёт.`;
  }
  return duty.reopened
    ? 'Журнал изменился после закрытия расчёта, но все по-прежнему в расчёте — закрой его заново.'
    : 'Все в расчёте — нажми «Закрыть расчёт».';
}
