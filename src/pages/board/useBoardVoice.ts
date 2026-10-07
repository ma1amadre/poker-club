// Голос табло: включение по нажатию, предзагрузка клипов вечера, объявления по детектору.
//
// - Включение — только нажатием (браузер не даёт звук без жеста). Что голос был включён, табло
//   помнит в localStorage (удобство: после перезагрузки хватает любого нажатия пульта); пусто или
//   хранилище недоступно — голос выключен. Нажатие самой кнопки голоса будит звук в press, а не в
//   общем обработчике: иначе к click звук уже играл бы, и press принял бы нажатие за «выключить».
// - Клипы: всё, что табло может сказать на этом вечере (eveningVoiceTexts: формат вечера и имена
//   игроков из board_state), хешируется и подгружается RPC board_voice_clips пачками, пока голос
//   включён (ClipLoader). Новые игроки — дозагрузка; не озвученные ещё фразы перепроверяются раз в
//   5 минут (генератор могли запустить вручную), упавший запрос — не раньше чем через 30 с.
// - Объявления — voiceStep по кадрам раз в секунду; первый кадр — точка отсчёта, так что история
//   вечера при открытии не зачитывается. Пока голос выключен, кадры и память сказанного идут, но
//   в очередь ничего не попадает — после включения звучит только новое.
import {
  announcementVariants,
  clipHash,
  eveningVoiceTexts,
  normalizeSpeech,
  speakableName,
  VOICE_ID,
} from '@domain/voice.ts';
import type { EveningEvent, EveningState } from '@domain/types.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchVoiceClips, VOICE_CLIPS_CHUNK, type BoardState } from '../../shared/api';
import { voiceFrame, voiceStep, type VoiceFrame } from './announcer';
import { ClipLoader } from './clipLoader';
import { base64Bytes, isVoiceToggleGesture, VoicePlayer, voiceSupported } from './voicePlayer';

const PREF_KEY = 'poker-club:board-voice';
/** Как часто проверять, не пора ли догрузить клипы (повторы — по срокам ClipLoader). */
const LOAD_CHECK_MS = 5_000;

