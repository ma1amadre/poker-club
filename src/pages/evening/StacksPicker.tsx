// Кратность входа или ребая на пульте банкира: ×1 по умолчанию, до ×10. Сумма и фишки видны
// сразу — банкир сверяет их с деньгами в руке. Весь взнос идёт в фонд.
import { MAX_ENTRY_STACKS, type TournamentFormat } from '@domain/types.ts';
import { haptic } from '../../shared/telegram';
import { FieldGroup, IconButton } from '../../shared/ui';
import { stacksAmountText } from './lib';

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
