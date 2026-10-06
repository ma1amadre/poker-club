// Призовые доли вечера до старта: банкир (или админ) меняет 70/30 на 50/30/20, когда пришло больше
// людей (решение концепции «банкир меняет до старта»). RPC set_payout, миграция 007; правило долей —
// то же, что у validateFormat.
import { useState } from 'react';
import { useSetPayout } from '../../shared/api';
import { NBSP } from '../../shared/lib';
import { Button, Field, FieldGroup, IconButton, Sheet, useToast } from '../../shared/ui';
import { parsePayouts, payoutTextSum } from './lib';

export interface PayoutSheetProps {
  open: boolean;
  onClose: () => void;
  eveningId: string;
  payoutPct: readonly number[];
}

export function PayoutSheet({ open, ...rest }: PayoutSheetProps) {
  // Каждое открытие — с текущих долей вечера.
  return open ? <PayoutSheetInner {...rest} /> : null;
}

const MAX_PLACES = 10;

function PayoutSheetInner({ onClose, eveningId, payoutPct }: Omit<PayoutSheetProps, 'open'>) {
  const [texts, setTexts] = useState<string[]>(() =>
    payoutPct.map((p) => String(p).replace('.', ',')),
  );
  const [submitted, setSubmitted] = useState(false);
  const setPayout = useSetPayout(eveningId);
  const toast = useToast();

  const parsed = parsePayouts(texts);
  const sum = payoutTextSum(texts);
  const sending = setPayout.isPending;

  const save = async () => {
    setSubmitted(true);
    if (!parsed.ok) return;
    try {
      await setPayout.mutateAsync(parsed.pct);
      toast.show(`Призовые: ${parsed.pct.join(' / ')}${NBSP}%`, { tone: 'positive' });
      onClose();
    } catch {
      // тост с причиной показал глобальный обработчик мутаций
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!sending}
      title="Призовые места"
      description="Доли фонда по местам. Меняются до старта вечера; если игроков окажется меньше, чем мест, доли пересчитаются на тех, кто есть."
      actions={
        <Button variant="primary" block icon="check" loading={sending} onClick={() => void save()}>
          Сохранить призовые
        </Button>
      }
    >
      <form
        className="ev-sheet-body"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FieldGroup
          label="Доли по местам"
          hint={
            sum === null
              ? 'В каждом поле — число процентов.'
              : `Сумма ${String(sum).replace('.', ',')}${NBSP}% из 100`
          }
          error={submitted && !parsed.ok ? parsed.error : undefined}
        >
          <div className="ev-payouts">
            {texts.map((value, i) => (
              <div key={i} className="ev-payout">
                <Field
                  label={`${i + 1}-е место`}
                  suffix="%"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(event) =>
                    setTexts((list) => list.map((p, j) => (j === i ? event.target.value : p)))
                  }
                />
                <IconButton
                  variant="ghost"
                  label={`Убрать ${i + 1}-е место`}
                  icon="x"
                  disabled={texts.length <= 1 || sending}
                  onClick={() => setTexts((list) => list.filter((_, j) => j !== i))}
                />
              </div>
            ))}
          </div>
        </FieldGroup>
        <Button
          variant="ghost"
          icon="plus"
          disabled={texts.length >= MAX_PLACES || sending}
          onClick={() => setTexts((list) => [...list, ''])}
        >
          Добавить место
        </Button>
      </form>
    </Sheet>
  );
}
