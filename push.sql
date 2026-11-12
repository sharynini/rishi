-- 日拾 · 准点推送需要的数据表
-- Supabase 控制台 → SQL Editor → New query → 粘贴全部内容 → Run

-- 每台设备的推送订阅
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tz text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subs read" on public.push_subscriptions;
create policy "own subs read" on public.push_subscriptions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "own subs delete" on public.push_subscriptions;
create policy "own subs delete" on public.push_subscriptions for delete to authenticated using (auth.uid() = user_id);

-- 保存订阅（同一台设备换账号时，订阅归属自动转给新账号）
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_tz text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, tz)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(nullif(p_tz, ''), 'Asia/Shanghai'));
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- 推送记录（防止同一天重复发送），只有服务器能读写
create table if not exists public.push_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);
alter table public.push_log enable row level security;
