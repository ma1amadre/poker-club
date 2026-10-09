// Общие куски экранов вечера: формат турнира, список игроков, «Ты за столом», лента событий.
import type { EveningState, EventType, PlayerState, TournamentFormat } from '@domain/types.ts';
import { useState } from 'react';
import type { EveningEventRecord, Player } from '../../shared/api';
import {
  formatBlinds,
  formatNumber,
  formatRub,
  formatTime,
  NBSP,
  paths,
  plural,
  pluralWithNumber,
} from '../../shared/lib';
import {
  Accordion,
  Avatar,
  Badge,
  Button,
  Card,
  DataTable,
  Icon,
  List,
  ListItem,
  Notice,
  Section,
  type IconName,
} from '../../shared/ui';
import {
  describeEvent,
  describeTrigger,
  feedEvents,
  orderedPlayers,
  playerLine,
  type FeedContext,
  type MySeat,
  type NameOf,
} from './lib';

// --- Связь -----------------------------------------------------------------------------------

/** Фоновый перезапрос не удался: данные на экране — на момент последней загрузки. */
export function StaleNotice({ updatedAt, onRetry }: { updatedAt: number; onRetry: () => void }) {
  return (
    <Notice
      tone="caution"
      title={`Нет связи · данные на ${formatTime(updatedAt)}`}
      action={
        <Button size="sm" icon="refresh-cw" onClick={onRetry}>
          Обновить
        </Button>
      }
    >
      Записи, сделанные с этого экрана, уже на сервере. Экран обновится сам, когда связь вернётся.
    </Notice>
  );
}

// --- Формат ----------------------------------------------------------------------------------

function rebuyText(format: TournamentFormat): string {
  const until =
    format.rebuyUntilLevel >= format.levels.length
      ? 'всю игру'
      : `до конца ${format.rebuyUntilLevel}-го уровня`;
  const limit =
    format.rebuyLimit === null
      ? 'без лимита'
      : `не больше ${pluralWithNumber(format.rebuyLimit, ['ребая', 'ребаев', 'ребаев'])}`;
  return `${until}, ${limit}`;
}

function levelsText(format: TournamentFormat): string {
  const count = pluralWithNumber(format.levels.length, ['уровень', 'уровня', 'уровней']);
  const first = format.levels[0];
  if (!first) return count;
  const same = format.levels.every((l) => describeTrigger(l) === describeTrigger(first));
  return same ? `${count} по${NBSP}${describeTrigger(first)}` : count;
}

