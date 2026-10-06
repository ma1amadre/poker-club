// Незакрытые расчёты: мой долг банкиру или долг банкира мне (settlement домена по журналу),
// а банкиру — сколько игроков ему ещё рассчитать. Каждое сообщение ведёт на экран расчёта.
import { useMemo } from 'react';
import type { ClubHistory, Player } from '../../shared/api';
import { formatDate, formatRub, paths, pluralWithNumber } from '../../shared/lib';
import { ButtonLink, Notice } from '../../shared/ui';
import { openSettlements } from './lib';

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
        const where = `Вечер ${formatDate(debt.scheduledAt)}${banker ? ` · банкир — ${banker}` : ''}.`;
        return debt.kind === 'owe' ? (
          <Notice
            key={debt.eveningId}
            tone="caution"
            title={`Вы должны банкиру ${formatRub(debt.amountRub)}`}
            action={action(debt.eveningId)}
          >
            {where}
          </Notice>
        ) : (
          <Notice
            key={debt.eveningId}
            tone="info"
            title={`Банкир должен вам ${formatRub(debt.amountRub)}`}
            action={action(debt.eveningId)}
          >
            {where}
          </Notice>
        );
      })}
      {open.banker.map((duty) => (
        <Notice
          key={duty.eveningId}
          tone="info"
          title={`Расчёт за ${formatDate(duty.scheduledAt)} не закрыт`}
          action={action(duty.eveningId)}
        >
          {`Вы банкир вечера. Осталось рассчитать ${pluralWithNumber(duty.pending, ['игрока', 'игроков', 'игроков'])}.`}
        </Notice>
      ))}
    </div>
  );
}
