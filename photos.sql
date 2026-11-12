-- 日拾 · 复盘照片的云端存储（Supabase Storage，免费额度：1 GB 存储、每月 5 GB 流量）
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴全部内容 → Run（重复运行也没关系）

-- 1. 私密存储桶：单张最大 2 MB（App 里会先压缩到约 150 KB），只接受图片
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2. 行级安全：每个人只能读、传、改、删自己文件夹（<用户 ID>/）里的照片
drop policy if exists "review photos: select own" on storage.objects;
create policy "review photos: select own" on storage.objects
  for select to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "review photos: insert own" on storage.objects;
create policy "review photos: insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "review photos: update own" on storage.objects;
create policy "review photos: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "review photos: delete own" on storage.objects;
create policy "review photos: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 查看已用空间（可选）：
-- select count(*) as 张数, pg_size_pretty(sum((metadata->>'size')::bigint)) as 已用
-- from storage.objects where bucket_id = 'review-photos';
