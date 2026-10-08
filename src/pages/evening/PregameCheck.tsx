// «Проверка перед игрой» у банкира и админа (миграция 023): банкир, связь, живое обновление,
// удержание экрана, табло на связи, имена и фразы озвучены — каждый пункт с подсказкой, как
// исправить. Решения и тексты — чистый pregame.ts; здесь замеры:
// - связь — один server_now с пределом 5 с (pingServer), повтор — «Проверить снова»;
// - живое обновление — состояние канала Realtime журнала этого вечера (useRealtimeStatus);
// - экран — пока проверка на экране (раздел за 3 ч до начала, строка в игре), она сама держит экран
//   (useWakeLock): статус и есть ответ; строка на анонсе раньше экран не держит — пункт ждёт;
// - табло — отметка board_presence этого вечера (табло отмечается раз в 20 с), перечитывается раз в 10 с;
//   до дня игры табло клуба вечер не показывает — пункт ждёт, если отметки нет;
// - голос — какие клипы есть (voice_clips_present, без звука) для имён и фраз этого вечера.
// До старта проверка — разделом на экране вечера за 3 ч до начала (раньше — строкой, раскрывается по
// нажатию); в игре — строкой под пультом, полный список в шторке.
import { clipHash, VOICE_ID } from '@domain/voice.ts';
import { useEffect, useMemo, useState } from 'react';
import {
  eveningRealtimeTopic,
  pingServer,
  useBoardPresence,
  useRealtimeStatus,
  useVoiceClipsPresent,
  type Rsvp,
} from '../../shared/api';
import { moscowDateKey, paths, useNow, useWakeLock } from '../../shared/lib';
import {
  Badge,
  Button,
  ButtonLink,
  Icon,
  List,
  ListItem,
  Section,
  Sheet,
  Spinner,
  type Tone,
} from '../../shared/ui';
import {
  checkInProgress,
  pregameChecks,
  pregamePlayerIds,
  pregameSummary,
  pregameVoicePlan,
  voiceCheckFrom,
  type BoardCheck,
  type CheckItem,
  type CheckStatus,
  type ServerCheck,
  type VoiceCheck,
} from './pregame';
import './pregame.css';
import type { EveningModel } from './useEveningModel';

const STATUS_TONE: Record<CheckStatus, Tone> = {
  ok: 'positive',
  warn: 'caution',
  fail: 'critical',
  wait: 'neutral',
};

/**
 * Сводка по пунктам (используют и строка, и раздел). holdScreen — держать экран (раздел за 3 ч до
 * начала и строка в игре); строка на анонсе раньше экран не держит.
 */
