// Шторка «кто за столом»: отметить пришедших (на старте) или опоздавшего (по ходу игры) и вписать
// гостя без Telegram. Ответившие «иду», кто ещё не за столом, отмечены заранее на старте, а у
// опоздавшего — только если такой один (seatPreselected): неявившихся банкир уже снимал на старте.
// Каждый выбранный игрок — отдельный join; гость — RPC add_guest (сразу с join). Посадка
// опоздавших — тост с именами и «Отменить» (всё действие: входы и оплата).
// Кратность входа (×1 по умолчанию) — одна на всех, кого сажают этим нажатием, и на гостя: кто
// входит на другую сумму, того сажают отдельно. После гостя кратность возвращается к ×1 — иначе
// выбранная для него сумма молча досталась бы всем отмеченным; при ×k сумма видна на кнопке.
// Гость: повтор после ошибки или тайм-аута уходит с тем же ключом повтора (useAddGuest, миграция
// 019) — второго гостя не будет. Если прошлая попытка дошла и гость уже в журнале, повтор не
// уходит молча новым ключом: «Запись уже в журнале» — не записывать или записать ещё одного
// (confirmIfLanded). Вписанное имя уже есть в клубе — подсказка посадить того же человека одной
// кнопкой, а не заводить дубль.
// «Оплачено сразу» (по умолчанию выключено) — у каждого, кого сажают этим нажатием, и у гостя
// вместе со входом пишется платёж на сумму взноса. Отмеченные садятся одним действием
// (add_events, миграция 020): все входы и платежи ложатся вместе или не ложатся вовсе, повтор после
// тайм-аута — тем же ключом. Гость с оплатой — add_guest с p_paid_rub, тоже одной транзакцией.
import { entryAmounts } from '@domain/money.ts';
import { useState } from 'react';
import {
  guestRetryIntent,
  RSVP_STATUS_META,
  useAddGuest,
  usePlayers,
  type Rsvp,
} from '../../shared/api';
import { formatRub, joinNames, pluralWithNumber } from '../../shared/lib';
import { Button, Field, Notice, PlayerPicker, Sheet, useToast } from '../../shared/ui';
import {
  entryPayload,
  nameMatches,
  nameMatchNotice,
  normalizeGuestName,
  seatButtonLabel,
  seatCandidates,
  seatPreselected,
  seatSpectator,
  seatDrafts,
} from './lib';
import { PaidNowCheckbox, StacksPicker } from './StacksPicker';
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

  // Кандидаты — только кто ещё не за столом: у опоздавшего это «иду» и пока не сел, если он один.
  const preselected = seatPreselected(candidates, mode);
  const [selected, setSelected] = useState<string[]>(() => preselected);
  const [guestName, setGuestName] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);
  const [seating, setSeating] = useState(false);
  const [stacks, setStacks] = useState(1);
  const [paid, setPaid] = useState(false);
  const [seatingMatch, setSeatingMatch] = useState(false);
  // Вопрос «Запись уже в журнале» для гостя: шторка не закрывается, кнопки ждут ответа.
  const [guestAsking, setGuestAsking] = useState(false);
  const format = model.evening.format;
  const entryRub = entryAmounts(format, stacks).rub;
  /** Подробности тоста посадки: сумма при ×k и оплата. */
  const seatDetail = (many: boolean): string | undefined =>
    [
      stacks > 1 ? `${many ? 'Вход у каждого' : 'Вход'} — ${formatRub(entryRub)}.` : null,
      paid ? `Оплачено сразу${many ? ' у каждого' : ''}.` : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const match = nameMatchNotice(nameMatches(players, model.state, guestName));

  // Регистрация открыта? Проверяем доменом на «новом» игроке — тот же canApply, что у join.
  const closedReason = actions.check(
    'join',
    entryPayload('00000000-0000-4000-8000-000000000000', stacks),
  );

  const hints = Object.fromEntries(
    candidates.map((c) => [
      c.player.id,
      [
        c.player.is_guest ? 'гость' : seatSpectator(c) ? 'болельщик' : null,
        c.rsvp ? RSVP_STATUS_META[c.rsvp].other.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ]),
  );

  const seat = async () => {
    setSeating(true);
    // Одно действие: все входы (и платежи, если «Оплачено сразу») — вместе или ничего.
    const seated = selected.length;
    const success = `За стол ${seated === 1 ? 'сел' : 'сели'} ${pluralWithNumber(seated, ['игрок', 'игрока', 'игроков'])}`;
    // Опоздавшие: в тосте — кто сел и «Отменить» (входы и оплата одной отменой): лишняя отметка
    // видна сразу, а не только в ленте.
    const late = mode === 'late';
    const names = `${joinNames(selected.map(model.nameOf))}.`;
    const records = await actions.sendAll(
      seatDrafts(format, selected, stacks, paid),
      late
        ? {
            success,
            detail: [names, seatDetail(seated > 1)].filter(Boolean).join(' '),
            undo: true,
          }
        : {},
    );
    setSeating(false);
    if (!records) return;
    if (!late) toast.show(success, { tone: 'positive', detail: seatDetail(seated > 1) });
    onClose();
  };

  const submitGuest = async () => {
    const name = normalizeGuestName(guestName);
    if (!name) {
      setGuestError('Имя гостя — от 1 до 40 символов. Впиши, как его зовут за столом.');
      return;
    }
    setGuestError(null);
    setGuestAsking(true);
    const paidRub = paid ? entryRub : undefined;
    const landed = await actions.confirmIfLanded(
      guestRetryIntent(model.evening.id, name, stacks, paidRub),
    );
    setGuestAsking(false);
    if (landed) {
      // Гость уже сел прошлым нажатием, банкир не стал заводить второго.
      setGuestName('');
      setStacks(1);
      return;
    }
    try {
      await addGuest.mutateAsync({ name, stacks, paidRub });
      setGuestName('');
      setStacks(1);
      toast.show(`Гость ${name} за столом`, { tone: 'positive', detail: seatDetail(false) });
    } catch {
      // тост с причиной показал глобальный обработчик мутаций
    }
  };

  // Вписанное имя уже есть в клубе: посадить того же человека, а не заводить нового гостя.
  const seatMatch = async (playerId: string) => {
    setSeatingMatch(true);
    const record = paid
      ? await actions.sendAll(seatDrafts(format, [playerId], stacks, true))
      : await actions.send('join', entryPayload(playerId, stacks));
    setSeatingMatch(false);
    if (!record) return;
    const name = players.find((p) => p.id === playerId)?.display_name ?? 'Игрок';
    setGuestName('');
    setStacks(1);
    setSelected((ids) => ids.filter((id) => id !== playerId));
    toast.show(`${name} за столом`, { tone: 'positive', detail: seatDetail(false) });
  };

  const busy = seating || seatingMatch || guestAsking || addGuest.isPending;

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
          : preselected.length > 0
            ? 'Отметка уже стоит у того, кто ответил «иду» и ещё не за столом: пришёл другой — сними её. Опоздавший входит с полным стеком, пока открыта регистрация.'
            : 'Опоздавший входит с полным стеком, пока открыта регистрация.')
      }
      actions={
        <Button
          variant="primary"
          block
          icon="user-plus"
          loading={seating}
          disabled={
            selected.length === 0 ||
            Boolean(closedReason) ||
            addGuest.isPending ||
            seatingMatch ||
            guestAsking
          }
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
          note="Сумма и оплата — для всех отмеченных и для гостя; кто входит иначе, того посади отдельно."
          disabled={Boolean(closedReason) || busy}
        />
        <PaidNowCheckbox
          format={format}
          checked={paid}
          onChange={setPaid}
          kind="entry"
          stacks={stacks}
          many={selected.length > 1}
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
          {match && !closedReason && (
            <Notice
              tone="info"
              title={match.title}
              action={
                match.seat ? (
                  <Button
                    size="sm"
                    icon="user-plus"
                    loading={seatingMatch}
                    disabled={busy}
                    onClick={() => {
                      if (match.seat) void seatMatch(match.seat.playerId);
                    }}
                  >
                    {match.seat.label}
                  </Button>
                ) : undefined
              }
            >
              {match.text}
            </Notice>
          )}
          <Button
            type="submit"
            icon="plus"
            loading={addGuest.isPending}
            disabled={Boolean(closedReason) || seating || seatingMatch || guestAsking}
          >
            Добавить гостя
          </Button>
        </form>
      </div>
    </Sheet>
  );
}
