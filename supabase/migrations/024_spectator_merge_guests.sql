-- 024: режим «болельщик» и слияние гостя с гостем (аудит 07.10.2026, «Следующий шаг», п. 10).
-- 1) players.is_spectator — «слежу, не играю». null — человек ещё не отвечал на вопрос «Играешь или
--    следишь?» (главная задаёт его один раз) и считается игроком; false — играет; true — болельщик.
--    Болельщик не стоит в «Без ответа», не упоминается в посте дня игры, не входит в кандидаты прогноза
--    и в «кто может прийти» у «На кону», но видит всё и сам делает прогнозы. На вечер, где он ответил
--    «иду» / «под вопросом» или сидит за столом (действующий join), он игрок — это правило чтения
--    (spectatesEvening в domain/spectators.ts), сам флаг от него не меняется: отмена ответа или входа
--    возвращает всё как было, в следующий вечер человек снова болельщик.
--    Свой флаг игрок меняет только RPC set_my_spectator: политики players пускают в update одного
--    админа, а политика «своя строка» открыла бы игроку и is_admin (права authenticated на players
--    выданы на таблицу целиком, 002). Админ меняет флаг формой «Игроки» (upsert под RLS, как is_active).
--    Backfill: кто уже сыграл настоящий вечер (действующий join не на тренировке) — false, вопрос ему не
--    нужен. seed.sql заливается после миграций и повторяет это у себя.
-- 2) merge_guests / merge_guests_preview — слияние двух профилей без Telegram (дубль гостя: банкир
--    вписал имя заново вместо того, чтобы выбрать прошлого гостя). Всё дубля переходит к профилю,
--    который оставляют, дубль удаляется. Перенос, препятствия и проверка остатков ссылок — те же, что у
--    merge_players (миграции 008, 010, 016, 017): общая часть вынесена в private.merge_report_body и
--    private.merge_move, merge_players_report и merge_players пересозданы на них — поведение и тексты
--    не меняются (их держат supabase/tests/008, 010, 016, 017 и scripts/check-merge-replay.mjs).
--
-- Гранты: новая колонка — права на players выданы на таблицу целиком (002, 011), отдельный грант не
-- нужен. Функции — явно; служебные private.* — revoke у public/anon/authenticated.

-- ---------------------------------------------------------------------------
-- 1. Болельщик
-- ---------------------------------------------------------------------------
alter table public.players add column is_spectator boolean;

comment on column public.players.is_spectator is
  'Болельщик: «слежу, не играю» (true) — не в «Без ответа» и без упоминаний в посте дня игры, на вечер с ответом «иду»/«под вопросом» или входом за стол — игрок; false — играет; null — ещё не выбирал (считается игроком, главная спрашивает). Свой меняет set_my_spectator, чужой — админ. Миграция 024.';

update public.players p
set is_spectator = false
where not p.is_guest
  and p.is_spectator is null
  and exists (
    select 1
    from public.evening_events ee
    join public.evenings e on e.id = ee.evening_id
    where ee.type = 'join'
      and ee.voided_at is null
      and ee.payload ->> 'playerId' = p.id::text
      and not e.is_training);

