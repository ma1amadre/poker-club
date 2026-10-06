-- 004_realtime_storage.sql — Realtime-публикация и бакет фото к голосам.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Таблицы попадают в Realtime только явно. postgres_changes отдаёт строку подписчику, только если
-- её пропускает select-политика от его имени, — поэтому подписка без входа ничего не получит,
-- а табло (anon) опрашивает board_state, а не слушает изменения.
-- Публикацию создаёт сам Supabase; create здесь — страховка для чистого Postgres.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime
  add table public.evening_events, public.evenings, public.rsvps;

-- ---------------------------------------------------------------------------
-- Storage: vote-photos
-- ---------------------------------------------------------------------------
-- Приватный: фото видят только участники клуба по подписанной ссылке. Лимиты дублируют сжатие на
-- клиенте (Image Transformations на Free нет, сжимаем сами) — сервер страхует от обхода.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vote-photos', 'vote-photos', false, 2097152, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Путь: {evening_id}/{player_id}/{category}-{random}.jpg
-- foldername(name) = массив папок: [1] — вечер, [2] — игрок.

create policy vote_photos_select_members on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vote-photos'
    and (select public.current_player_id()) is not null);

-- Загрузка только в свою папку и только для существующего вечера.
create policy vote_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vote-photos'
    and (storage.foldername(name))[2] = (select public.current_player_id())::text
    and exists (
      select 1
      from public.evenings e
      where e.id::text = (storage.foldername(name))[1]));

create policy vote_photos_delete_owner_or_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vote-photos'
    and (
      (storage.foldername(name))[2] = (select public.current_player_id())::text
      or (select public.is_admin())));