function readPref(): boolean {
  try {
    return window.localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

function writePref(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Приватное окно или запрет хранилища — просто не запомним.
  }
}

export type VoiceStatus = 'unsupported' | 'off' | 'needs_tap' | 'on';

export interface BoardVoice {
  /** off — выключен; needs_tap — включён, но браузер ждёт нажатия; on — говорит. */
  status: VoiceStatus;
  /** Сколько нужных этому вечеру фраз ещё не озвучено (нет в базе). */
  missing: number;
  /** Нажатие кнопки: включить (и разбудить звук) или выключить. */
  press: () => void;
}

interface Args {
  token: string;
  data: BoardState;
  state: EveningState;
  applied: readonly EveningEvent[];
  nowMs: number;
}

export function useBoardVoice({ token, data, state, applied, nowMs }: Args): BoardVoice {
  const [supported] = useState(voiceSupported);
  const [enabled, setEnabled] = useState(() => supported && readPref());
  // Играет ли AudioContext (жест получен) — VoicePlayer сообщает о смене состояния.
  const [running, setRunning] = useState(false);
  const playerRef = useRef<VoicePlayer | null>(null);
  const getPlayer = useCallback(() => {
    playerRef.current ??= new VoicePlayer(() => setRunning(playerRef.current?.running ?? false));
    return playerRef.current;
  }, []);

  useEffect(
    () => () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    },
    [],
  );

  // Голос включён с прошлого раза: пробуем разбудить звук сразу, иначе — первым нажатием пульта.
  // Нажатие кнопки голоса пропускаем: её решение (включить или выключить) — в press.
  useEffect(() => {
    if (!enabled) return;
    const player = getPlayer();
    if (!player.running) player.unlock();
    const onGesture = (event: Event) => {
      if (!player.running && !isVoiceToggleGesture(event.target)) player.unlock();
    };
    document.addEventListener('pointerdown', onGesture);
    document.addEventListener('keydown', onGesture);
    return () => {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
  }, [enabled, getPlayer]);

  // --- Что может понадобиться: тексты → хеши --------------------------------------------------
  const names = useMemo(
    () => new Map(data.players.map((p) => [p.id, speakableName(p)])),
    [data.players],
  );
  const texts = useMemo(
    () => eveningVoiceTexts(data.format, [...names.values()]),
    [data.format, names],
  );
  // Опрос раз в 3 с приносит новый JSON — сравниваем по содержимому, а не по ссылке.
  const textsKey = texts.join('\n');
  const hashOf = useRef(new Map<string, string>());
  const [hashVersion, setHashVersion] = useState(0);
  useEffect(() => {
    if (!supported) return;
    const todo = textsKey.split('\n').filter((t) => t !== '' && !hashOf.current.has(t));
    if (todo.length === 0) return;
    let cancelled = false;
    void Promise.all(todo.map(async (t) => [t, await clipHash(t, VOICE_ID)] as const)).then(
      (pairs) => {
        if (cancelled) return;
        for (const [t, h] of pairs) hashOf.current.set(t, h);
        setHashVersion((v) => v + 1);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [supported, textsKey]);

  // --- Загрузка клипов ------------------------------------------------------------------------
  // Эффект перезапускается при новых текстах и хешах и раз в LOAD_CHECK_MS; что и когда просить
  // (и когда повторять после сбоя), решает ClipLoader. Пока идёт загрузка, новая не начинается —
  // пришедшее за это время подхватит следующая проверка.
  // Загрузчик живёт вместе со своим проигрывателем (StrictMode в dev пересоздаёт проигрыватель).
  const loaderRef = useRef<{ player: VoicePlayer; loader: ClipLoader } | null>(null);
  const [missing, setMissing] = useState(0);
  const loadTick = Math.floor(nowMs / LOAD_CHECK_MS);
  useEffect(() => {
    if (!enabled) return;
    const player = getPlayer();
    if (loaderRef.current?.player !== player)
      loaderRef.current = { player, loader: new ClipLoader(player, base64Bytes) };
    const { loader } = loaderRef.current;
    if (loader.loading) return;
    const hashes = () =>
      textsKey.split('\n').flatMap((t) => {
        const h = hashOf.current.get(t);
        return h ? [h] : [];
      });
    const due = loader.due(hashes(), Date.now());
    if (due.length === 0) return;
    void loader
      .load(due, (chunk) => fetchVoiceClips(token, VOICE_ID, chunk), VOICE_CLIPS_CHUNK, Date.now)
      .then(() => setMissing(loader.missing(hashes())));
  }, [enabled, token, textsKey, hashVersion, loadTick, getPlayer]);

  // --- Объявления -----------------------------------------------------------------------------
  // Шаг детектора — на каждом кадре, и при выключенном голосе: память сказанного (уровень,
  // минута, ребаи) должна идти вместе с вечером.
  const prevFrame = useRef<{ eveningId: string; frame: VoiceFrame } | null>(null);
  useEffect(() => {
    const frame = voiceFrame(data.events, { state, applied }, nowMs);
    const prev = prevFrame.current;
    if (!prev || prev.eveningId !== data.evening.id) {
      prevFrame.current = { eveningId: data.evening.id, frame };
      return;
    }
    const { say, frame: next } = voiceStep(data.format, prev.frame, frame);
    prevFrame.current = { eveningId: data.evening.id, frame: next };
    const player = playerRef.current;
    if (!enabled || !player?.running) return;
    const hashFor = (text: string) => hashOf.current.get(normalizeSpeech(text));
    for (const announcement of say) {
      const variants = announcementVariants(announcement, (id) => names.get(id) ?? null);
      for (const clips of variants) {
        const hashes = clips.map(hashFor);
        if (hashes.every((h): h is string => h !== undefined && player.has(h))) {
          player.enqueue(hashes);
          break;
        }
      }
    }
    // state/applied — новый объект на каждый рендер; лишний прогон сравнит одинаковые кадры и
    // промолчит.
  }, [nowMs, data, state, applied, enabled, names]);

  // Выключили — замолчать сразу.
  useEffect(() => {
    if (!enabled) playerRef.current?.stop();
  }, [enabled]);

  // Звук до нажатия: общий обработчик жестов кнопку голоса не будит (isVoiceToggleGesture), так что
  // «играет» здесь значит «играл до нажатия» — то, что видел нажавший на кнопке.
  const press = useCallback(() => {
    if (!supported) return;
    const player = getPlayer();
    if (enabled && player.running) {
      player.stop();
      setEnabled(false);
      writePref(false);
      return;
    }
    player.unlock();
    setEnabled(true);
    writePref(true);
  }, [supported, enabled, getPlayer]);

  const status: VoiceStatus = !supported
    ? 'unsupported'
    : !enabled
      ? 'off'
      : running
        ? 'on'
        : 'needs_tap';
  return { status, missing: enabled ? missing : 0, press };
}
