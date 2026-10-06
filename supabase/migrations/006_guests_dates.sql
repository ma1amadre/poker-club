-- 006_guests_dates.sql — гость «по имени» прямо со стола и один вечер на московский день.
--
-- 1) add_guest: банкир вечера (или админ) на старте или по ходу игры вписывает человека без
--    Telegram. Создаётся игрок is_guest = true и сразу событие join в этот вечер. Права — те же,
--    что у add_event (private.lock_evening_for_write): банкир вечера или админ; после окончания
--    игры — только админ (правка закрытого вечера); в отменённый вечер — никто.
--    insert в players напрямую разрешён только админу (RLS), поэтому отдельная RPC, а не upsert
--    с клиента.
-- 2) Уникальный индекс: два неотменённых вечера на одну дату по Москве — почти всегда ошибка
--    (двойной клик в админке, гонка cron-tick с ручным созданием). Отменённые не мешают:
--    перенос «отменили и создали заново» должен работать.

-- ---------------------------------------------------------------------------
-- add_guest
-- ---------------------------------------------------------------------------
create function public.add_guest(p_evening uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.require_player();
  -- Пробелы схлопываются так же, как в set_my_name.
  v_name  text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_guest uuid;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Имя гостя — от 1 до 40 символов'
      using errcode = '22023';
  end if;

  -- Права и блокировка вечера до создания игрока: без прав не должно остаться «сирот» в players.
  -- (Ошибка ниже всё равно откатила бы транзакцию, но так понятнее и дешевле.)
  perform private.lock_evening_for_write(p_evening, 'join', v_me);

  insert into public.players (display_name, is_guest)
  values (v_name, true)
  returning id into v_guest;

  -- Через add_event, а не прямой insert: одна нормализация payload и одни побочные эффекты
  -- на все join. Блокировка вечера уже наша — повторный for update в той же транзакции не ждёт.
  perform public.add_event(p_evening, 'join', jsonb_build_object('playerId', v_guest));

  return v_guest;
end;
$$;

comment on function public.add_guest(uuid, text) is
  'Банкир/админ: создать гостя (is_guest) и сразу добавить его join в вечер. Возвращает id игрока.';

revoke execute on function public.add_guest(uuid, text) from public, anon, authenticated;
grant execute on function public.add_guest(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Один неотменённый вечер на московскую дату
-- ---------------------------------------------------------------------------
-- timezone(text, timestamptz) с константной зоной immutable, приведение timestamp → date тоже —
-- выражение годится для индекса.
create unique index evenings_one_per_club_day_idx
  on public.evenings (((scheduled_at at time zone 'Europe/Moscow')::date))
  where status <> 'cancelled';
