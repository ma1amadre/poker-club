// Выбор в шторке олл-ина после ривера: кто вылетел (по умолчанию — все проигравшие раздачу) и
// порядок по фишкам перед раздачей — у кого больше, тому место выше. Состояние — useRiverChoice.
import { FieldGroup, IconButton, PlayerPicker } from '../../shared/ui';
import { riverKillersText, type RiverBustSuggestion } from './riverBusts';
import type { RiverChoice } from './useRiverBusts';
import type { EveningModel } from './useEveningModel';

export function RiverBustsChoice({
  model,
  suggestion,
  choice,
  disabled,
}: {
  model: EveningModel;
  suggestion: RiverBustSuggestion;
  choice: RiverChoice;
  disabled: boolean;
}) {
  const { nameOf, playersById } = model;
  const killers = riverKillersText(suggestion.killers.map(nameOf));
  return (
    <div className="ev-river">
      <FieldGroup
        label="Кто вылетел"
        hint={`Проиграли раздачу — ${killers}. Фишек хватило и игрок остаётся за столом — сними отметку.`}
      >
        <PlayerPicker
          players={choice.victims.map((id) => ({
            id,
            display_name: nameOf(id),
            photo_url: playersById.get(id)?.photo_url ?? null,
          }))}
          value={choice.byChips}
          onChange={choice.pick}
          max={choice.victims.length}
          showCount={false}
        />
      </FieldGroup>
      {choice.byChips.length > 1 && (
        <FieldGroup
          label="Места по фишкам"
          hint="Выше — у кого фишек перед раздачей было больше: ему место выше."
        >
          <ol className="ev-river__order">
            {choice.byChips.map((id, i) => (
              <li key={id} className="ev-river__row">
                <span className="m-mono ev-river__n">{i + 1}</span>
                <span className="m-body ev-river__name">{nameOf(id)}</span>
                {i > 0 && (
                  <IconButton
                    variant="ghost"
                    icon="chevron-up"
                    label={`Поднять выше: ${nameOf(id)}`}
                    disabled={disabled}
                    onClick={() => choice.raise(id)}
                  />
                )}
              </li>
            ))}
          </ol>
        </FieldGroup>
      )}
    </div>
  );
}
