// Шторка «кто за столом»: отметить пришедших (на старте) или опоздавшего (по ходу игры) и вписать
// гостя без Telegram. Каждый выбранный игрок — отдельный join; гость — RPC add_guest (сразу с join).
// Кратность входа (×1 по умолчанию) — одна на всех, кого сажают этим нажатием, и на гостя: кто
// входит на другую сумму, того сажают отдельно. После гостя кратность возвращается к ×1 — иначе
// выбранная для него сумма молча досталась бы всем отмеченным; при ×k сумма видна на кнопке.
import { entryAmounts } from '@domain/money.ts';
import { useState } from 'react';
import { RSVP_STATUS_META, useAddGuest, usePlayers, type Rsvp } from '../../shared/api';
import { formatRub, pluralWithNumber } from '../../shared/lib';
import { Button, Field, PlayerPicker, Sheet, useToast } from '../../shared/ui';
import { entryPayload, normalizeGuestName, seatButtonLabel, seatCandidates } from './lib';
import { StacksPicker } from './StacksPicker';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

export interface SeatSheetProps {
  open: boolean;
  onClose: () => void;
  model: EveningModel;
  actions: EveningActions;
  rsvps: readonly Rsvp[];
  /** start — отметка пришедших до старта, late — опоздавший во время игры. */
  mode: 'start' | 'late';
}

export function SeatSheet(props: SeatSheetProps) {
  // Внутренняя часть монтируется заново при каждом открытии: выбор предзаполняется свежими RSVP.
  return props.open ? <SeatSheetInner {...props} /> : null;
}

function SeatSheetInner({ onClose, model, actions, rsvps, mode }: SeatSheetProps) {
  const { data: players = [] } = usePlayers();
  const toast = useToast();
  const addGuest = useAddGuest(model.evening.id);
  const candidates = seatCandidates(players, model.state, rsvps);

  const [selected, setSelected] = useState<string[]>(() =>
    mode === 'start' ? candidates.filter((c) => c.rsvp === 'yes').map((c) => c.player.id) : [],
  );
  const [guestName, setGuestName] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);
  const [seating, setSeating] = useState(false);
  const [stacks, setStacks] = useState(1);
  const entryRub = entryAmounts(model.evening.format, stacks).rub;

  // Регистрация открыта? Проверяем доменом на «новом» игроке — тот же canApply, что у join.
  const closedReason = actions.check(
    'join',
    entryPayload('00000000-0000-4000-8000-000000000000', stacks),
  );

  const hints = Object.fromEntries(
    candidates.map((c) => [
      c.player.id,
      [
        c.player.is_guest ? 'гость' : null,
        c.rsvp ? RSVP_STATUS_META[c.rsvp].other.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ]),
  );

  const seat = async () => {
    setSeating(true);
    let seated = 0;
    for (const id of selected) {
      // Состояние в замыкании не знает о только что записанных join — сервер и replay проверят.
      const record = await actions.send('join', entryPayload(id, stacks));
      if (!record) break;
      seated += 1;
    }
    setSeating(false);
    if (seated > 0) {
      toast.show(
        `За стол ${seated === 1 ? 'сел' : 'сели'} ${pluralWithNumber(seated, ['игрок', 'игрока', 'игроков'])}`,
        {
          tone: 'positive',
          detail:
            stacks > 1
              ? `${seated === 1 ? 'Вход' : 'Вход у каждого'} — ${formatRub(entryRub)}.`
              : undefined,
        },
      );
    }
    if (seated === selected.length) onClose();
    else setSelected(selected.slice(seated));
  };

  const submitGuest = async () => {
    const name = normalizeGuestName(guestName);
    if (!name) {
      setGuestError('Имя гостя — от 1 до 40 символов. Впиши, как его зовут за столом.');
      return;
    }
    setGuestError(null);
    try {
      await addGuest.mutateAsync({ name, stacks });
      setGuestName('');
      setStacks(1);
      toast.show(`Гость ${name} за столом`, {
        tone: 'positive',
        detail: stacks > 1 ? `Вход — ${formatRub(entryRub)}.` : undefined,
      });
    } catch {
      // тост с причиной показал глобальный обработчик мутаций
    }
  };

  const busy = seating || addGuest.isPending;

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      title={mode === 'start' ? 'Кто пришёл' : 'Опоздавший игрок'}
      description={
        closedReason ??
        (mode === 'start'
          ? 'Ответившие «иду» уже отмечены. Сними отметку с тех, кто не пришёл.'
          : 'Опоздавший входит с полным стеком, пока открыта регистрация.')
      }
      actions={
        <Button
          variant="primary"
          block
          icon="user-plus"
          loading={seating}
          disabled={selected.length === 0 || Boolean(closedReason) || addGuest.isPending}
          onClick={() => void seat()}
        >
          {seatButtonLabel(selected.length, model.evening.format, stacks)}
        </Button>
      }
    >
      <div className="ev-sheet-body">
        <StacksPicker
          format={model.evening.format}
          value={stacks}
          onChange={setStacks}
          label="Вход"
          note="Сумма — для всех отмеченных и для гостя; кто входит на другую, того посади отдельно."
          disabled={Boolean(closedReason) || busy}
        />
        {candidates.length > 0 ? (
          <PlayerPicker
            label="Игроки клуба"
            players={candidates.map((c) => c.player)}
            value={selected}
            onChange={setSelected}
            max={Number.POSITIVE_INFINITY}
            hints={hints}
          />
        ) : (
          <p className="m-small">Все игроки клуба уже за столом. Гостя можно вписать ниже.</p>
        )}
        <form
          className="ev-guest"
          onSubmit={(event) => {
            event.preventDefault();
            void submitGuest();
          }}
        >
          <Field
            label="Гость без Telegram"
            placeholder="Вова"
            maxLength={60}
            autoComplete="off"
            value={guestName}
            error={guestError ?? undefined}
            hint={
              guestError
                ? undefined
                : 'В рейтинг не попадает, пока админ не сделает его постоянным.'
            }
            onChange={(event) => setGuestName(event.target.value)}
            disabled={Boolean(closedReason) || busy}
          />
          <Button
            type="submit"
            icon="plus"
            loading={addGuest.isPending}
            disabled={Boolean(closedReason) || seating}
          >
            Добавить гостя
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
