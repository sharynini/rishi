// 本地数据仓库：离线优先，所有数据存在 localStorage，修改后标记为待同步
import { uid, today, diffDays, addDays, weekdayOf } from './utils.js';

const KEY = 'daily.items.v1';
const DIRTY_KEY = 'daily.dirty.v1';

let items = new Map();   // id -> { id, type, data, updated_at, deleted }
let dirty = new Set();   // 待推送到云端的 id
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    items = new Map(raw.map((it) => [it.id, it]));
    dirty = new Set(JSON.parse(localStorage.getItem(DIRTY_KEY) || '[]'));
  } catch (e) {
    console.warn('读取本地数据失败', e);
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...items.values()]));
      localStorage.setItem(DIRTY_KEY, JSON.stringify([...dirty]));
    } catch (e) {
      console.warn('保存失败', e);
    }
  }, 50);
}

function emit(fromRemote = false) {
  persist();
  listeners.forEach((fn) => fn(fromRemote));
}

export const store = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  all(type) {
    const out = [];
    for (const it of items.values()) {
      if (it.type === type && !it.deleted) out.push({ id: it.id, ...it.data });
    }
    return out;
  },
  get(id) {
    const it = items.get(id);
    return it && !it.deleted ? { id: it.id, ...it.data } : null;
  },

  put(type, data, id = data.id || uid()) {
    const { id: _ignore, ...clean } = data;
    const prev = items.get(id);
    const merged = prev && !prev.deleted ? { ...prev.data, ...clean } : clean;
    items.set(id, { id, type, data: merged, updated_at: new Date().toISOString(), deleted: false });
    dirty.add(id);
    emit();
    return id;
  },
  remove(id) {
    const prev = items.get(id);
    if (!prev) return;
    items.set(id, { ...prev, deleted: true, updated_at: new Date().toISOString() });
    dirty.add(id);
    emit();
  },

  // ---- 同步用 ----
  dirtyItems() { return [...dirty].map((id) => items.get(id)).filter(Boolean); },
  clearDirty(ids) { ids.forEach((id) => dirty.delete(id)); persist(); },
  // 合并云端数据：更新时间较新的一方胜出
  mergeRemote(rows) {
    let changed = false;
    for (const r of rows) {
      const local = items.get(r.id);
      if (!local || new Date(r.updated_at) > new Date(local.updated_at)) {
        items.set(r.id, { id: r.id, type: r.type, data: r.data || {}, updated_at: r.updated_at, deleted: !!r.deleted });
        dirty.delete(r.id);
        changed = true;
      }
    }
    if (changed) emit(true);
    return changed;
  },
  markAllDirty() { for (const id of items.keys()) dirty.add(id); persist(); },

  exportJSON() { return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: [...items.values()] }, null, 2); },
  importJSON(text) {
    const obj = JSON.parse(text);
    if (!Array.isArray(obj.items)) throw new Error('文件格式不对');
    for (const it of obj.items) { items.set(it.id, it); dirty.add(it.id); }
    emit();
  },
  clearAll() { items.clear(); dirty.clear(); emit(); },
};

load();

/* ================= 业务查询 ================= */

/*
 * 每日任务 dtask：{ date, time, endTime, title, done, doneAt, order }
 * 每周固定任务 fixed（模板）：{ title, days:[0-6], time, endTime, from, until, pauseFrom, pauseTo }
 * 固定任务在某一天的修改/完成情况：dtask，id = fx|模板id|日期，带 fixedId，可含 title/time/endTime/done/skipped
 * 休息日 rest：id = rest|日期，这天跳过所有固定任务
 */
const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || (a.fixed ? 0 : 1) - (b.fixed ? 0 : 1) || (a.order ?? 0) - (b.order ?? 0);
export const fixedInstId = (tplId, date) => `fx|${tplId}|${date}`;
export const restId = (date) => `rest|${date}`;

export const fixedTemplates = () => store.all('fixed').sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.from || '').localeCompare(b.from || ''));

export const tplActiveOn = (tpl, date) => (tpl.days || []).includes(weekdayOf(date)) && (!tpl.from || tpl.from <= date) && (!tpl.until || date <= tpl.until);
export const tplPausedOn = (tpl, date) => !!(tpl.pauseFrom && date >= tpl.pauseFrom && (!tpl.pauseTo || date <= tpl.pauseTo));
export const isRestDay = (date) => !!store.get(restId(date));
export function setRestDay(date, on) {
  if (on) store.put('rest', { date }, restId(date)); else store.remove(restId(date));
}

// 一次性准备好查询需要的数据（日历要查几百天，避免重复遍历）
export function dayContext() {
  const oneoff = new Map(), overrides = new Map();
  for (const t of store.all('dtask')) {
    if (t.fixedId) overrides.set(t.id, t);
    else { if (!oneoff.has(t.date)) oneoff.set(t.date, []); oneoff.get(t.date).push(t); }
  }
  const rests = new Set(store.all('rest').map((r) => r.date));
  return { oneoff, overrides, rests, templates: fixedTemplates() };
}

