import { RECORD_META, recordsTable, type ClubRecord, type RecordKind } from '@domain/records.ts';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, paths, recordValueParts } from '../../shared/lib';
import { Empty, Icon, List, type IconName } from '../../shared/ui';
import { playerName, type RatingContext } from './context';
import { recordEmptyText } from './records';

const ICONS: Record<RecordKind, IconName> = {
  biggest_win: 'trending-up',
  most_kos: 'user-x',
  win_streak: 'trophy',
  biggest_pool: 'coins',
  longest_game: 'clock',
};

/**
 * Рекорды клуба (recordsTable домена): пять строк — что, значение, кто и когда. Держатель —
 * ссылка на вечер, где рекорд поставлен; ничья — все держатели, первым установивший раньше.
 */
export function RecordsTab({ ctx }: { ctx: RatingContext }) {
  const { history } = ctx;
  const records = useMemo(
    () => recordsTable(history.summaries, { excluded: history.excluded }),
    [history.summaries, history.excluded],
  );

  if (records.every((r) => r.value === null)) {
    return (
      <div className="rt-panel">
        <Empty
          icon="trending-up"
          title="Рекордов пока нет"
          description="Рекорды появятся после первого завершённого вечера: выигрыш, нокауты, фонд и длина игры."
        />
      </div>
    );
  }

  return (
    <div className="rt-panel">
      <List aria-label="Рекорды клуба">
        {records.map((record) => (
          <RecordRow key={record.kind} ctx={ctx} record={record} />
        ))}
      </List>
      <p className="m-small">
        Рекорды игроков — выигрыш, нокауты и серия побед — только у постоянных игроков клуба, гости
        в них не попадают. Фонд и длина игры — рекорды вечера, в них считаются все вечера. Длина
        игры — чистое время на таймере, без пауз.
      </p>
    </div>
  );
}

function RecordRow({ ctx, record }: { ctx: RatingContext; record: ClubRecord }) {
  const meta = RECORD_META[record.kind];
  const text = record.value === null ? null : recordValueParts(record.kind, record.value);
  const empty = record.value === null;

  return (
    <li className="ui-list-row">
      <div className="ui-list-item rt-rec">
        <span className="ui-list-item__before">
          <Icon
            name={ICONS[record.kind]}
            size={20}
            className={empty ? 'rt-rec__icon rt-rec__icon--empty' : 'rt-rec__icon'}
          />
        </span>
        <div className="rt-rec__body">
          <div className="rt-rec__head">
            <span className={empty ? 'rt-rec__title rt-rec__title--empty' : 'rt-rec__title'}>
              {meta.title}
            </span>
            {text && (
              <span className="rt-rec__value">
                <span className="m-mono rt-rec__num">{text.value}</span>
                {text.unit && <span className="rt-rec__unit">{text.unit}</span>}
              </span>
            )}
          </div>
          {empty ? (
            <span className="rt-rec__empty">{recordEmptyText(record.kind)}</span>
          ) : (
            <ul className="rt-rec__holders" aria-label={`Держатели: ${meta.title.toLowerCase()}`}>
              {record.holders.map((holder) => (
                <li key={`${holder.playerId ?? ''}:${holder.eveningId}`}>
                  <Link to={paths.evening(holder.eveningId)} className="rt-rec__holder">
                    <span className="rt-rec__who">
                      {holder.playerId ? (
                        <>
                          <span className="rt-rec__name">{playerName(ctx, holder.playerId)}</span>
                          <span className="rt-rec__date"> · {formatDate(holder.date)}</span>
                        </>
                      ) : (
                        <span className="rt-rec__name">Вечер {formatDate(holder.date)}</span>
                      )}
                    </span>
                    <Icon name="chevron-right" size={16} className="rt-rec__chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
