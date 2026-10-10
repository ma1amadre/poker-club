// Выбор в шторке олл-ина после ривера: кто вылетел (отметок заранее нет — банкир отмечает, кому не
// хватило фишек), кто кого выбил, порядок по фишкам перед раздачей (у кого больше — место выше) и
// ребай сразу — с суммой, как в шторке игрока (одна на всех, кто докупается), и «Оплачено сразу».
// Кто выбил — домен: обычно однозначно (строкой), а если кто-то из проигравших остался в игре и
// возможен побочный банк — выбор из тех, кто мог забрать последние фишки, по умолчанию лучшая рука.
// Состояние — useRiverChoice.
import type { PlayerId, TournamentFormat } from '@domain/types.ts';
import { capitalize, joinNames } from '../../shared/lib';
import { Checkbox, FieldGroup, IconButton, PlayerPicker, Segmented } from '../../shared/ui';
import { haptic } from '../../shared/telegram';
import { killerKey, killersInColumn, riverKillersText } from './riverBusts';
import { AmountPicker, PaidNowCheckbox } from './AmountPicker';
import type { RiverChoice } from './useRiverBusts';
import type { EveningModel } from './useEveningModel';

export function RiverBustsChoice({
  model,
  choice,
  canRebuy,
  disabled,
}: {
  model: EveningModel;
  choice: RiverChoice;
  /** Может ли игрок докупиться сразу после этих вылетов. */
  canRebuy: (id: PlayerId) => boolean;
  disabled: boolean;
}) {
  const { nameOf, playersById } = model;
  const format: TournamentFormat = model.evening.format;
  const many = choice.byChips.length > 1;
  const rebuys = choice.rebuys.filter(canRebuy);
  return (
    <div className="ev-river">
      <FieldGroup
        label="Кто вылетел"
        hint="Проиграли раздачу. Отметь, кому не хватило фишек: остальные остаются за столом."
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
      {choice.byChips.length > 0 && (
        <FieldGroup
          label={many ? 'Места по фишкам' : 'Вылет'}
          hint={
            many ? 'Выше — у кого фишек перед раздачей было больше: ему место выше.' : undefined
          }
        >
          <ol className="ev-river__order">
            {choice.byChips.map((id, i) => {
              const name = nameOf(id);
              const variants = choice.options[id] ?? [[]];
              const labels = variants.map((group) => joinNames(group.map(nameOf)));
              const killers = choice.killers[id] ?? [];
              return (
                <li key={id} className={many ? 'ev-river__row ev-river__row--n' : 'ev-river__row'}>
                  <div className="ev-river__head">
                    {many && (
                      <span className="m-mono ev-river__n">{String(i + 1).padStart(2, '0')}</span>
                    )}
                    <span className="ui-name ev-river__name">{name}</span>
                    {i > 0 && (
                      <IconButton
                        variant="ghost"
                        icon="chevron-up"
                        label={`Поднять выше: ${name}`}
                        disabled={disabled}
                        onClick={() => choice.raise(id)}
                      />
                    )}
                  </div>
                  {variants.length > 1 ? (
                    <div className="ev-river__ko">
                      <p className="m-small ev-river__warn">
                        Возможен побочный банк — проверь, кто выбил.
                      </p>
                      <Segmented
                        className={
                          killersInColumn(labels)
                            ? 'ui-seg--buttons ev-river__killers ev-river__killers--stack'
                            : 'ui-seg--buttons ev-river__killers'
                        }
                        block
                        label={`Кто выбил: ${name}`}
                        value={killerKey(killers)}
                        options={variants.map((group, v) => ({
                          value: killerKey(group),
                          label: labels[v] ?? '',
                        }))}
                        onChange={(key) => choice.pickKiller(id, key)}
                      />
                    </div>
                  ) : (
                    <p className="m-small ev-river__by">
                      {capitalize(riverKillersText(killers.map(nameOf)))}
                    </p>
                  )}
                  {canRebuy(id) && (
                    <Checkbox
                      className="ev-river__rebuy"
                      label="Сразу ребай"
                      checked={choice.rebuys.includes(id)}
                      disabled={disabled}
                      onChange={(event) => {
                        haptic.selection();
                        choice.toggleRebuy(id, event.currentTarget.checked);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </FieldGroup>
      )}
      {rebuys.length > 0 && (
        <>
          <AmountPicker
            format={format}
            value={choice.rebuyRub}
            onChange={choice.setRebuyRub}
            label="Ребай"
            note={
              rebuys.length > 1
                ? 'Сумма одна на всех, кто сразу докупается. Разные суммы — ребаи отдельно, в шторке игрока.'
                : undefined
            }
            disabled={disabled}
          />
          <PaidNowCheckbox
            checked={choice.paid}
            onChange={choice.setPaid}
            kind="rebuy"
            rub={choice.rebuyRub}
            many={rebuys.length > 1}
            disabled={disabled}
          />
        </>
      )}
    </div>
  );
}
