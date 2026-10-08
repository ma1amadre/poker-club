// Кратность входа или ребая на пульте банкира: ×1 по умолчанию, до ×10. Сумма и фишки видны
// сразу — банкир сверяет их с деньгами в руке. Весь взнос идёт в фонд. Рядом — «Оплачено сразу»:
// вместе с входом или ребаем пишется платёж на сумму взноса (PaidNowCheckbox).
import { MAX_ENTRY_STACKS, type TournamentFormat } from '@domain/types.ts';
import { haptic } from '../../shared/telegram';
import { Checkbox, FieldGroup, IconButton } from '../../shared/ui';
import { prepaidHint, stacksAmountText } from './lib';

export interface StacksPickerProps {
  format: TournamentFormat;
  value: number;
  onChange: (k: number) => void;
  /** «Вход» или «Ребай» — подпись группы и объект в подписях кнопок. */
  label: 'Вход' | 'Ребай';
  /** Подсказка: к кому относится выбор. */
  note?: string;
  disabled?: boolean;
}

export function StacksPicker({
  format,
  value,
  onChange,
  label,
  note,
  disabled,
}: StacksPickerProps) {
  const noun = label.toLowerCase();
  const set = (k: number) => {
    haptic.selection();
    onChange(k);
  };
  return (
    <FieldGroup label={label} hint={note}>
      <div className="ev-stacks">
        <IconButton
          variant="secondary"
          icon="minus"
          label={`Уменьшить ${noun}`}
          disabled={disabled || value <= 1}
          onClick={() => set(value - 1)}
        />
        <p className="ev-stacks__value" aria-live="polite">
          <span className="m-h3 m-mono">×{value}</span>
          <span className="m-small">{stacksAmountText(format, value)}</span>
        </p>
        <IconButton
          variant="secondary"
          icon="plus"
          label={`Увеличить ${noun}`}
          disabled={disabled || value >= MAX_ENTRY_STACKS}
          onClick={() => set(value + 1)}
        />
      </div>
    </FieldGroup>
  );
}

export interface PaidNowCheckboxProps {
  format: TournamentFormat;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Что оплачивается: вход (посадка) или ребай. */
  kind: 'entry' | 'rebuy';
  /** Кратность — сумма платежа в подсказке. */
  stacks: number;
  /** Посадка нескольких: у каждого свой платёж. */
  many?: boolean;
  disabled?: boolean;
}

/**
 * «Оплачено сразу»: по умолчанию выключено. Применяется вместе с главной кнопкой шторки, поэтому
 * Checkbox, а не Switch (у Switch «Материи» — мгновенный эффект).
 */
export function PaidNowCheckbox({
  format,
  checked,
  onChange,
  kind,
  stacks,
  many,
  disabled,
}: PaidNowCheckboxProps) {
  return (
    <Checkbox
      className="ev-paid"
      label="Оплачено сразу"
      description={prepaidHint(format, kind, stacks, many)}
      checked={checked}
      disabled={disabled}
      onChange={(event) => {
        haptic.selection();
        onChange(event.currentTarget.checked);
      }}
    />
  );
}
