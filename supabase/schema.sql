-- 每日打卡 App 的云端数据表
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴全部内容 → Run

create table if not exists public.items (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);

create index if not exists items_user_sync_idx on public.items (user_id, server_updated_at);

-- 每次写入都更新服务器时间，用于多设备增量同步
create or replace function public.items_touch()
returns trigger language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  new.user_id := auth.uid();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
for each row execute function public.items_touch();

-- 行级安全：每个人只能读写自己的数据
alter table public.items enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.items to authenticated;

-- 让已登录的用户删除「自己」的账号；items 表设置了 on delete cascade，账号删除后数据会一起删除
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not logged in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
