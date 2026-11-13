-- 日拾 · 使用情况统计（只统计数量，不读取任何任务、复盘的具体内容）
-- 用法：Supabase 控制台 → SQL Editor → New query → 粘贴全部内容 → Run
-- 每位用户一行，用编号代替账号；最后一行是合计

with rows as (
  select user_id, type, data, deleted, updated_at
  from public.items
  where not deleted
),
per_user as (
  select
    user_id,
    min(updated_at)::date                                                         as 首次使用,
    max(updated_at)::date                                                         as 最近使用,
    count(distinct data->>'date') filter (where type in ('dtask', 'review'))      as 有记录的天数,
    count(*) filter (where type = 'dtask' and data->>'fixedId' is null)           as 临时任务数,
    count(*) filter (where type = 'dtask' and data->>'fixedId' is null
                     and (data->>'done')::boolean)                                as 临时任务完成数,
    count(*) filter (where type = 'dtask' and data->>'fixedId' is not null
                     and (data->>'done')::boolean)                                as 固定任务打卡次数,
    count(*) filter (where type = 'fixed')                                        as 每周固定任务数,
    count(*) filter (where type = 'deadline')                                     as 截止任务数,
    count(*) filter (where type = 'review')                                       as 复盘篇数,
    count(*) filter (where type = 'note')                                         as 小记条数
  from rows
  group by user_id
)
select
  '用户 ' || row_number() over (order by 首次使用)::text as 用户,
  首次使用, 最近使用, (最近使用 - 首次使用 + 1) as 跨度天数, 有记录的天数,
  临时任务数, 临时任务完成数,
  case when 临时任务数 > 0 then round(100.0 * 临时任务完成数 / 临时任务数, 1) end as 临时任务完成率,
  固定任务打卡次数, 每周固定任务数, 截止任务数, 复盘篇数, 小记条数
from per_user
union all
select
  '合计（' || count(*) || ' 人）', min(首次使用), max(最近使用), max(最近使用) - min(首次使用) + 1, sum(有记录的天数),
  sum(临时任务数), sum(临时任务完成数),
  round(100.0 * sum(临时任务完成数) / nullif(sum(临时任务数), 0), 1),
  sum(固定任务打卡次数), sum(每周固定任务数), sum(截止任务数), sum(复盘篇数), sum(小记条数)
from per_user;
