// Действия пульта, общие для обоих видов («Стол» и «Подробно»): завершить вечер, уровень вперёд с
// переспросами, отменить последнее. Перенесены из LiveView без изменения поведения.
// Тренировка (миграция 023): после финиша итог в группу не уходит и голосования нет — вопрос об этом
// говорит прямо, notify не вызывается.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  isTrainingEvening,
  notifyEveningFinished,
  type EveningEventRecord,
} from '../../shared/api';
import { joinNames, paths } from '../../shared/lib';
import { useToast } from '../../shared/ui';
import {
  lastUndoable,
  levelEdgeLeftMs,
  levelMovedText,
  levelNextClosesRebuys,
  rebuysClosingText,
  rebuyText,
  rebuyWindow,
} from './lib';
import type { EveningActions } from './useEveningActions';
import type { EveningModel } from './useEveningModel';

/** Ближе к авто-переходу «Уровень вперёд» переспрашивает (сеть + расхождение часов). */
const LEVEL_EDGE_MS = 5000;

export interface Pult {
  /** Единственный живой (можно завершать) или undefined. */
  lastAlive: string | undefined;
  /** Ребаи ещё открыты: финиш их закроет — не главное действие. */
  rebuysStillOpen: boolean;
  finishing: boolean;
  finish: () => Promise<void>;
  levelNext: () => Promise<void>;
  /** Последняя неотменённая игровая запись (платежи — в расчёте). */
  undoTarget: EveningEventRecord | null;
  undoLast: () => void;
}

export function usePult(model: EveningModel, actions: EveningActions): Pult {
  const { evening, state, nameOf, events } = model;
  const format = evening.format;
  const navigate = useNavigate();
  const toast = useToast();
  const [finishing, setFinishing] = useState(false);

  const win = rebuyWindow(format, state);
  const lastAlive =
    state.aliveCount === 1 ? state.joinOrder.find((id) => state.players[id]?.alive) : undefined;
  // Один живой при открытых ребаях — обычно ненадолго: вылетевшие сейчас докупятся. Финиш тогда
  // не главное действие, а подтверждение прямо говорит, что ребаи закроются.
  const rebuysStillOpen = win.kind !== 'closed';
  const bustedNames = state.joinOrder.filter((id) => !state.players[id]?.alive).map(nameOf);
  const undoTarget = lastUndoable(events);

  const finish = async () => {
    const winner = lastAlive ? nameOf(lastAlive) : 'последний игрок';
    const rebuyWarning = rebuysStillOpen
      ? ` ${rebuyText(win)}: после завершения ${bustedNames.length > 0 ? `${joinNames(bustedNames)} не ${bustedNames.length > 1 ? 'смогут' : 'сможет'} докупиться` : 'докупиться будет нельзя'}.`
      : '';
    const training = isTrainingEvening(evening);
    const after = training
      ? 'Места и деньги зафиксируются. Это тренировка: голосования и поста в группе не будет.'
      : 'Места, очки и деньги зафиксируются, откроется голосование на 24 часа, итог уйдёт в группу.';
    const ok = await actions.confirm({
      title: training ? 'Завершить тренировку?' : 'Завершить вечер?',
      message: `Победитель — ${winner}.${rebuyWarning} ${after} Вернуть вечер в игру после этого сможет только админ.`,
      confirmText: 'Завершить вечер',
      cancelText: 'Продолжить игру',
    });
    if (!ok) return;
    setFinishing(true);
    const record = await actions.send('finish');
    if (!record) {
      setFinishing(false);
      return;
    }
    if (training) {
      setFinishing(false);
      navigate(paths.settle(evening.id));
      return;
    }
    try {
      const outcome = await notifyEveningFinished(evening.id);
      if (outcome === 'already_posted') {
        toast.show('Итог уже был в группе', {
          detail: 'Новый пост не отправлен. Исправленный итог админ публикует с экрана вечера.',
        });
      }
    } catch {
      // Пост в группу не должен мешать расчёту: если не ушёл сейчас, его добьёт cron-tick.
      toast.show('Итог не ушёл в группу', {
        tone: 'caution',
        detail: 'Бот отправит его сам в течение 15 минут.',
      });
    }
    setFinishing(false);
    navigate(paths.settle(evening.id));
  };

  // «Уровень вперёд» за секунды до авто-перехода: запрос придёт на сервер уже на следующем уровне,
  // и replay переключит ещё раз — уровень пропустится. Переход, который закроет ребаи, переспрашиваем
  // всегда: ошибочный тап меняет деньги вечера, а «Уровень назад» начнёт уровень с нуля.
  // Вопрос может висеть долго: уровень за это время сменится сам (время, вылет, раздача с другого
  // устройства). Поэтому после ответа — свежее состояние: уровень сменился — запись не уходит
  // (guard в send), до авто-перехода остались секунды — ещё вопрос о краю уровня.
  const confirmEdge = (leftMs: number) =>
    actions.confirm({
      title: 'Уровень и так сейчас сменится',
      message: `До конца уровня ${Math.max(1, Math.ceil(leftMs / 1000))} с — он сменится сам. Если перейти вручную, запись может прийти уже на следующем уровне, и он пропустится.`,
      confirmText: 'Всё равно перейти',
      cancelText: 'Подождать',
    });

  const levelNext = async () => {
    const before = actions.freshState();
    const from = before.timer.levelIndex;
    const left = levelEdgeLeftMs(before, LEVEL_EDGE_MS);
    const closes = levelNextClosesRebuys(format, before);
    if (left !== null) {
      if (!(await confirmEdge(left))) return;
    } else if (closes) {
      const ok = await actions.confirm({
        title: `Перейти на ${from + 2}-й уровень?`,
        message: `${rebuysClosingText(closes.busted.map(nameOf))} Ошибочный переход отменяется кнопкой «Отменить» в тосте.`,
        confirmText: 'Перейти и закрыть ребаи',
        cancelText: 'Остаться на уровне',
      });
      if (!ok) return;
      const after = actions.freshState();
      const leftNow = levelMovedText(from, after) ? null : levelEdgeLeftMs(after, LEVEL_EDGE_MS);
      if (leftNow !== null && !(await confirmEdge(leftNow))) return;
    }
    void actions.send(
      'level_next',
      {},
      { success: 'Уровень вперёд', undo: true, guard: (fresh) => levelMovedText(from, fresh) },
    );
  };

  const undoLast = () => {
    if (undoTarget) void actions.voidWithConfirm(undoTarget);
  };

  return {
    lastAlive,
    rebuysStillOpen,
    finishing,
    finish,
    levelNext,
    undoTarget,
    undoLast,
  };
}