// 某一天的固定任务（未合并到列表），含被跳过的，用于编辑
export function fixedOn(date, ctx = dayContext()) {
  if (ctx.rests.has(date)) return [];
  const out = [];
  for (const tpl of ctx.templates) {
    if (!tplActiveOn(tpl, date) || tplPausedOn(tpl, date)) continue;
    const id = fixedInstId(tpl.id, date);
    const o = ctx.overrides.get(id) || {};
    out.push({
      id, date, fixed: true, fixedId: tpl.id,
      title: o.title ?? tpl.title, time: o.time ?? tpl.time ?? '', endTime: o.endTime ?? tpl.endTime ?? '',
      done: !!o.done, doneAt: o.doneAt || null, skipped: !!o.skipped, changed: !!(o.title || o.time !== undefined || o.endTime !== undefined),
    });
  }
  return out;
}

// 某一天全部任务（临时 + 固定，已去掉跳过的），按时间排序
export function tasksOn(date, ctx = dayContext()) {
  return [...(ctx.oneoff.get(date) || []), ...fixedOn(date, ctx).filter((x) => !x.skipped)].sort(byTime);
}
export const oneoffOn = (date, ctx = dayContext()) => (ctx.oneoff.get(date) || []).slice().sort(byTime);
export const hasFixedOn = (date) => fixedOn(date, { ...dayContext(), rests: new Set() }).length > 0;

export function toggleTask(id) {
  const ctx = dayContext();
  if (id.startsWith('fx|')) {
    const [, tplId, date] = id.split('|');
    const cur = fixedOn(date, ctx).find((x) => x.id === id);
    const done = !(cur && cur.done);
    store.put('dtask', { date, fixedId: tplId, done, doneAt: done ? new Date().toISOString() : null }, id);
    return;
  }
  const t = store.get(id);
  if (!t) return;
  store.put('dtask', { done: !t.done, doneAt: !t.done ? new Date().toISOString() : null }, id);
}

// 只改某一天的固定任务
export function overrideFixed(id, patch) {
  const [, tplId, date] = id.split('|');
  store.put('dtask', { date, fixedId: tplId, ...patch }, id);
}

// 只改某一天的固定任务：只记录和模板不同的部分，模板以后修改时，这一天没改过的字段也能跟着变
export function setFixedDay(id, vals, ctx = dayContext()) {
  const [, tplId, date] = id.split('|');
  const tpl = ctx.templates.find((t) => t.id === tplId) || {};
  const want = {};
  if (vals.title !== tpl.title) want.title = vals.title;
  if ((vals.time || '') !== (tpl.time || '')) want.time = vals.time || '';
  if ((vals.endTime || '') !== (tpl.endTime || '')) want.endTime = vals.endTime || '';
  const o = ctx.overrides.get(id) || {};
  const same = !o.skipped && ['title', 'time', 'endTime'].every((k) => want[k] === o[k]);
  if (same) return;
  store.remove(id);
  store.put('dtask', { date, fixedId: tplId, done: !!o.done, doneAt: o.doneAt || null, ...want }, id);
}

// 一次保存一天：rows = [{ id?, fixed?, time, endTime, title }]
// 临时任务：没出现的删除；固定任务：改动只影响这一天，删掉 = 这一天跳过
export function saveDay(date, rows) {
  const ctx = dayContext();
  const fixedNow = new Map(fixedOn(date, ctx).map((f) => [f.id, f]));
  const keep = new Set();
  rows.forEach((r, i) => {
    const title = r.title.trim();
    if (r.id && r.id.startsWith('fx|')) {
      const f = fixedNow.get(r.id);
      if (!f) return;
      keep.add(r.id);
      if (!title) { overrideFixed(r.id, { skipped: true }); return; }
      setFixedDay(r.id, { title, time: r.time, endTime: r.endTime }, ctx);
      return;
    }
    if (!title) return;
    const id = store.put('dtask', { date, time: r.time || '', endTime: r.endTime || '', title, order: i, ...(r.id ? {} : { done: false }) }, r.id || undefined);
    keep.add(id);
  });
  for (const t of oneoffOn(date, ctx)) if (!keep.has(t.id)) store.remove(t.id);
  for (const f of fixedNow.values()) if (!keep.has(f.id) && !f.skipped) overrideFixed(f.id, { skipped: true });
}

// 新建固定任务
export function addFixed(data) {
  return store.put('fixed', { from: today(), until: '', pauseFrom: '', pauseTo: '', createdAt: new Date().toISOString(), ...data });
}

