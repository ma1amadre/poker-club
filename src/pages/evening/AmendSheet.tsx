// «Изменить запись» из ленты (правка на месте, миграция 022): у вылета — кто выбил, у входа и ребая
// — сумма (миграция 027: любая сумма; быстрые кнопки и «Другая сумма…», как на пульте). Правка встаёт на место исходной записи (домен, amend.ts): места, ребаи и уровни после
// неё не сдвигаются — в отличие от «отменить и записать заново». Проверка — canAmend домена по
// журналу (actions.check/send для 'amend'). Здесь же — «Отменить запись» (подтверждение с
// последствиями, как раньше по нажатию на строку).
import {
  AMEND_IMPACT_ERROR,
  amendField,
  amendImpact,
  currentAmendValue,
  type AmendValue,
} from '@domain/amend.ts';
import { useMemo, useState } from 'react';
import type { EveningEventRecord } from '../../shared/api';
import { formatRub, formatTime } from '../../shared/lib';
import { Button, FieldGroup, Notice, PlayerPicker, Sheet } from '../../shared/ui';
import { amendChanged, amendImpactText, amendKillerCandidates, amendToast } from './amendView';
import { AmountPicker } from './AmountPicker';
import { describeEvent, killersHint, linkedPayment } from './lib';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

/** Сумма платежа «Оплачено сразу», записанного вместе со входом. */
function paidAmount(payment: EveningEventRecord): number {
  const amount = (payment.payload as { amountRub?: unknown }).amountRub;
  return typeof amount === 'number' ? amount : 0;
}

export interface AmendSheetProps {
  event: EveningEventRecord | null;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
}

export function AmendSheet({ event, ...rest }: AmendSheetProps) {
  // key: другая запись — форма с чистого листа (значение — из журнала на момент открытия).
  return event ? <AmendSheetInner key={event.id} event={event} {...rest} /> : null;
}