-- Свой флаг: true — болельщик, false — играю. null не принимается: «не выбирал» — только до первого
-- ответа. Возвращает сохранённое значение.
create function public.set_my_spectator(p_spectator boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_player();
begin
  if p_spectator is null then
    raise exception 'Выбери: играешь или следишь за игрой'
      using errcode = '22023';
  end if;
  update public.players set is_spectator = p_spectator where id = v_me;
  return p_spectator;
end;
$$;

comment on function public.set_my_spectator(boolean) is
  'Игрок: свой режим — true «слежу, не играю» (болельщик), false «играю». Миграция 024.';

revoke execute on function public.set_my_spectator(boolean) from public, anon, authenticated;
grant execute on function public.set_my_spectator(boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Слияние: общая часть отчёта
-- ---------------------------------------------------------------------------
-- Препятствия и счётчики переноса для пары «кого удаляем → куда переносим» (тело из 017 без проверки
-- аргументов: её делает обёртка своего вида). p_kind — 'telegram' (merge_players: гость → профиль с
-- Telegram) или 'guest' (merge_guests: дубль → профиль без Telegram); от вида зависят только тексты
-- двух препятствий. Игроки уже проверены обёрткой: оба есть, это разные люди.
create function private.merge_report_body(p_guest uuid, p_target uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guest    public.players;
  v_target   public.players;
  v_g        text := p_guest::text;
  v_t        text := p_target::text;
  v_blockers text[] := '{}';
  v_row      record;
  v_cat      jsonb := '{"hand": "«Рука вечера»", "bluff": "«Блеф вечера»", "badbeat": "«Бэд-бит вечера»"}';
begin
  select p.* into v_guest from public.players p where p.id = p_guest;
  select p.* into v_target from public.players p where p.id = p_target;

  -- Оба в действующих записях одного журнала: после слияния один человек сыграл бы за двоих
  -- (два входа, вылет от самого себя) — это не перенос, а порча вечера. Чаще всего это значит,
  -- что выбран не тот профиль: совет об этом — первым, правка журнала — только если гостя вписали
  -- по ошибке (у дубля — посадили дважды).
  for v_row in
    with refs as (
      select ee.evening_id, ee.payload ->> 'playerId' as pid
      from public.evening_events ee
      where ee.voided_at is null
        and ee.payload ? 'playerId'
      union
      select ee.evening_id, b.value
      from public.evening_events ee
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(ee.payload -> 'by') = 'array' then ee.payload -> 'by'
             else '[]'::jsonb end) as b(value)
      where ee.voided_at is null
      union
      select ee.evening_id, h.value ->> 'playerId'
      from public.evening_events ee
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(ee.payload -> 'hands') = 'array' then ee.payload -> 'hands'
             else '[]'::jsonb end) as h(value)
      where ee.voided_at is null
    )
    select e.scheduled_at
    from public.evenings e
    where exists (select 1 from refs r where r.evening_id = e.id and r.pid = v_g)
      and exists (select 1 from refs r where r.evening_id = e.id and r.pid = v_t)
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || case p_kind
      when 'guest' then format(
        'Оба есть в журнале вечера %s — похоже, это разные люди. Выбери другой профиль или, если одного человека посадили дважды, сначала отмени лишние записи в журнале этого вечера.',
        private.club_date_text(v_row.scheduled_at))
      else format(
        'Оба есть в журнале вечера %s — похоже, это разные люди. Выбери другой профиль или, если гостя вписали по ошибке, отмени его записи в журнале этого вечера.',
        private.club_date_text(v_row.scheduled_at))
    end;
  end loop;

  for v_row in
    select e.scheduled_at
    from public.rsvps g
    join public.rsvps t on t.evening_id = g.evening_id and t.player_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.player_id = p_guest
      and g.status <> t.status
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба ответили на анонс вечера %s, и ответы разные.', private.club_date_text(v_row.scheduled_at));
  end loop;

  -- Прогнозы сравниваем уже с подменой гостя на профиль.
  for v_row in
    select e.scheduled_at
    from public.predictions g
    join public.predictions t on t.evening_id = g.evening_id and t.player_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.player_id = p_guest
      and ((case when g.winner_id = p_guest then p_target else g.winner_id end)
             is distinct from (case when t.winner_id = p_guest then p_target else t.winner_id end)
        or (case when g.first_out_id = p_guest then p_target else g.first_out_id end)
             is distinct from (case when t.first_out_id = p_guest then p_target else t.first_out_id end))
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'Оба сделали прогноз на вечер %s, и прогнозы разные.', private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at, g.category
    from public.votes g
    join public.votes t
      on t.evening_id = g.evening_id and t.category = g.category and t.voter_id = p_target
    join public.evenings e on e.id = g.evening_id
    where g.voter_id = p_guest
      and (g.nominee_id is distinct from t.nominee_id
           or g.caption is distinct from t.caption
           or g.photo_path is distinct from t.photo_path)
    order by e.scheduled_at, g.category
  loop
    v_blockers := v_blockers || format(
      'Оба голосовали в номинации %s вечера %s, и голоса разные.',
      v_cat ->> v_row.category, private.club_date_text(v_row.scheduled_at));
  end loop;

  for v_row in
    select e.scheduled_at
    from public.votes v
    join public.evenings e on e.id = v.evening_id
    where (v.voter_id = p_guest and v.nominee_id = p_target)
       or (v.voter_id = p_target and v.nominee_id = p_guest)
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'В вечере %s один из них голосовал за другого — после слияния это был бы голос за себя.',
      private.club_date_text(v_row.scheduled_at));
  end loop;

  -- Фото голосов остаются в папке гостя {вечер}/{гость}/ (объекты Storage SQL не переносит).
  -- После закрытия голосования это ничего не ломает; пока оно открыто, профиль не смог бы
  -- переголосовать с этим фото (cast_vote принимает только свою папку).
  for v_row in
    select e.scheduled_at
    from public.votes v
    join public.evenings e on e.id = v.evening_id
    where v.voter_id = p_guest
      and v.photo_path is not null
      and (e.voting_closes_at is null or e.voting_closes_at > now())
    order by e.scheduled_at
  loop
    v_blockers := v_blockers || format(
      'У гостя есть фото к голосу за вечер %s, а голосование ещё идёт. %s после его закрытия.',
      private.club_date_text(v_row.scheduled_at),
      case p_kind when 'guest' then 'Объедини' else 'Привяжи' end);
  end loop;

  return jsonb_build_object(
    'guest', jsonb_build_object('id', v_guest.id, 'name', v_guest.display_name),
    'target', jsonb_build_object('id', v_target.id, 'name', v_target.display_name),
    -- Сыгранные вечера: есть действующий join гостя.
    'evenings', (
      select count(distinct ee.evening_id)
      from public.evening_events ee
      where ee.type = 'join' and ee.voided_at is null and ee.payload ->> 'playerId' = v_g),
    'events', (
      select count(*)
      from public.evening_events ee
      where private.payload_mentions_player(ee.payload, v_g)),
    'votesReceived', (select count(*) from public.votes v where v.nominee_id = p_guest),
    'votesCast', (select count(*) from public.votes v where v.voter_id = p_guest),
    'predictionsAbout', (
      select count(*) from public.predictions p
      where p.winner_id = p_guest or p.first_out_id = p_guest),
    'predictionsMade', (select count(*) from public.predictions p where p.player_id = p_guest),
    'rsvps', (select count(*) from public.rsvps r where r.player_id = p_guest),
    'bankerOf', (select count(*) from public.evenings e where e.banker_id = p_guest),
    'photosKept', (
      select count(*) from public.votes v where v.voter_id = p_guest and v.photo_path is not null),
    'blockers', to_jsonb(v_blockers));
