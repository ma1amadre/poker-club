// «В клубе»: лента последних событий клуба — итоги вечеров, ачивки, смена званий, моменты
// голосования с фото и рекорды. События и их порядок — домен (clubEvents + clubMoments) по уже
// загруженной истории; здесь только подписи (feed.ts) и строки списка.
import { clubEvents, clubMoments, mergeFeed, momentItems } from '@domain/feed.ts';
import { useMemo, useState } from 'react';
import {
  clubFeedInput,
  gameNoOf,
  momentsNowMs,
  useVotePhotoUrl,
  type ClubHistory,
  type Player,
} from '../../shared/api';
import { paths } from '../../shared/lib';
import { ButtonLink, Icon, List, ListItem, Section, Skeleton } from '../../shared/ui';
import { FEED_LIMIT, feedRows, type FeedRow } from './feed';

export interface FeedSectionProps {
  history: ClubHistory;
  me: Player;
  playersById: ReadonlyMap<string, Player>;
  nowMs: number;
}

export function FeedSection({ history, me, playersById, nowMs }: FeedSectionProps) {
  const input = useMemo(() => clubFeedInput(history), [history]);
  // Итоги, ачивки, звания и рекорды от «сейчас» не зависят — один раз на историю: titleChanges
  // считает звания на каждом префиксе истории, на каждом минутном тике это было бы заметно.
  const events = useMemo(() => clubEvents(input), [input]);
  // Моменты — по голосованиям, закрытым к загрузке истории: позже в кеше только свои голоса.
  // Закрывшееся голосование подтянет перезапрос истории (useClubHistory).
  const momentsNow = momentsNowMs(history, nowMs);
  const moments = useMemo(
    () => momentItems(clubMoments(input, { nowMs: momentsNow })),
    [input, momentsNow],
  );
  // Без limit: Немезиды и сезонные ачивки склеиваются в строку, и только потом лента обрезается.
  const items = useMemo(() => mergeFeed(events, moments), [events, moments]);
  const eveningDates = useMemo(
    () => new Map(history.evenings.map((e) => [e.id, e.scheduled_at])),
    [history],
  );
  // Вторая игра дня (миграция 026) — «вчера · игра 2».
  const eveningGames = useMemo(
    () => new Map(history.evenings.map((e) => [e.id, gameNoOf(e)])),
    [history],
  );

  if (items.length === 0) {
    return (
      <Section title="В клубе">
        <p className="m-small">
          Лента оживёт после первого вечера: здесь появятся итоги игр, ачивки, моменты голосования и
          рекорды клуба.
        </p>
      </Section>
    );
  }

  const rows = feedRows(
    items,
    { names: playersById, meId: me.id, nowMs, eveningDates, eveningGames },
    FEED_LIMIT,
  );
  return (
    <Section title="В клубе">
      <List aria-label="События клуба">
        {rows.map((row) => (
          <ListItem
            key={row.id}
            className="home-feed__item"
            before={<Icon name={row.icon} size={20} className="home-feed__icon" />}
            title={row.title}
            subtitle={<FeedDetails row={row} />}
            to={row.to}
          />
        ))}
      </List>
      <div className="home-actions">
        <ButtonLink size="sm" variant="ghost" iconAfter="arrow-right" to={paths.history}>
          Вся история
        </ButtonLink>
      </div>
    </Section>
  );
}

function FeedDetails({ row }: { row: FeedRow }) {
  return (
    <>
      <span className="home-feed__line">{row.subtitle}</span>
      {row.caption && <span className="home-feed__caption">«{row.caption}»</span>}
      {row.photoPath && <FeedPhoto path={row.photoPath} alt={row.photoAlt ?? 'Фото к голосу'} />}
    </>
  );
}

/**
 * Превью фото момента: подписанная ссылка из приватного бакета, на время загрузки — Skeleton того
 * же размера. Фото удалили или ссылка не открылась — превью просто нет: подпись и так видна.
 */
function FeedPhoto({ path, alt }: { path: string; alt: string }) {
  const url = useVotePhotoUrl(path);
  const [broken, setBroken] = useState<string | null>(null);
  if (url.isPending) {
    return (
      <span className="home-feed__photo" aria-busy="true" aria-label="Загрузка фото">
        <Skeleton height={72} />
      </span>
    );
  }
  if (url.isError || !url.data || broken === url.data) return null;
  return (
    <img
      className="home-feed__photo"
      src={url.data}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(url.data)}
    />
  );
}