function useChecks(
  model: EveningModel,
  rsvps: readonly Rsvp[],
  attempt: number,
  holdScreen: boolean,
): CheckItem[] {
  const { evening, playersById, state, isAdmin } = model;
  const nowMs = useNow(5000);
  // Табло клуба берёт анонс только в день игры по Москве (private.club_board_evening_id).
  const gameDay =
    evening.status !== 'announced' || moscowDateKey(evening.scheduled_at) === moscowDateKey(nowMs);

  // Связь: замер при показе и по «Проверить снова»; результат прошлой попытки — «проверяем».
  const [measured, setMeasured] = useState<{ attempt: number; check: ServerCheck } | null>(null);
  useEffect(() => {
    let cancelled = false;
    pingServer().then(
      (rttMs) => !cancelled && setMeasured({ attempt, check: { state: 'ok', rttMs } }),
      () => !cancelled && setMeasured({ attempt, check: { state: 'failed' } }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const server: ServerCheck =
    measured && measured.attempt === attempt ? measured.check : { state: 'pending' };

  const realtime = useRealtimeStatus(eveningRealtimeTopic(evening.id));
  // Пока проверка на экране (с 3 ч до начала), она держит экран сама — статус удержания и есть ответ.
  const wake = useWakeLock(holdScreen);

  const presence = useBoardPresence(evening.id);
  const refetchPresence = presence.refetch;
  useEffect(() => {
    if (attempt > 0) void refetchPresence();
  }, [attempt, refetchPresence]);
  const board: BoardCheck = presence.isPending
    ? { state: 'pending' }
    : presence.isError && presence.data === undefined
      ? { state: 'error' }
      : {
          state: 'ready',
          seenAtMs: presence.data ? Date.parse(presence.data.seen_at) : null,
          voiceAtMs: presence.data?.voice_at ? Date.parse(presence.data.voice_at) : null,
        };

  // Голос: имена тех, кто за столом (до старта — и ответивших «иду»), фразы уровней и объявлений.
  const started = evening.status !== 'announced';
  const ids = pregamePlayerIds(state, rsvps, started);
  const idsKey = ids.join(',');
  const plan = useMemo(
    () =>
      pregameVoicePlan(
        evening.format,
        idsKey === ''
          ? []
          : idsKey.split(',').map((id) => ({
              id,
              display_name: playersById.get(id)?.display_name ?? 'Игрок',
              spoken_name: playersById.get(id)?.spoken_name ?? null,
            })),
      ),
    [evening.format, idsKey, playersById],
  );
  const texts = useMemo(
    () => [
      ...new Set([
        ...plan.phrases,
        ...plan.names.flatMap((n) => (n.text === null ? [] : [n.text])),
      ]),
    ],
    [plan],
  );
  const textsKey = texts.join('\n');
  const [hashes, setHashes] = useState<{ key: string; byText: Map<string, string> } | null>(null);
  const [hashFailed, setHashFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const list = textsKey === '' ? [] : textsKey.split('\n');
    Promise.all(list.map(async (t) => [t, await clipHash(t, VOICE_ID)] as const)).then(
      (pairs) => !cancelled && setHashes({ key: textsKey, byText: new Map(pairs) }),
      // crypto.subtle нет (не https) — проверить озвучку нечем.
      () => !cancelled && setHashFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [textsKey]);
  const ready = hashes !== null && hashes.key === textsKey;
  const present = useVoiceClipsPresent(VOICE_ID, ready ? [...hashes.byText.values()] : null);
  const refetchPresent = present.refetch;
  useEffect(() => {
    if (attempt > 0) void refetchPresent();
  }, [attempt, refetchPresent]);
  const voice: VoiceCheck = hashFailed
    ? { state: 'error' }
    : !ready || present.isPending
      ? { state: 'pending' }
      : present.isError && present.data === undefined
        ? { state: 'error' }
        : voiceCheckFrom(plan, (t) => {
            const h = hashes.byText.get(t);
            return h !== undefined && (present.data?.has(h) ?? false);
          });

  const banker = evening.banker_id ? playersById.get(evening.banker_id) : undefined;
  return pregameChecks({
    bankerName: evening.banker_id ? (banker?.display_name ?? 'игрок клуба') : null,
    isAdmin,
    server,
    realtime,
    wake,
    board,
    voice,
    nowMs,
    gameDay,
    holdScreen,
  });
}

function StatusIcon({ status, inProgress }: { status: CheckStatus; inProgress: boolean }) {
  // Крутилка — только пока пункт проверяется; «проверим в день игры» и «некого проверять» — часы.
  if (status === 'wait')
    return inProgress ? <Spinner size={18} label="Проверяем" /> : <Icon name="clock" size={20} />;
  const name =
    status === 'ok' ? 'check-circle' : status === 'warn' ? 'alert-triangle' : 'alert-circle';
  return <Icon name={name} size={20} />;
}

function CheckList({
  items,
  model,
  onTv,
}: {
  items: readonly CheckItem[];
  model: EveningModel;
  onTv: () => void;
}) {
  return (
    <ul className="pg-list" aria-label="Пункты проверки">
      {items.map((item) => (
        <li key={item.key} className={`pg-item pg-item--${item.status}`}>
          <span className="pg-item__icon" aria-hidden={!checkInProgress(item)}>
            <StatusIcon status={item.status} inProgress={checkInProgress(item)} />
          </span>
          <div className="pg-item__body">
            <p className="m-body pg-item__title">{item.title}</p>
            <p className="m-small pg-item__detail">{item.detail}</p>
            {item.hint && <p className="m-small pg-item__hint">{item.hint}</p>}
            {item.key === 'board' && item.status === 'fail' && (
              <div>
                <Button size="sm" icon="tv" onClick={onTv}>
                  Вывести на ТВ
                </Button>
              </div>
            )}
            {item.key === 'banker' && item.status === 'fail' && model.isAdmin && (
              <div>
                <ButtonLink size="sm" to={paths.adminEvening(model.evening.id)}>
                  Назначить банкира
                </ButtonLink>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export interface PregameCheckProps {
  model: EveningModel;
  rsvps: readonly Rsvp[];
  /** Открыть «Вывести на ТВ» (шторка экрана вечера). */
  onTv: () => void;
}

export interface PregameRowProps extends PregameCheckProps {
  /** Держать экран: строка в игре — да, на анонсе раньше чем за 3 ч — нет. */
  holdScreen: boolean;
}

/** Раздел на экране анонса: пункты сразу видны. */
export function PregameSection({ model, rsvps, onTv }: PregameCheckProps) {
  const [attempt, setAttempt] = useState(0);
  const items = useChecks(model, rsvps, attempt, true);
  const summary = pregameSummary(items);
  return (
    <Section
      title="Проверка перед игрой"
      aside={<Badge tone={STATUS_TONE[summary.status]}>{summary.text}</Badge>}
    >
      <CheckList items={items} model={model} onTv={onTv} />
      <div>
        <Button variant="ghost" icon="refresh-cw" onClick={() => setAttempt((n) => n + 1)}>
          Проверить снова
        </Button>
      </div>
    </Section>
  );
}

/**
 * Строка «Проверка перед игрой» со сводкой; нажатие — шторка с пунктами. Пока строка на экране,
 * проверка идёт (связь, табло, озвучка), шторка показывает те же замеры.
 */
export function PregameRow({ model, rsvps, onTv, holdScreen }: PregameRowProps) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const items = useChecks(model, rsvps, attempt, holdScreen);
  const summary = pregameSummary(items);
  return (
    <>
      <List aria-label="Проверка перед игрой">
        <ListItem
          before={<Icon name="shield-check" size={20} />}
          title="Проверка перед игрой"
          subtitle={summary.text}
          after={
            summary.status === 'ok' || summary.status === 'wait' ? undefined : (
              <Badge tone={STATUS_TONE[summary.status]}>
                {summary.status === 'fail' ? 'Есть сбой' : 'Посмотри'}
              </Badge>
            )
          }
          onClick={() => setOpen(true)}
          chevron
        />
      </List>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Проверка перед игрой"
        description="Связь, табло и голос — чтобы за столом ничего не пришлось чинить при всех."
        actions={
          <div className="ev-sheet-actions">
            <Button
              variant="ghost"
              block
              icon="refresh-cw"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Проверить снова
            </Button>
          </div>
        }
      >
        <CheckList
          items={items}
          model={model}
          onTv={() => {
            // Окно поверх шторки «Материя» не допускает: сначала закрыть эту.
            setOpen(false);
            onTv();
          }}
        />
      </Sheet>
    </>
  );
}
