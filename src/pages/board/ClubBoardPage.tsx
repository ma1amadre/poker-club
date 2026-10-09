// Табло клуба /tv/:code (миграция 023) — постоянная ссылка для ТВ: её открывают один раз и
// сохраняют в закладки. Вечер выбирает сервер (club_board_state): идущий, итог в пределах 6 ч или
// сегодняшний анонс — тот же экран, что у ссылки вечера (Board), с голосом, олл-ином и отметкой
// «табло на связи». Между вечерами — «Следующая игра» по ближайшему анонсу или расписанию клуба.
// Админ может перевыпустить ссылку: старая сразу показывает «Ссылка табло устарела».
// Регистр — «Терминал» (ThemeScope в routes.tsx), публично и вне AuthProvider, как /board/:token.
import { useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  errorMessage,
  useClubBoardState,
  type BoardSource,
  type ClubBoardState,
} from '../../shared/api';
import {
  CLUB_BOARD_CODE_RE,
  clockOffsetMs,
  formatTime,
  useNow,
  useWakeLock,
} from '../../shared/lib';
import { Badge, Button, Icon, PageSkeleton } from '../../shared/ui';
import { Board, BoardMessage } from './BoardPage';
import { clubIdleView } from './boardView';
import { useFitToScreen } from './fitToScreen';
import { useFullscreen } from './useScreenControls';
import './board.css';

/** Данные старше — «нет связи»: между вечерами опрос раз в 30 с (у табло вечера порог — 10 с). */
const IDLE_STALE_AFTER_MS = 75_000;

export default function ClubBoardPage() {
  const { code } = useParams<{ code: string }>();
  // Обрезанная ссылка — сразу «устарела», без запроса.
  const valid = Boolean(code && CLUB_BOARD_CODE_RE.test(code));
  const query = useClubBoardState(valid ? code : undefined);
  // Стабильный объект: от него зависят загрузка клипов голоса и отметка «на связи».
  const source = useMemo<BoardSource>(() => ({ kind: 'club', code: code ?? '' }), [code]);

  useEffect(() => {
    document.title = 'Табло клуба · Покерный клуб';
  }, []);

  if (valid && query.isPending) return <PageSkeleton label="Загрузка табло" />;
  if (!query.data) {
    if (valid && query.isError) {
      return (
        <BoardMessage
          title="Табло не загрузилось"
          text={`${errorMessage(query.error)} Табло подключится само, как только сервер ответит.`}
          action={
            <Button icon="refresh-cw" onClick={() => void query.refetch()}>
              Подключиться снова
            </Button>
          }
        />
      );
    }
    return (
      <BoardMessage
        title="Ссылка табло устарела"
        text="Админ выпустил новую ссылку табло клуба или эта ссылка обрезана. Новая — в приложении клуба: экран вечера → «Вывести на ТВ»."
      />
    );
  }

  const failing = query.isError || query.fetchStatus === 'paused';
  if (query.data.board) {
    return (
      <Board
        source={source}
        data={query.data.board}
        failing={failing}
        updatedAt={query.dataUpdatedAt}
      />
    );
  }
  return <IdleBoard data={query.data} failing={failing} updatedAt={query.dataUpdatedAt} />;
}

/** Между вечерами: следующая игра крупно, табло переключится само. */
function IdleBoard({
  data,
  failing,
  updatedAt,
}: {
  data: ClubBoardState;
  failing: boolean;
  updatedAt: number;
}) {
  const nowMs = useNow(1000);
  const stale = failing || nowMs - clockOffsetMs() - updatedAt > IDLE_STALE_AFTER_MS;
  const fullscreen = useFullscreen();
  const wake = useWakeLock();
  const view = clubIdleView(data, nowMs);

  const screenRef = useRef<HTMLDivElement>(null);
  useFitToScreen(screenRef, `${view.headline}|${view.when ?? ''}`, '--bd-fit');

  return (
    <main className="bd">
      <header className="bd-head">
        <p className="m-eyebrow">Покерный клуб · табло</p>
        <div className="bd-tools">
          {stale && (
            <Badge tone="caution">
              <Icon name="alert-triangle" size={14} /> Нет связи · данные на {formatTime(updatedAt)}
            </Badge>
          )}
          {fullscreen.supported && (
            <Button size="sm" variant="ghost" icon="tv" onClick={fullscreen.toggle}>
              {fullscreen.active ? 'Выйти из полноэкранного' : 'Во весь экран'}
            </Button>
          )}
        </div>
      </header>

      <div
        ref={screenRef}
        className="bd-wait bd-wait--single bd-screen"
        aria-label="Между вечерами"
      >
        <section className="bd-wait__main">
          <p className="m-eyebrow">{view.eyebrow}</p>
          <div className="bd-lead">
            <h1 className="m-display bd-headline">{view.headline}</h1>
          </div>
          {view.when && <p className="m-h2 bd-hot">{view.when}</p>}
          <p className="m-h3 bd-muted">{view.note}</p>
        </section>
      </div>

      <footer className="bd-foot">
        {wake === 'unsupported' && (
          <p className="m-small bd-muted">
            Этот браузер не умеет держать экран включённым — отключи сон экрана в настройках
            устройства.
          </p>
        )}
      </footer>
    </main>
  );
}
