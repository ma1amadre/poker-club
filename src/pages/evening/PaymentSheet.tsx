// Платёж через банкира: «Записать полностью» закрывает остаток игрока одним событием payment;
// произвольная сумма — с направлением (игрок → банкиру или банкир → игроку). Знак суммы — по
// контракту payment: «+» игрок отдал банкиру, «−» банкир отдал игроку.
import type { SettlementRow } from '@domain/money.ts';
import { useState } from 'react';
import type { EveningEventRecord } from '../../shared/api';
import { formatRub } from '../../shared/lib';
import { Amount, Button, Field, List, Segmented, Sheet } from '../../shared/ui';
import { parseRub, settleDirection, settleLabel, signedPayment, type SettleDirection } from './lib';
import { EventRow } from './parts';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface PaymentTarget {
  playerId: string;
  row: SettlementRow;
}

export interface PaymentSheetProps {
  target: PaymentTarget | null;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  /** Платежи этого игрока (новые сверху, с отменёнными). */
  payments: readonly EveningEventRecord[];
}

export function PaymentSheet({ target, ...rest }: PaymentSheetProps) {
  return target ? <PaymentSheetInner key={target.playerId} target={target} {...rest} /> : null;
}

type Direction = Exclude<SettleDirection, 'none'>;

function PaymentSheetInner({
  target,
  onClose,
  model,
  actions,
  payments,
}: Omit<PaymentSheetProps, 'target'> & { target: PaymentTarget }) {
  const { nameOf } = model;
  const name = nameOf(target.playerId);
  const due = settleDirection(target.row);
  const [direction, setDirection] = useState<Direction>(
    due === 'from_banker' ? 'from_banker' : 'to_banker',
  );
  const [amountText, setAmountText] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [sending, setSending] = useState<'full' | 'custom' | null>(null);

  const record = async (amountRub: number, kind: 'full' | 'custom') => {
    setSending(kind);
    const done = await actions.send(
      'payment',
      { playerId: target.playerId, amountRub },
      {
        success:
          amountRub > 0
            ? `${name} → банкиру ${formatRub(amountRub)}`
            : `Банкир → ${name} ${formatRub(-amountRub)}`,
        detail: 'Платёж записан.',
        undo: true,
      },
    );
    setSending(null);
    if (done) onClose();
  };

  const recordFull = () => {
    if (due === 'none') return;
    void record(signedPayment(target.row.remainingRub, due), 'full');
  };

  const recordCustom = () => {
    const n = parseRub(amountText);
    if (n === null) {
      setAmountError('Нужна сумма в целых рублях больше нуля, например 500.');
      return;
    }
    setAmountError(null);
    void record(signedPayment(n, direction), 'custom');
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={sending === null}
      title={`Платёж: ${name}`}
      description={settleLabel(target.row, formatRub)}
      actions={
        due !== 'none' ? (
          <Button
            variant="primary"
            block
            icon="check"
            loading={sending === 'full'}
            disabled={sending !== null}
            onClick={recordFull}
          >
            {`Записать полностью — ${formatRub(Math.abs(target.row.remainingRub))}`}
          </Button>
        ) : undefined
      }
    >
      <div className="ev-sheet-body">
        <div className="ev-pay-summary">
          <span className="m-small">
            К оплате {formatRub(Math.abs(target.row.dueRub))}
            {target.row.dueRub > 0 ? ' банкиру' : target.row.dueRub < 0 ? ' игроку' : ''}, внесено
            платежами <Amount value={target.row.paidRub} />
          </span>
        </div>

        <form
          className="ev-sheet-body"
          onSubmit={(event) => {
            event.preventDefault();
            recordCustom();
          }}
        >
          <Segmented<Direction>
            label="Кто кому отдал деньги"
            block
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'to_banker', label: 'Игрок → банкиру' },
              { value: 'from_banker', label: 'Банкир → игроку' },
            ]}
          />
          <Field
            label="Другая сумма"
            inputMode="numeric"
            autoComplete="off"
            placeholder="500"
            suffix="₽"
            value={amountText}
            error={amountError ?? undefined}
            onChange={(event) => setAmountText(event.target.value)}
          />
          <Button
            type="submit"
            block
            icon="wallet"
            loading={sending === 'custom'}
            disabled={sending !== null}
          >
            Записать сумму
          </Button>
        </form>

        {payments.length > 0 && (
          <div className="stack">
            <p className="m-eyebrow">Платежи игрока</p>
            <List aria-label={`Платежи: ${name}`}>
              {payments.map((ev) => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  nameOf={nameOf}
                  onVoid={(e) => {
                    // Окно поверх окна «Материя» запрещает: сначала закрываем шторку.
                    onClose();
                    void actions.voidWithConfirm(e);
                  }}
                />
              ))}
            </List>
          </div>
        )}
      </div>
    </Sheet>
  );
}