// 修改固定任务：从 effective 这天起生效；之前的日子保持原样（自动拆成两段）
export function updateFixed(id, changes, effective = today()) {
  const tpl = store.get(id);
  if (!tpl) return id;
  const structural = ['title', 'time', 'endTime', 'days'].some((k) => k in changes && JSON.stringify(changes[k]) !== JSON.stringify(tpl[k]));
  if (!structural || !tpl.from || tpl.from >= effective) {
    store.put('fixed', changes, id);
    return id;
  }
  const { id: _i, ...rest } = tpl;
  store.put('fixed', { until: addDays(effective, -1) }, id);
  return store.put('fixed', { ...rest, ...changes, from: effective, createdAt: new Date().toISOString() });
}

// 结束固定任务：从 date 这天起不再出现，之前的记录保留
export function endFixed(id, date = today()) {
  const tpl = store.get(id);
  if (!tpl) return;
  if (tpl.from && tpl.from >= date) store.remove(id);
  else store.put('fixed', { until: addDays(date, -1) }, id);
}

// 彻底删除（包括历史上每一天的完成记录）
export function deleteFixedForever(id) {
  for (const t of store.all('dtask')) if (t.fixedId === id) store.remove(t.id);
  store.remove(id);
}

// 日历用：按日期给出任务；未来日期只看临时任务决定是否显示
export function calendarData(fromDate, toDate) {
  const ctx = dayContext();
  const m = new Map();
  const t = today();
  for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
    if (d > t && !(ctx.oneoff.get(d) || []).length) continue;
    const list = tasksOn(d, ctx);
    if (list.length) m.set(d, list);
  }
  return m;
}
// 有过任务记录的最早/最晚日期（临时任务 + 固定任务起始日）
export function taskDateRange() {
  const ds = store.all('dtask').filter((x) => !x.fixedId).map((x) => x.date);
  for (const f of store.all('fixed')) if (f.from && f.from <= today()) ds.push(f.from);
  ds.sort();
  return ds.length ? [ds[0], ds[ds.length - 1]] : null;
}

// ---- 截止任务（时间轴）：{ title, date, done, doneAt } ----
export const REMIND_DAYS = [7, 5, 2, 0];
export const deadlines = () => store.all('deadline').sort((a, b) => a.date.localeCompare(b.date));
export function toggleDeadline(id) {
  const d = store.get(id);
  if (!d) return;
  store.put('deadline', { done: !d.done, doneAt: !d.done ? new Date().toISOString() : null }, id);
}
export const deadlinesToRemind = () => deadlines().filter((d) => !d.done && REMIND_DAYS.includes(diffDays(today(), d.date)));

// ---- 随手小记 note：{ kind: 'idea'|'todo', text, status, revision, done, doneAt, statusAt, createdAt } ----
// 灵感 status：new 待定 / ok 可行 / done 已执行 / revised 不可行·已修改 / dropped 不可行·放弃
export const IDEA_STATUS = {
  new: { label: '待定', cls: 'st-new' },
  ok: { label: '可行', cls: 'st-ok' },
  done: { label: '已执行', cls: 'st-done' },
  revised: { label: '已修改', cls: 'st-rev' },
  dropped: { label: '已放弃', cls: 'st-drop' },
};
export const notes = () => store.all('note').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
export const addNote = (kind, text) => store.put('note', { kind, text, status: 'new', revision: '', done: false, createdAt: new Date().toISOString() });
export function setIdeaStatus(id, status, revision) {
  const patch = { status, statusAt: new Date().toISOString() };
  if (revision !== undefined) patch.revision = revision;
  store.put('note', patch, id);
}
export function toggleNote(id) {
  const n = store.get(id);
  if (!n) return;
  store.put('note', { done: !n.done, doneAt: !n.done ? new Date().toISOString() : null }, id);
}
// 把小记安排成某一天的任务
export function noteToTask(id, date) {
  const n = store.get(id);
  if (!n) return;
  const title = n.kind === 'idea' && n.revision ? n.revision : n.text;
  store.put('dtask', { date, time: '', endTime: '', title: title.slice(0, 80), done: false, order: 999, fromNote: id });
}

// ---- 每日复盘 review：id = review|日期，{ date, mood, feel, mistakes, thoughts } ----
export const MOODS = [
  { k: 'great', e: '🥰', t: '超开心' },
  { k: 'good', e: '😊', t: '不错' },
  { k: 'ok', e: '🙂', t: '平静' },
  { k: 'tired', e: '😪', t: '有点累' },
  { k: 'down', e: '🥺', t: '低落' },
];
export const reviewId = (date) => `review|${date}`;
export const getReview = (date) => store.get(reviewId(date));
export function saveReview(date, patch) {
  const prev = getReview(date) || {};
  const next = { ...prev, ...patch };
  delete next.id;
  const empty = !next.mood && !(next.feel || '').trim() && !(next.mistakes || '').trim() && !(next.thoughts || '').trim();
  if (empty) { if (getReview(date)) store.remove(reviewId(date)); return; }
  store.put('review', { date, ...patch }, reviewId(date));
}
export const reviewMoods = () => new Map(store.all('review').filter((r) => r.mood).map((r) => [r.date, MOODS.find((m) => m.k === r.mood)?.e || '']));
