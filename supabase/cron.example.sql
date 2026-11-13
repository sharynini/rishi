-- 日拾 · 每分钟调用一次推送函数（模板）
-- 把 <PROJECT_REF> 换成你的 Supabase 项目 ID，<CRON_SECRET> 换成在 Edge Functions → Secrets 里设置的同一个值，
-- 然后在 SQL Editor 运行。⚠️ 填好真实值的版本不要提交到 git（.gitignore 已忽略 supabase/cron.sql）
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('send-reminders') where exists (select 1 from cron.job where jobname = 'send-reminders');

select cron.schedule(
  'send-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);