end;
$$;

revoke execute on function private.merge_report_body(uuid, uuid, text) from public, anon, authenticated;

-- Тело из 017: проверка аргументов вида «гость → Telegram-профиль», дальше — общая часть.
create or replace function private.merge_players_report(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guest  public.players;
  v_target public.players;
begin
  if p_guest is null or p_target is null then
    raise exception 'Выбери гостя и Telegram-профиль'
      using errcode = '22023';
  end if;
  if p_guest = p_target then
    raise exception 'Это один и тот же игрок'
      using errcode = '22023';
  end if;

  select p.* into v_guest from public.players p where p.id = p_guest;
  if not found then
    raise exception 'Гость не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  select p.* into v_target from public.players p where p.id = p_target;
  if not found then
    raise exception 'Telegram-профиль не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  if v_guest.tg_id is not null or v_guest.auth_user_id is not null then
    raise exception '«%» входит через Telegram — привязать можно только профиль без Telegram',
      v_guest.display_name
      using errcode = '22023';
  end if;
  if v_target.tg_id is null then
    raise exception 'У «%» нет Telegram — выбери профиль, который входит через Telegram',
      v_target.display_name
      using errcode = '22023';
  end if;

  return private.merge_report_body(p_guest, p_target, 'telegram');
end;
$$;

-- Отчёт слияния дублей: оба — профили без Telegram (гость или сделанный постоянным: войти ни один не
-- может). Сверх общей части — что станет с профилем, который оставляют: постоянным (дубль был
-- постоянным игроком) и включённым (дубль был включён) — см. merge_guests.
create function private.merge_guests_report(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_guest  public.players;
  v_target public.players;
begin
  if p_guest is null or p_target is null then
    raise exception 'Выбери оба профиля: дубль и тот, который оставить'
      using errcode = '22023';
  end if;
  if p_guest = p_target then
    raise exception 'Это один и тот же игрок'
      using errcode = '22023';
  end if;

  select p.* into v_guest from public.players p where p.id = p_guest;
  if not found then
    raise exception 'Дубль не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  select p.* into v_target from public.players p where p.id = p_target;
  if not found then
    raise exception 'Профиль, который оставить, не найден — обнови список игроков'
      using errcode = '22023';
  end if;
  if v_guest.tg_id is not null or v_guest.auth_user_id is not null then
    raise exception '«%» входит через Telegram — объединять можно только профили без Telegram',
      v_guest.display_name
      using errcode = '22023';
  end if;
  if v_target.tg_id is not null or v_target.auth_user_id is not null then
    raise exception '«%» входит через Telegram — чтобы перенести на него записи гостя, открой гостя и нажми «Привязать к Telegram»',
      v_target.display_name
      using errcode = '22023';
  end if;

  return private.merge_report_body(p_guest, p_target, 'guest')
    || jsonb_build_object(
         'becomesPermanent', v_target.is_guest and not v_guest.is_guest,
         'becomesActive', not v_target.is_active and v_guest.is_active);
end;
$$;

revoke execute on function private.merge_guests_report(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Слияние: общий перенос
-- ---------------------------------------------------------------------------
-- Всё, что ссылается на p_guest, — на p_target (тело из 017 без флагов, проверки и удаления: их
-- делает обёртка). Вызывающий держит блокировку вечеров и обоих игроков и уже проверил препятствия.
create function private.merge_move(p_guest uuid, p_target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_g    text := p_guest::text;
begin
  -- Журнал: playerId, элементы by (вылет и правка вылета, 022) и игроки рук олл-ина (017) — точной
  -- заменой значения; created_by / voided_by. voided_at не трогаем — триггер «правка открывает
  -- расчёт» не срабатывает: итог вечера тот же.
  update public.evening_events ee
  set payload = private.payload_replace_player(ee.payload, p_guest, p_target)
  where private.payload_mentions_player(ee.payload, v_g);
  update public.evening_events set created_by = p_target where created_by = p_guest;
  update public.evening_events set voided_by = p_target where voided_by = p_guest;

  update public.evenings set banker_id = p_target where banker_id = p_guest;
  update public.evenings set created_by = p_target where created_by = p_guest;

  -- rsvps и predictions: удалить и вставить заново, а не update — триггер updated_at переписал бы
  -- время ответа (по нему идёт порядок «кто ответил раньше»). Совпадающие строки профиля уже есть
  -- (препятствия гарантируют, что они равны) — on conflict do nothing.
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from public.rsvps r where r.player_id = p_guest;
  delete from public.rsvps r where r.player_id = p_guest;
  insert into public.rsvps (evening_id, player_id, status, updated_at)
  select x.evening_id, p_target, x.status, x.updated_at
  from jsonb_populate_recordset(null::public.rsvps, v_rows) as x
  on conflict (evening_id, player_id) do nothing;

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_rows
  from public.predictions p
  where p.player_id = p_guest or p.winner_id = p_guest or p.first_out_id = p_guest;
  delete from public.predictions p
  where p.player_id = p_guest or p.winner_id = p_guest or p.first_out_id = p_guest;
  insert into public.predictions (evening_id, player_id, winner_id, first_out_id, updated_at)
  select x.evening_id,
         case when x.player_id = p_guest then p_target else x.player_id end,
         case when x.winner_id = p_guest then p_target else x.winner_id end,
         case when x.first_out_id = p_guest then p_target else x.first_out_id end,
         x.updated_at
  from jsonb_populate_recordset(null::public.predictions, v_rows) as x
  on conflict (evening_id, player_id) do nothing;

  -- Голоса: тем же приёмом (check voter <> nominee проверяется уже на итоговых строках).
  -- photo_path не меняется: файл остаётся в папке гостя, см. merge_report_body.
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into v_rows
  from public.votes v where v.voter_id = p_guest or v.nominee_id = p_guest;
  delete from public.votes v where v.voter_id = p_guest or v.nominee_id = p_guest;
  insert into public.votes (evening_id, voter_id, category, nominee_id, caption, photo_path, created_at)
  select x.evening_id,
         case when x.voter_id = p_guest then p_target else x.voter_id end,
         x.category,
         case when x.nominee_id = p_guest then p_target else x.nominee_id end,
         x.caption, x.photo_path, x.created_at
  from jsonb_populate_recordset(null::public.votes, v_rows) as x
  on conflict (evening_id, voter_id, category) do nothing;

  -- Имя для озвучки (016): своё у профиля важнее; нет своего — переходит имя гостя (гость
  -- удаляется вместе с ним, а латинское имя профиля голос не прочитает).
  update public.players t
  set spoken_name = g.spoken_name
  from public.players g
  where t.id = p_target
    and g.id = p_guest
    and t.spoken_name is null
    and g.spoken_name is not null;
end;
$$;

revoke execute on function private.merge_move(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. merge_players (гость → Telegram-профиль) на общих частях
-- ---------------------------------------------------------------------------
-- Тело из 017; перенос — private.merge_move. Поведение и тексты те же.
create or replace function public.merge_players(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_left   text[];
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Связывать игроков может только админ'
      using errcode = '42501';
  end if;

  -- Все вечера под блокировкой — тот же порядок, что у add_event/void_event (сначала вечер):
  -- параллельная запись в журнал дождётся слияния и увидит уже перенесённые id.
  perform 1 from public.evenings e order by e.id for update;
  perform 1 from public.players p where p.id in (p_guest, p_target) order by p.id for update;

  v_report := private.merge_players_report(p_guest, p_target);
  if jsonb_array_length(v_report -> 'blockers') > 0 then
    raise exception 'Привязать профиль «%» к профилю «%» нельзя: %',
      v_report #>> '{guest,name}', v_report #>> '{target,name}',
      (select string_agg(b.value, ' ') from jsonb_array_elements_text(v_report -> 'blockers') as b(value))
      using errcode = 'P0001';
  end if;

  perform private.merge_move(p_guest, p_target);
  update public.players set is_guest = false where id = p_target;

  -- Все внешние ключи на players — on delete cascade или set null: забытая ссылка не уронила бы
  -- удаление, а тихо стёрла бы или обнулила данные гостя. Поэтому проверяем явно: осталась
  -- ссылка (новая таблица, которую не добавили в перенос) — отказ, всё слияние откатывается.
  v_left := private.player_references(p_guest);
  if cardinality(v_left) > 0 then
    raise exception 'Привязать профиль «%» к профилю «%» не получилось: перенос не учёл записи в %. Ничего не изменилось. Это ошибка приложения — перешли этот текст разработчику.',
      v_report #>> '{guest,name}', v_report #>> '{target,name}', array_to_string(v_left, ', ')
      using errcode = 'XX000';
  end if;
  delete from public.players where id = p_guest;

  return v_report;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. merge_guests (дубль → профиль без Telegram)
-- ---------------------------------------------------------------------------
-- Предпросмотр для подтверждения в админке: что перенесётся и что мешает. Только админ.
create function public.merge_guests_preview(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Объединять игроков может только админ'
      using errcode = '42501';
  end if;
  return private.merge_guests_report(p_guest, p_target);
end;
$$;

-- Слияние дублей: всё p_guest — на p_target, p_guest удаляется. Атомарно; при препятствии — P0001 с
-- перечнем причин, ничего не меняется. Имя (display_name) остаётся у p_target. Флаги p_target:
-- постоянный, если постоянным был хоть один (решение админа «он ходит регулярно» не теряется);
-- включён, если включён хоть один; имя для озвучки и режим болельщика — свои, а нет своих — дубля.
-- Возвращает отчёт, как merge_guests_preview.
create function public.merge_guests(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report jsonb;
  v_left   text[];
begin
  perform private.require_player();
  if not public.is_admin() then
    raise exception 'Объединять игроков может только админ'
      using errcode = '42501';
  end if;

  perform 1 from public.evenings e order by e.id for update;
  perform 1 from public.players p where p.id in (p_guest, p_target) order by p.id for update;

  v_report := private.merge_guests_report(p_guest, p_target);
  if jsonb_array_length(v_report -> 'blockers') > 0 then
    raise exception 'Объединить профиль «%» с профилем «%» нельзя: %',
      v_report #>> '{guest,name}', v_report #>> '{target,name}',
      (select string_agg(b.value, ' ') from jsonb_array_elements_text(v_report -> 'blockers') as b(value))
      using errcode = 'P0001';
  end if;

  perform private.merge_move(p_guest, p_target);
  update public.players t
  set is_guest = t.is_guest and g.is_guest,
      is_active = t.is_active or g.is_active,
      is_spectator = coalesce(t.is_spectator, g.is_spectator)
  from public.players g
  where t.id = p_target
    and g.id = p_guest;

  v_left := private.player_references(p_guest);
  if cardinality(v_left) > 0 then
    raise exception 'Объединить профиль «%» с профилем «%» не получилось: перенос не учёл записи в %. Ничего не изменилось. Это ошибка приложения — перешли этот текст разработчику.',
      v_report #>> '{guest,name}', v_report #>> '{target,name}', array_to_string(v_left, ', ')
      using errcode = 'XX000';
  end if;
  delete from public.players where id = p_guest;

  return v_report;
end;
$$;

comment on function public.merge_guests(uuid, uuid) is
  'Админ: перенести всё дубля (профиль без Telegram) на другой профиль без Telegram и удалить дубль. Миграция 024.';
comment on function public.merge_guests_preview(uuid, uuid) is
  'Админ: что перенесёт merge_guests и что ему мешает (blockers), что станет с флагами профиля. Ничего не меняет. Миграция 024.';

revoke execute on function
  public.merge_guests(uuid, uuid),
  public.merge_guests_preview(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.merge_guests(uuid, uuid),
  public.merge_guests_preview(uuid, uuid)
  to authenticated, service_role;
