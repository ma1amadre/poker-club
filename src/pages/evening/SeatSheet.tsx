// Шторка «кто за столом»: отметить пришедших (на старте) или опоздавшего (по ходу игры) и вписать
// гостя без Telegram. Ответившие «иду», кто ещё не за столом, отмечены заранее на старте, а у
// опоздавшего — только если такой один (seatPreselected): неявившихся банкир уже снимал на старте.
// Каждый выбранный игрок — отдельный join; гость — RPC add_guest (сразу с join). Посадка
// опоздавших — тост с именами и «Отменить» (всё действие: входы и оплата).
// Сумма входа и «Оплачено сразу» — у каждой строки свои (миграция 027: вход любой суммой): по
// умолчанию — вход формата и без оплаты; сумма меняется в строке («500 ₽» → быстрые кнопки и «Другая
// сумма…»). У гостя — своя сумма и своя оплата в его форме; форму отправляет Enter в поле имени и
// кнопка «Добавить гостя», а Enter («Готово») в поле суммы только прячет клавиатуру (AmountPicker):
// иначе гость сел бы раньше, чем банкир отметит «Оплачено сразу».
// Гость: повтор после ошибки или тайм-аута уходит с тем же ключом повтора (useAddGuest, миграция
// 019) — второго гостя не будет. Если прошлая попытка дошла и гость уже в журнале, повтор не
// уходит молча новым ключом: «Запись уже в журнале» — не записывать или записать ещё одного
// (confirmIfLanded). Вписанное имя уже есть в клубе — подсказка посадить того же человека одной
// кнопкой, а не заводить дубль (с суммой и оплатой из формы гостя).
// «Оплачено сразу» — вместе со входом пишется платёж на сумму этого входа. Отмеченные садятся одним
// действием (add_events, миграция 020): все входы и платежи ложатся вместе или не ложатся вовсе,
// повтор после тайм-аута — тем же ключом. Гость с оплатой — add_guest с p_paid_rub, тоже одной
// транзакцией.
// Игра 2 и дальше (миграция 026): анонса и ответов нет — на старте отмечен состав прошлой игры дня
// (roster, из истории клуба), его игроки первыми в списке с пометкой «в игре 1».
import { entryPayload } from '@domain/money.ts';
import type { TournamentFormat } from '@domain/types.ts';
import { useState } from 'react';
import {
  guestRetryIntent,
  RSVP_STATUS_META,
  useAddGuest,
  usePlayers,
  type Rsvp,
} from '../../shared/api';
import { formatRub, joinNames, pluralWithNumber } from '../../shared/lib';
import { Button, Field, FieldGroup, Notice, PlayerPicker, Sheet, useToast } from '../../shared/ui';
import { AmountPicker, PaidNowCheckbox } from './AmountPicker';
import {
  nameMatches,
  nameMatchNotice,
  normalizeGuestName,
  seatButtonLabel,
  seatCandidates,
  seatDetail,
  seatDrafts,
  seatPreselected,
  seatSpectator,
  type SeatRow,
} from './lib';
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
  /** Состав прошлой игры того же дня (previousGameRoster) — у игры 2 и дальше. */
  roster?: { gameNo: number; playerIds: readonly string[] } | null;
}

export function SeatSheet(props: SeatSheetProps) {
  // Внутренняя часть монтируется заново при каждом открытии: выбор предзаполняется свежими RSVP.
  return props.open ? <SeatSheetInner {...props} /> : null;
}

/** Сумма и оплата строки, пока банкир их не менял. */
type RowSetting = Pick<SeatRow, 'rub' | 'paid'>;