/** Формат вечера: взнос, фишки, ребаи, призовые и блайнды по уровням. */
export function FormatSummary({ format }: { format: TournamentFormat }) {
  const facts: [string, string][] = [
    [
      'Взнос',
      `${formatRub(format.buyInRub)} · ${formatNumber(format.startingChips)}${NBSP}${plural(format.startingChips, ['фишка', 'фишки', 'фишек'])}`,
    ],
    ['Ребаи', rebuyText(format)],
    ['Призовые', `${format.payoutPct.join(' / ')}${NBSP}%`],
    ['Уровни', levelsText(format)],
  ];
  return (
    <Section title="Формат" aside={format.name}>
      <Card>
        <dl className="ev-facts">
          {facts.map(([label, value]) => (
            <div key={label} className="ev-facts__row">
              <dt className="m-small">{label}</dt>
              <dd className="m-body">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Accordion
        headingLevel="h3"
        items={[
          {
            id: 'levels',
            title: 'Блайнды по уровням',
            content: (
              <DataTable
                caption="Уровни турнира"
                columns={[
                  { key: 'n', label: '№', numeric: true },
                  { key: 'blinds', label: 'Блайнды', numeric: true },
                  { key: 'trigger', label: 'Длится' },
                ]}
                rows={format.levels.map((level, index) => ({
                  id: index,
                  n: String(index + 1),
                  blinds: formatBlinds(level),
                  trigger: describeTrigger(level),
                }))}
              />
            ),
          },
        ]}
      />
    </Section>
  );
}

// --- Игроки ----------------------------------------------------------------------------------

export interface PlayersListProps {
  state: EveningState;
  /** Формат вечера: взнос игрока при кратных входах (playerLine). */
  format: TournamentFormat;
  nameOf: NameOf;
  playersById: Map<string, Player>;
  /** Строка-кнопка: пульт игрока у банкира. */
  onSelect?: (player: PlayerState) => void;
  /** Строка-ссылка в карточку игрока — у того, кто не ведёт пульт (onSelect важнее). */
  linkPlayers?: boolean;
  /** Свой id: у своей строки — «(ты)». */
  meId?: string | null;
  /** Шеврон у строки-кнопки (переход). false — строка открывает действие, а не экран. */
  chevron?: boolean;
  label?: string;
}

/** Игроки вечера строками: живые по входу, затем вылетевшие (свежие выше), после finish — по местам. */
export function PlayersList({
  state,
  format,
  nameOf,
  playersById,
  onSelect,
  linkPlayers = false,
  meId,
  chevron = true,
  label,
}: PlayersListProps) {
  const rows = orderedPlayers(state);
  return (
    <List aria-label={label ?? 'Игроки вечера'}>
      {rows.map((p) => {
        const info = playersById.get(p.playerId);
        const line = playerLine(p, format);
        return (
          <ListItem
            key={p.playerId}
            before={<Avatar name={nameOf(p.playerId)} photoUrl={info?.photo_url} size="lg" />}
            title={
              <>
                <span className="ui-name">{nameOf(p.playerId)}</span>
                {p.playerId === meId && (
                  <>
                    {' '}
                    <span className="ui-me-tag">ты</span>
                  </>
                )}
                {info?.is_guest && <span className="m-small"> · гость</span>}
              </>
            }
            subtitle={line || undefined}
            after={
              p.alive ? (
                <Badge tone="positive" dot>
                  {state.timer.status === 'not_started' && !state.finished ? 'За столом' : 'В игре'}
                </Badge>
              ) : (
                <Badge tone="neutral">Вне игры</Badge>
              )
            }
            onClick={onSelect ? () => onSelect(p) : undefined}
            to={!onSelect && linkPlayers ? paths.player(p.playerId) : undefined}
            chevron={onSelect ? chevron : linkPlayers}
          />
        );
      })}
    </List>
  );
}

// --- Ты за столом ----------------------------------------------------------------------------

/**
 * «Ты за столом» — вверху экрана идущего вечера у игрока, который не ведёт пульт: статус и
 * сколько ещё можно докупиться, входы и взнос, нокауты, баланс с банкиром прямо сейчас (mySeat).
 */
export function MySeatCard({ seat }: { seat: MySeat }) {
  return (
    <Card>
      <div className="ev-me">
        <div className="ev-me__head">
          <p className="m-eyebrow">Ты за столом</p>
          {seat.alive ? (
            <Badge tone="positive" dot>
              В игре
            </Badge>
          ) : (
            <Badge tone="neutral">Вне игры</Badge>
          )}
        </div>
        {(seat.rebuyNote ?? seat.place) && (
          <p className="m-body ev-me__status">{seat.rebuyNote ?? seat.place}</p>
        )}
        <ul className="ev-factlist">
          <li>
            <Icon name="coins" size={16} />
            <span>{seat.entries}</span>
          </li>
          <li>
            <Icon name="user-x" size={16} />
            <span>{seat.kos}</span>
          </li>
          <li>
            <Icon name="wallet" size={16} />
            <span>
              {seat.balance}
              {seat.paid && <span className="ev-me__muted"> · {seat.paid}</span>}
            </span>
          </li>
        </ul>
      </div>
    </Card>
  );
}

// --- Лента -----------------------------------------------------------------------------------

const EVENT_ICON: Record<EventType, IconName> = {
  join: 'user-plus',
  rebuy: 'refresh-cw',
  bust: 'user-x',
  timer_start: 'play',
  timer_pause: 'pause',
  timer_resume: 'play',
  level_next: 'skip-forward',
  level_prev: 'skip-back',
  hand: 'layers',
  payment: 'wallet',
  finish: 'flag',
  showdown: 'eye',
  showdown_close: 'eye',
  amend: 'pencil',
  time_adjust: 'clock',
};

export function EventIcon({ type }: { type: EventType }) {
  return (
    <span className={type === 'bust' ? 'ev-feed-icon ev-feed-icon--bust' : 'ev-feed-icon'}>
      <Icon name={EVENT_ICON[type]} size={16} />
    </span>
  );
}

export interface EventRowProps {
  event: EveningEventRecord;
  nameOf: NameOf;
  /** Формат вечера: сумма кратного входа или ребая в подписи. */
  format: TournamentFormat;
  /** Текст ошибки replay: событие записано, но не принято (например, ребай после закрытия). */
  error?: string;
  /**
   * Нажатие на запись (строка становится кнопкой; у отменённых — нет): у входа, ребая и вылета —
   * шторка «Изменить запись» (правка на месте, 022), у остальных — подтверждение отмены.
   */
  onSelect?: (event: EveningEventRecord) => void;
  /** Запись можно исправить (шеврон у строки: откроется шторка, а не вопрос). */
  editable?: boolean;
  /** Как журнал применил записи: исправленная запись — с правкой в силе (миграция 022). */
  feed?: FeedContext;
}

/** Строка журнала: что случилось, кто, когда; отменённые — зачёркнуты и с пометкой. */
export function EventRow({
  event,
  nameOf,
  format,
  error,
  onSelect,
  editable = false,
  feed,
}: EventRowProps) {
  const line = describeEvent(event, nameOf, formatRub, format, feed);
  const subtitle = [line.detail, error ? `не принято: ${error}` : null].filter(Boolean).join(' · ');
  return (
    <ListItem
      // Строка лога, как на холсте «Терминала»: время · вид записи (иконка) · текст.
      before={
        <span className="ev-row-before">
          <span className="m-mono ev-row-time">{formatTime(event.at)}</span>
          <EventIcon type={event.type} />
        </span>
      }
      title={event.voided ? <span className="ev-voided">{line.title}</span> : line.title}
      subtitle={subtitle || undefined}
      after={
        event.voided ? (
          <Badge tone="neutral">Отменено</Badge>
        ) : error ? (
          <Badge tone="caution">Не принято</Badge>
        ) : undefined
      }
      onClick={onSelect && !event.voided ? () => onSelect(event) : undefined}
      chevron={Boolean(onSelect) && editable && !event.voided}
    />
  );
}

export interface EventFeedProps {
  events: readonly EveningEventRecord[];
  nameOf: NameOf;
  format: TournamentFormat;
  errorsById: Map<number, string>;
  /** Нажатие на запись: правка (вход, ребай, вылет) или отмена — решает экран. */
  onSelect?: (event: EveningEventRecord) => void;
  /** Можно ли исправить запись на месте (шеврон и подпись под лентой). */
  canEdit?: (event: EveningEventRecord) => boolean;
  /** Контекст ленты (feedContext): исправленные записи и правки (миграция 022). */
  feed?: FeedContext;
  title?: string;
  /** Сколько строк показать до «Показать всю ленту». */
  limit?: number;
}

/** Лента вечера от новых к старым, без платежей (они на экране расчёта). */
export function EventFeed({
  events,
  nameOf,
  format,
  errorsById,
  onSelect,
  canEdit,
  feed: context,
  title = 'Лента',
  limit = 12,
}: EventFeedProps) {
  const [expanded, setExpanded] = useState(false);
  const feed = feedEvents(events);
  const shown = expanded ? feed : feed.slice(0, limit);
  if (feed.length === 0) return null;
  return (
    <Section
      title={title}
      aside={pluralWithNumber(feed.length, ['запись', 'записи', 'записей'])}
      footer={
        onSelect
          ? canEdit
            ? 'Нажми на запись, чтобы отменить её. Вход, ребай и вылет можно исправить на месте.'
            : 'Чтобы отменить запись, нажми на неё.'
          : undefined
      }
    >
      <List aria-label={title}>
        {shown.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            nameOf={nameOf}
            format={format}
            error={errorsById.get(event.id)}
            onSelect={onSelect}
            editable={canEdit?.(event) ?? false}
            feed={context}
          />
        ))}
      </List>
      {feed.length > shown.length && (
        <Button variant="ghost" icon="chevron-down" onClick={() => setExpanded(true)}>
          Показать всю ленту
        </Button>
      )}
    </Section>
  );
}
