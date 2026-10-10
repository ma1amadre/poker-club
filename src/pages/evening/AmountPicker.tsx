// Сумма входа или ребая на пульте банкира (миграция 027: вход и ребай — любой суммой). Быстрые
// кнопки — вход формата ×1, ×2, ×3 («500 / 1 000 / 1 500», quickEntryAmounts домена) и «Другая
// сумма…» — числовое поле. Под выбором — сумма и фишки по курсу формата: банкир сверяет их с
// деньгами в руке. Весь взнос идёт в фонд. Рядом — «Оплачено сразу»: вместе с входом или ребаем
// пишется платёж на эту сумму (PaidNowCheckbox). Enter («Готово») в поле суммы только прячет
// клавиатуру (hideKeyboardOnEnter): у гостя поле стоит в форме, и Enter посадил бы его до отметки
// оплаты.
import { quickEntryAmounts } from '@domain/money.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { useState } from 'react';
import { formatNumber } from '../../shared/lib';
import { haptic } from '../../shared/telegram';
import { Checkbox, Field, FieldGroup, Segmented } from '../../shared/ui';
import {
  ENTRY_RUB_HINT,
  entryAmountText,
  hideKeyboardOnEnter,
  parseEntryRub,
  prepaidHint,
} from './lib';

const OTHER = 'other';

export interface AmountPickerProps {
  format: TournamentFormat;
  /** Сумма сейчас; null — в поле «Другая сумма» неверное значение (кнопки записи недоступны). */
  value: number | null;
  /** Новая сумма; null — поле «Другая сумма» пустое или с ошибкой. */
  onChange: (rub: number | null) => void;
  /** Подпись группы: «Вход», «Ребай». */
  label: string;
  /** Подсказка: к кому относится выбор. */
  note?: string;
  disabled?: boolean;
}

/**
 * Выбор суммы. Сумма вне быстрых кнопок (700, 300) — режим «Другая сумма…» с полем, в нём же
 * правка открывается, если в записи уже такая сумма. Родитель держит число, поле — свой текст: при
 * смене родителем суммы снаружи компонент монтируют заново (key).
 */
export function AmountPicker({
  format,
  value,
  onChange,
  label,
  note,
  disabled,
}: AmountPickerProps) {
  const quick = quickEntryAmounts(format);
  const [other, setOther] = useState(() => value === null || !quick.includes(value));
  const [text, setText] = useState(() =>
    value !== null && !quick.includes(value) ? String(value) : '',
  );
  const [touched, setTouched] = useState(false);
  // Поле появилось по нажатию «Другая сумма…» — фокус в него; открытая правка с суммой 700 — без
  // фокуса (клавиатура не должна выскакивать сама).
  const [picked, setPicked] = useState(false);
  const parsed = parseEntryRub(text);
  const error = other && touched && parsed === null ? ENTRY_RUB_HINT : undefined;

  const pick = (key: string) => {
    if (key === OTHER) {
      setOther(true);
      setPicked(true);
      onChange(parseEntryRub(text));
      return;
    }
    setOther(false);
    setTouched(false);
    onChange(Number(key));
  };

  return (
    <FieldGroup label={label} hint={note}>
      <div className="ev-amount">
        <Segmented
          className="ui-seg--buttons ev-amount__quick"
          block
          label={`${label}: сумма`}
          value={other ? OTHER : String(value)}
          onChange={pick}
          options={[
            ...quick.map((rub) => ({
              value: String(rub),
              label: <span className="m-mono">{formatNumber(rub)}</span>,
            })),
            { value: OTHER, label: 'Другая сумма…' },
          ]}
        />
        {other && (
          <Field
            label="Сумма, ₽"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="700"
            suffix="₽"
            autoFocus={picked && !disabled}
            value={text}
            error={error}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              const rub = parseEntryRub(next);
              if (rub !== null) haptic.selection();
              onChange(rub);
            }}
            // «Готово» / Enter — только спрятать клавиатуру, не отправить форму вокруг (гость).
            onKeyDown={hideKeyboardOnEnter}
            onBlur={() => setTouched(true)}
          />
        )}
        <p className="m-small ev-amount__value" aria-live="polite">
          {value !== null ? entryAmountText(format, value) : error ? '' : 'Впиши сумму в рублях'}
        </p>
      </div>
    </FieldGroup>
  );
}

export interface PaidNowCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Что оплачивается: вход (посадка) или ребай. */
  kind: 'entry' | 'rebuy';
  /** Сумма — сумма платежа в подсказке; null — сумма в поле неверна. */
  rub: number | null;
  /** Ребаи нескольких (после ривера): у каждого свой платёж. */
  many?: boolean;
  /** Без подсказки под подписью (строки посадки: подсказка одна над списком). */
  bare?: boolean;
  disabled?: boolean;
}

/**
 * «Оплачено сразу»: по умолчанию выключено. Применяется вместе с главной кнопкой шторки, поэтому
 * Checkbox, а не Switch (у Switch «Материи» — мгновенный эффект).
 */
export function PaidNowCheckbox({
  checked,
  onChange,
  kind,
  rub,
  many,
  bare,
  disabled,
}: PaidNowCheckboxProps) {
  return (
    <Checkbox
      className="ev-paid"
      label="Оплачено сразу"
      description={bare ? undefined : prepaidHint(kind, rub, many)}
      checked={checked}
      disabled={disabled}
      onChange={(event) => {
        haptic.selection();
        onChange(event.currentTarget.checked);
      }}
    />
  );
}
