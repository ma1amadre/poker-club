import type { ReactNode } from 'react';
import { haptic } from '../telegram';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface PickerPlayer {
  id: string;
  display_name: string;
  photo_url?: string | null;
}

export interface PlayerPickerProps {
  players: readonly PickerPlayer[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /**
   * Сколько можно выбрать. max = 1 — одиночный выбор: тап по другому игроку заменяет выбор
   * (кто вылетел, прогноз на победителя). max > 1 — набор (кто выбил при дележе нокаута).
   */
  max?: number;
  /** Минимум выбранных — снять последнюю отметку нельзя (для обязательного поля). */
  min?: number;
  /** Недоступные для выбора (уже вылетел, сам голосующий). */
  disabledIds?: readonly string[];
  /** Подпись под именем: «вылетел», «2 ребая». */
  hints?: Readonly<Record<string, ReactNode>>;
  /** Подпись над сеткой (озвучивается как имя группы). */
  label?: string;
  /** Показывать «N из M» (для набора). */
  showCount?: boolean;
}

/**
 * Выбор от 1 до n игроков сеткой аватаров — крупные цели для пальца, без выпадающих списков.
 * В «Материи» такого компонента нет: плитки — контролы регистра (m-r-control, рамка line →
 * line-strong при наведении), выбранная — accent-soft, рамка accent и галочка (не только цветом),
 * нажатие — scale-press.
 */
export function PlayerPicker({
  players,
  value,
  onChange,
  max = 1,
  min = 0,
  disabledIds = [],
  hints,
  label,
  showCount = max > 1,
}: PlayerPickerProps) {
  const selected = new Set(value);
  const disabled = new Set(disabledIds);

  const toggle = (id: string) => {
    haptic.selection();
    if (selected.has(id)) {
      if (value.length <= min) return;
      onChange(value.filter((v) => v !== id));
      return;
    }
    if (max === 1) {
      onChange([id]);
      return;
    }
    if (value.length >= max) return;
    onChange([...value, id]);
  };

  const full = max > 1 && value.length >= max;

  return (
    <div className="ui-picker" role="group" aria-label={label}>
      {(label || showCount) && (
        <div className="ui-picker__meta">
          {label && <span>{label}</span>}
          {showCount && (
            <span className="m-mono">
              {value.length} из {max === Number.POSITIVE_INFINITY ? players.length : max}
            </span>
          )}
        </div>
      )}
      <div className="ui-picker__grid">
        {players.map((player) => {
          const isSelected = selected.has(player.id);
          const isDisabled = disabled.has(player.id) || (!isSelected && full);
          return (
            <button
              key={player.id}
              type="button"
              className="ui-picker__option"
              aria-pressed={isSelected}
              disabled={isDisabled}
              onClick={() => toggle(player.id)}
            >
              {isSelected && (
                <span className="ui-picker__check" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
              )}
              <Avatar name={player.display_name} photoUrl={player.photo_url} size="xl" />
              <span className="ui-picker__name">{player.display_name}</span>
              {hints?.[player.id] && <span className="ui-picker__hint">{hints[player.id]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