function AmendSheetInner({
  event,
  onClose,
  model,
  actions,
}: Omit<AmendSheetProps, 'event'> & { event: EveningEventRecord }) {
  const { evening, events, nameOf, playersById, nowMs, errorsById } = model;
  const format = evening.format;
  const field = amendField(event);
  // Значение записи сейчас — с правкой в силе. Сумма и выбившие от времени не зависят, поэтому
  // время — на момент открытия шторки: пересчёт только при смене журнала, не каждую секунду.
  const [openedAt] = useState(nowMs);
  const current = useMemo(
    () => currentAmendValue(format, events, event.id, openedAt),
    [format, events, event.id, openedAt],
  );
  // Сумма в правке; null — в поле «Другая сумма» неверное значение.
  const [rub, setRub] = useState<number | null>(
    current && 'rub' in current ? current.rub : format.buyInRub,
  );
  const [killers, setKillers] = useState<string[]>(current && 'by' in current ? current.by : []);
  const [nobody, setNobody] = useState(
    current !== null && 'by' in current && current.by.length === 0,
  );
  const [sending, setSending] = useState(false);

  // Кто был в игре прямо перед вылетом (и уже отмеченные — чтобы их можно было снять).
  const candidates = useMemo(
    () =>
      field === 'by'
        ? amendKillerCandidates(
            format,
            events,
            event.id,
            current && 'by' in current ? current.by : [],
            openedAt,
          )
        : { ids: [], out: [] },
    [field, format, events, event.id, current, openedAt],
  );

  const value: AmendValue | null =
    field === 'rub' ? (rub === null ? null : { rub }) : { by: nobody ? [] : killers };
  const changed = value !== null && amendChanged(current, value);
  const payload = { eventId: event.id, ...(value ?? { rub: format.buyInRub }) };
  const problem = changed ? actions.check('amend', payload) : null;
  // Правка задела бы другие записи (починка непринятой): какие и почему — как при отмене записи.
  const impactText =
    problem === AMEND_IMPACT_ERROR
      ? amendImpactText(amendImpact(format, events, payload, nowMs), events, (ev) => {
          const l = describeEvent(ev, nameOf, formatRub, format, model.feed);
          return `«${l.title}${l.detail ? `, ${l.detail}` : ''}», ${formatTime(ev.at)}`;
        })
      : '';
  const line = describeEvent(event, nameOf, formatRub, format, model.feed);
  const error = errorsById.get(event.id);
  const paid = field === 'rub' ? linkedPayment(events, event, format) : null;

  const save = async () => {
    if (value === null) return;
    setSending(true);
    const toast = amendToast(event, value, nameOf, format);
    const record = await actions.send('amend', payload, {
      success: toast.title,
      detail: toast.detail,
      undo: true,
    });
    setSending(false);
    if (record) onClose();
  };

  const voidRecord = () => {
    onClose();
    void actions.voidWithConfirm(event);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!sending}
      title="Изменить запись"
      description={`${line.title}${line.detail ? ` — ${line.detail}` : ''} · ${formatTime(event.at)}`}
      actions={
        <>
          <Button
            variant="primary"
            block
            icon="check"
            loading={sending}
            disabled={sending || actions.busy || !changed || Boolean(problem)}
            onClick={() => void save()}
          >
            Сохранить правку
          </Button>
          <Button variant="ghost" block icon="x" disabled={sending} onClick={voidRecord}>
            Отменить запись
          </Button>
        </>
      }
    >
      <div className="ev-sheet-body">
        {error && (
          <Notice tone="caution" title="Запись не принята">
            {`${error}. Правка может её починить — например, другим выбившим, если не заденет записи после неё.`}
          </Notice>
        )}
        {problem && (
          <Notice
            tone="caution"
            title={impactText ? 'Правка заденет другие записи' : 'Так исправить нельзя'}
          >
            {impactText || `${problem}.`}
          </Notice>
        )}
        {field === 'by' && (
          <>
            <FieldGroup
              label="Кто выбил"
              hint={killersHint((nobody ? [] : killers).map(nameOf), nobody)}
            >
              {candidates.ids.length > 0 ? (
                <PlayerPicker
                  players={candidates.ids.map((id) => ({
                    id,
                    display_name: nameOf(id),
                    photo_url: playersById.get(id)?.photo_url ?? null,
                  }))}
                  value={nobody ? [] : killers}
                  onChange={(ids) => {
                    setNobody(false);
                    setKillers(ids);
                  }}
                  max={candidates.ids.length}
                  showCount={false}
                  hints={Object.fromEntries(candidates.out.map((id) => [id, 'тогда уже вне игры']))}
                />
              ) : (
                <p className="m-small">Других игроков в игре тогда не было.</p>
              )}
            </FieldGroup>
            <Button
              block
              className="ev-nobody"
              icon={nobody ? 'check' : 'minus'}
              aria-pressed={nobody}
              disabled={sending}
              onClick={() => {
                setNobody((on) => !on);
                setKillers([]);
              }}
            >
              Никто / не знаю, кто выбил
            </Button>
            <p className="m-small">
              Вылет останется на своём месте в журнале: места, ребаи и уровни после него не
              сдвинутся — пересчитаются нокауты и очки за них.
            </p>
          </>
        )}
        {field === 'rub' && (
          <>
            <AmountPicker
              format={format}
              value={rub}
              onChange={setRub}
              label={event.type === 'rebuy' ? 'Ребай' : 'Вход'}
              note={
                current && 'rub' in current
                  ? `В записи сейчас ${formatRub(current.rub)}.`
                  : undefined
              }
              disabled={sending}
            />
            {paid && changed && (
              <p className="m-small">
                Оплата, записанная вместе с этой записью ({formatRub(paidAmount(paid))}), не
                меняется — расчёт сам покажет, кто кому должен.
              </p>
            )}
            <p className="m-small">
              Запись останется на своём месте в журнале — пересчитаются фонд, фишки, призовые и
              взнос игрока.
            </p>
          </>
        )}
        {evening.status === 'settled' && (
          <p className="m-small">
            Расчёт вечера закрыт — правка откроет его, закрыть нужно будет заново.
          </p>
        )}
        {/* Правду этой строки держит canAmend: правку, которая сдвинула бы места или сняла
            завершение, он не пропускает (amendImpact). */}
        {(evening.status === 'finished' || evening.status === 'settled') && (
          <p className="m-small">Вечер завершён: места и победитель не изменятся.</p>
        )}
      </div>
    </Sheet>
  );
}