function SeatSheetInner({ onClose, model, actions, rsvps, mode, roster }: SeatSheetProps) {
  const { data: players = [] } = usePlayers();
  const toast = useToast();
  const addGuest = useAddGuest(model.evening.id);
  const rosterIds = roster?.playerIds ?? [];
  const candidates = seatCandidates(players, model.state, rsvps, rosterIds);
  const format = model.evening.format;
  const standard: RowSetting = { rub: format.buyInRub, paid: false };

  // Кандидаты — только кто ещё не за столом: у опоздавшего это «иду» и пока не сел, если он один;
  // у игры 2 на старте — состав прошлой игры дня.
  const preselected = seatPreselected(candidates, mode, rosterIds);
  const [selected, setSelected] = useState<string[]>(() => preselected);
  // Сумма и оплата по игроку: снятая и снова поставленная отметка сохраняет то, что банкир выбрал.
  const [settings, setSettings] = useState<Record<string, RowSetting>>({});
  // Чья сумма сейчас открыта на правку (одна строка за раз).
  const [editing, setEditing] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guest, setGuest] = useState<RowSetting>(standard);
  const [guestEditing, setGuestEditing] = useState(false);
  // Ключ поля суммы гостя: после посадки форма гостя — с чистого листа (вход формата).
  const [guestRound, setGuestRound] = useState(0);
  const [seating, setSeating] = useState(false);
  const [seatingMatch, setSeatingMatch] = useState(false);
  // Вопрос «Запись уже в журнале» для гостя: шторка не закрывается, кнопки ждут ответа.
  const [guestAsking, setGuestAsking] = useState(false);
  const match = nameMatchNotice(nameMatches(players, model.state, guestName));

  const rows: SeatRow[] = selected.map((playerId) => ({
    playerId,
    ...(settings[playerId] ?? standard),
  }));
  const setRow = (playerId: string, patch: Partial<RowSetting>) =>
    setSettings((prev) => ({ ...prev, [playerId]: { ...(prev[playerId] ?? standard), ...patch } }));
  const allPaid = rows.length > 0 && rows.every((r) => r.paid);

  // Регистрация открыта? Проверяем доменом на «новом» игроке — тот же canApply, что у join.
  const closedReason = actions.check(
    'join',
    entryPayload(format, '00000000-0000-4000-8000-000000000000', format.buyInRub),
  );

  const hints = Object.fromEntries(
    candidates.map((c) => [
      c.player.id,
      [
        c.player.is_guest ? 'гость' : seatSpectator(c) ? 'болельщик' : null,
        roster && rosterIds.includes(c.player.id) ? `в игре ${roster.gameNo}` : null,
        c.rsvp ? RSVP_STATUS_META[c.rsvp].other.toLowerCase() : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ]),
  );

  const seat = async () => {
    setSeating(true);
    // Одно действие: все входы (и платежи, у кого «Оплачено сразу») — вместе или ничего.
    const seated = rows.length;
    const success = `За стол ${seated === 1 ? 'сел' : 'сели'} ${pluralWithNumber(seated, ['игрок', 'игрока', 'игроков'])}`;
    const detail = seatDetail(format, rows, model.nameOf);
    // Опоздавшие: в тосте — кто сел и «Отменить» (входы и оплата одной отменой): лишняя отметка
    // видна сразу, а не только в ленте.
    const late = mode === 'late';
    const names = `${joinNames(rows.map((r) => model.nameOf(r.playerId)))}.`;
    const records = await actions.sendAll(
      seatDrafts(format, rows),
      late
        ? {
            success,
            detail: [names, detail].filter(Boolean).join(' '),
            undo: true,
          }
        : {},
    );
    setSeating(false);
    if (!records) return;
    if (!late) toast.show(success, { tone: 'positive', detail });
    onClose();
  };

  /** Форма гостя после посадки — с чистого листа: вход формата, без оплаты. */
  const resetGuest = () => {
    setGuestName('');
    setGuest(standard);
    setGuestEditing(false);
    setGuestRound((n) => n + 1);
  };

  const submitGuest = async () => {
    const name = normalizeGuestName(guestName);
    if (!name) {
      setGuestError('Имя гостя — от 1 до 40 символов. Впиши, как его зовут за столом.');
      return;
    }
    if (guest.rub === null) {
      setGuestEditing(true);
      return;
    }
    setGuestError(null);
    setGuestAsking(true);
    // Стандартный вход уходит без суммы — как все записи до 027 (entryPayload домена).
    const rub = guest.rub === format.buyInRub ? undefined : guest.rub;
    const paidRub = guest.paid ? guest.rub : undefined;
    const landed = await actions.confirmIfLanded(
      guestRetryIntent(model.evening.id, name, rub, paidRub),
    );
    setGuestAsking(false);
    if (landed) {
      // Гость уже сел прошлым нажатием, банкир не стал заводить второго.
      resetGuest();
      return;
    }
    try {
      await addGuest.mutateAsync({ name, rub, paidRub });
      const detail = seatDetail(format, [{ playerId: '', ...guest }], model.nameOf);
      resetGuest();
      toast.show(`Гость ${name} за столом`, { tone: 'positive', detail });
    } catch {
      // тост с причиной показал глобальный обработчик мутаций
    }
  };

  // Вписанное имя уже есть в клубе: посадить того же человека (с суммой и оплатой из формы гостя),
  // а не заводить нового гостя.
  const seatMatch = async (playerId: string) => {
    if (guest.rub === null) {
      setGuestEditing(true);
      return;
    }
    setSeatingMatch(true);
    const row: SeatRow = { playerId, ...guest };
    const record = row.paid
      ? await actions.sendAll(seatDrafts(format, [row]))
      : await actions.send('join', entryPayload(format, playerId, guest.rub));
    setSeatingMatch(false);
    if (!record) return;
    const name = players.find((p) => p.id === playerId)?.display_name ?? 'Игрок';
    const detail = seatDetail(format, [row], model.nameOf);
    resetGuest();
    setSelected((ids) => ids.filter((id) => id !== playerId));
    toast.show(`${name} за столом`, { tone: 'positive', detail });
  };

  const busy = seating || seatingMatch || guestAsking || addGuest.isPending;
  const locked = Boolean(closedReason) || busy;

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      title={mode === 'start' ? 'Кто пришёл' : 'Опоздавший игрок'}
      description={
        closedReason ??
        (mode === 'start'
          ? roster && rosterIds.length > 0
            ? `Игроки игры ${roster.gameNo} уже отмечены. Сними отметку с тех, кто не садится.`
            : 'Ответившие «иду» уже отмечены. Сними отметку с тех, кто не пришёл.'
          : preselected.length > 0
            ? 'Отметка уже стоит у того, кто ответил «иду» и ещё не за столом: пришёл другой — сними её. Опоздавший входит, пока открыта регистрация.'
            : 'Опоздавший входит, пока открыта регистрация.')
      }
      actions={
        <Button
          variant="primary"
          block
          icon="user-plus"
          loading={seating}
          disabled={
            rows.length === 0 ||
            rows.some((r) => r.rub === null) ||
            Boolean(closedReason) ||
            addGuest.isPending ||
            seatingMatch ||
            guestAsking
          }
          onClick={() => void seat()}
        >
          {seatButtonLabel(rows)}
        </Button>
      }
    >
      <div className="ev-sheet-body">
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
        {rows.length > 0 && (
          <FieldGroup
            label="Вход и оплата"
            hint={`Сумма — ${formatRub(format.buyInRub)}, если не менять. «Оплачено сразу» — вместе со входом запишется платёж банкиру на эту сумму.`}
          >
            <ul className="ev-seatrows">
              {rows.map((row) => (
                <SeatRowItem
                  key={row.playerId}
                  format={format}
                  name={model.nameOf(row.playerId)}
                  row={row}
                  editing={editing === row.playerId}
                  onEdit={() => setEditing((id) => (id === row.playerId ? null : row.playerId))}
                  onRub={(rub) => setRow(row.playerId, { rub })}
                  onPaid={(paid) => setRow(row.playerId, { paid })}
                  disabled={locked}
                />
              ))}
            </ul>
            {rows.length > 1 && (
              <Button
                variant="ghost"
                size="sm"
                icon={allPaid ? 'x' : 'check'}
                disabled={locked}
                onClick={() => {
                  for (const r of rows) setRow(r.playerId, { paid: !allPaid });
                }}
              >
                {allPaid ? 'Снять оплату у всех' : 'Оплачено у всех'}
              </Button>
            )}
          </FieldGroup>
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
            disabled={locked}
          />
          <ul className="ev-seatrows ev-seatrows--guest">
            <SeatRowItem
              key={guestRound}
              format={format}
              name={normalizeGuestName(guestName) || 'Гость'}
              row={{ playerId: '', ...guest }}
              editing={guestEditing}
              onEdit={() => setGuestEditing((on) => !on)}
              onRub={(rub) => setGuest((g) => ({ ...g, rub }))}
              onPaid={(paid) => setGuest((g) => ({ ...g, paid }))}
              disabled={locked}
            />
          </ul>
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

/**
 * Строка посадки: имя, сумма кнопкой («500 ₽» — открыть выбор суммы под строкой) и «Оплачено
 * сразу». Неверная сумма в поле — на кнопке «Сумма?», кнопка посадки недоступна.
 */
function SeatRowItem({
  format,
  name,
  row,
  editing,
  onEdit,
  onRub,
  onPaid,
  disabled,
}: {
  format: TournamentFormat;
  name: string;
  row: SeatRow;
  editing: boolean;
  onEdit: () => void;
  onRub: (rub: number | null) => void;
  onPaid: (paid: boolean) => void;
  disabled: boolean;
}) {
  const sum = row.rub === null ? 'Сумма?' : formatRub(row.rub);
  return (
    <li className="ev-seatrow">
      <div className="ev-seatrow__head">
        <span className="ui-name ev-seatrow__name">{name}</span>
        <Button
          className="ev-seatrow__sum"
          iconAfter={editing ? 'chevron-up' : 'chevron-down'}
          aria-expanded={editing}
          aria-label={`Вход: ${name}, ${sum} — изменить сумму`}
          disabled={disabled}
          onClick={onEdit}
        >
          <span className="m-mono">{sum}</span>
        </Button>
      </div>
      {(editing || row.rub === null) && (
        <AmountPicker
          format={format}
          value={row.rub}
          onChange={onRub}
          label={`Вход: ${name}`}
          disabled={disabled}
        />
      )}
      <PaidNowCheckbox
        bare
        checked={row.paid}
        onChange={onPaid}
        kind="entry"
        rub={row.rub}
        disabled={disabled}
      />
    </li>
  );
}
