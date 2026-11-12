-- 日拾 · 云端更新脚本（注销账户功能）
-- 已经运行过 supabase.sql 的话，只需要再运行这一个文件：
-- Supabase 控制台 → SQL Editor → New query → 粘贴全部内容 → Run

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
