-- Проверки миграции 018 (баунти «за голову» убрано) на локальной БД с seed.sql: всё в одной
-- транзакции, в конце rollback — данные не меняются. Любая неудача — exception, psql с
-- ON_ERROR_STOP выходит с кодом 3.
-- Запуск (из корня репозитория, стек поднят):
--   docker exec -i supabase_db_poker-club psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/018_drop_bounty.sql
\set QUIET on
begin;

create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then
    raise exception 'FAIL: %', p_what;
  end if;
  raise notice 'ok: %', p_what;
end;
$$;

-- ===========================================================================
-- 1. После миграций и seed ключа bountyRub нет нигде
-- ===========================================================================
select pg_temp.check(
  not exists (select 1 from public.formats where config ? 'bountyRub'),
  'formats.config без bountyRub');
select pg_temp.check(
  not exists (select 1 from public.evenings where format ? 'bountyRub'),
  'evenings.format без bountyRub (вечера seed в любом статусе)');
select pg_temp.check(
  (select array_agg(k order by k) from public.formats f, jsonb_object_keys(f.config) as k
   where f.id = 'f0000000-0000-4000-8000-000000000001')
    = array['buyInRub', 'levels', 'name', 'payoutPct', 'payoutStepRub', 'rebuyLimit',
            'rebuyUntilLevel', 'startingChips'],
  'клубный формат 011 после 018 и 027 — ровно ключи DEFAULT_FORMAT (027 добавила payoutStepRub)');
select pg_temp.check(
  (select (f.config ->> 'buyInRub')::int = 500 and (f.config ->> 'startingChips')::int = 500
   from public.formats f where f.id = 'f0000000-0000-4000-8000-000000000001'),
  'остальные поля клубного формата на месте');

-- Табло и генератор голоса получают формат без головы.
select pg_temp.check(
  not ((public.board_state(
          (select e.board_token from public.evenings e
           where e.id = 'e0000000-0000-4000-8000-000000000006')) -> 'format') ? 'bountyRub'),
  'board_state отдаёт формат без bountyRub');
select pg_temp.check(
  not exists (
    select 1 from jsonb_array_elements(private.voice_manifest_input() -> 'formats') as f(v)
    where f.v ? 'bountyRub'),
  'voice_manifest_input: форматы без bountyRub');

-- ===========================================================================
-- 2. Операторы 018 на старых данных: чистят только bountyRub, повтор ничего не меняет
-- ===========================================================================
-- Строки, как в базе до 018. Вечер — отменённый и в далёкий день: индекс «один вечер на день»
-- считает только неотменённые.
insert into public.formats (id, name, config) values (
  'f0000000-0000-4000-8000-0000000000aa', 'Старый',
  '{"name": "Старый", "buyInRub": 300, "startingChips": 1000, "bountyRub": 50,
    "rebuyUntilLevel": 3, "rebuyLimit": 1, "payoutPct": [100],
    "levels": [{"sb": 10, "bb": 20, "trigger": {"type": "hands", "count": 5}}]}');
insert into public.evenings (id, scheduled_at, status, format) values (
  'e0000000-0000-4000-8000-0000000000aa', '2027-01-07 16:00:00+00', 'cancelled',
  (select config from public.formats where id = 'f0000000-0000-4000-8000-0000000000aa'));

-- Те же операторы, что в supabase/migrations/018_drop_bounty.sql.
create function pg_temp.drop_bounty() returns int language plpgsql as $$
declare
  v_formats int;
  v_evenings int;
begin
  update public.formats set config = config - 'bountyRub' where config ? 'bountyRub';
  get diagnostics v_formats = row_count;
  update public.evenings set format = format - 'bountyRub' where format ? 'bountyRub';
  get diagnostics v_evenings = row_count;
  return v_formats + v_evenings;
end;
$$;

select pg_temp.check(pg_temp.drop_bounty() = 2, '018 правит формат и снимок вечера с bountyRub');
select pg_temp.check(
  (select config from public.formats where id = 'f0000000-0000-4000-8000-0000000000aa')
    = '{"name": "Старый", "buyInRub": 300, "startingChips": 1000,
        "rebuyUntilLevel": 3, "rebuyLimit": 1, "payoutPct": [100],
        "levels": [{"sb": 10, "bb": 20, "trigger": {"type": "hands", "count": 5}}]}'::jsonb,
  'формат: ушёл только bountyRub');
select pg_temp.check(
  (select format from public.evenings where id = 'e0000000-0000-4000-8000-0000000000aa')
    = (select config from public.formats where id = 'f0000000-0000-4000-8000-0000000000aa'),
  'снимок вечера: ушёл только bountyRub');
select pg_temp.check(pg_temp.drop_bounty() = 0, 'повторный прогон ничего не меняет');

rollback;
