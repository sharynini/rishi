// 页面：今天（某一天）/ 编辑一天 / 时间轴 / 日历 / 设置
import { tasksOn, fixedOn, deadlines, REMIND_DAYS, isRestDay, hasFixedOn, fixedTemplates, tplPausedOn, calendarData, taskDateRange, notes, IDEA_STATUS, MOODS, getReview, reviewMoods, reviewPhotoDates } from './store.js';
import { sync, BUILTIN } from './sync.js';
import { pushSupported, pushOn } from './push.js';
import { permission, MORNING, NIGHT } from './notify.js';
import { today, addDays, diffDays, formatDate, relDays, esc, parseDate, toDateStr, timeAgo, weekdayName } from './utils.js';

export const ICON = {
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
};

export const TABS = [
  { key: 'day', label: '今天', icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/></svg>' },
  { key: 'timeline', label: '时间轴', icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3v18"/><circle cx="6" cy="7" r="2.2" fill="currentColor"/><circle cx="6" cy="17" r="2.2" fill="currentColor"/><path d="M11 7h9M11 17h6"/></svg>' },
  { key: 'notes', label: '小记', icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>' },
  { key: 'calendar', label: '日历', icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>' },
];

const gearBtn = () => {
  const st = sync.state;
  const dot = !sync.ready ? 'off' : st.error ? 'err' : st.syncing ? 'busy' : 'ok';
  return `<button class="icon-btn" data-act="go" data-to="settings" aria-label="设置与同步">${ICON.gear}<span class="sync-dot ${dot}"></span></button>`;
};

/* ---------- 某一天 ---------- */
const PIN = '<span class="pin" title="每周固定任务">📌</span>';
const timeRange = (x) => (x.time ? `<span class="t1">${x.time}</span>${x.endTime ? `<span class="t2">${x.endTime}</span>` : ''}` : '');

export function viewDay(date = today()) {
  const t = today();
  const list = tasksOn(date);
  const done = list.filter((x) => x.done).length;
  const label = date === t ? '今天' : date === addDays(t, 1) ? '明天' : date === addDays(t, -1) ? '昨天' : relDays(date);
  const soon = date === t ? deadlines().filter((d) => !d.done && diffDays(t, d.date) >= 0 && diffDays(t, d.date) <= 7) : [];
  const rest = isRestDay(date);
  const canRest = rest || hasFixedOn(date);
  const skipped = rest ? [] : fixedOn(date).filter((f) => f.skipped);

  return `
  <header class="page-head">
    <div class="day-switch">
      <button class="icon-btn ghost" data-act="go" data-to="day/${addDays(date, -1)}" aria-label="前一天">${ICON.left}</button>
      <label class="day-title">
        <h1><span class="hl">${label}</span></h1>
        <span class="sub">${formatDate(date)}</span>
        <input type="date" value="${date}" data-act-change="pick-day" aria-label="选择日期" />
      </label>
      <button class="icon-btn ghost" data-act="go" data-to="day/${addDays(date, 1)}" aria-label="后一天">${ICON.right}</button>
    </div>
    <div class="head-actions">
      <button class="icon-btn" data-act="go" data-to="fixed" aria-label="每周固定任务" title="每周固定任务">📌</button>
      ${gearBtn()}
    </div>
  </header>
  ${date !== t ? '<button class="btn small back-today" data-act="go" data-to="day">↩ 回到今天</button>' : ''}

  ${soon.length ? `<div class="soon-bar" data-act="go" data-to="timeline">⏰ ${soon.map((d) => `<span><b>${esc(d.title)}</b> ${diffDays(t, d.date) === 0 ? '今天截止' : `还有 ${diffDays(t, d.date)} 天`}</span>`).join('')}</div>` : ''}
  ${rest ? `<div class="rest-bar">😴 这天是休息日，固定任务都已跳过 <button class="link" data-act="rest-off" data-date="${date}">取消休息</button></div>` : ''}

  ${list.length ? `
  <div class="day-progress"><span>已完成 ${done}/${list.length}</span><i style="--p:${(done / list.length) * 100}%"></i></div>
  <ol class="day-line paper">
    ${list.map((x) => `
    <li class="${x.done ? 'is-done' : ''} ${x.fixed ? 'is-fixed' : ''}">
      <span class="dl-time">${timeRange(x)}</span>
      <button class="dl-node" data-act="toggle" data-id="${x.id}" aria-pressed="${!!x.done}" aria-label="${x.done ? '取消完成' : '完成'}">${ICON.check}</button>
      <button class="dl-title" data-act="${x.fixed ? 'fx-menu' : 'toggle'}" data-id="${x.id}">${x.fixed ? PIN : ''}${esc(x.title)}${x.fixed && x.changed ? '<small class="chg">今日已调整</small>' : ''}</button>
    </li>`).join('')}
  </ol>
  <button class="btn block" data-act="go" data-to="edit/${date}">编辑这一天的任务</button>`
    : `<div class="empty"><div class="empty-emoji">🐰</div><p>${rest ? '好好休息～' : '这一页还是空白的～写点计划吧'}</p><button class="btn primary" data-act="go" data-to="edit/${date}">添加这一天的任务</button></div>`}
  ${date <= t ? reviewCard(date, done, list.length) : ''}
  <div class="day-foot">
    ${skipped.length ? `<span class="muted small">这天跳过了 ${skipped.length} 个固定任务 · ${skipped.map((f) => `<button class="link small" data-act="fx-restore" data-id="${f.id}">恢复「${esc(f.title)}」</button>`).join(' ')}</span>` : ''}
    ${canRest && !rest ? `<button class="link small" data-act="rest-on" data-date="${date}">😴 设为休息日（跳过这天全部固定任务）</button>` : ''}
  </div>`;
}

/* ---------- 今日复盘 ---------- */
function cheer(done, total) {
  if (!total) return '今天也辛苦啦，记录一下心情吧 🌷';
  if (done === total) return `${total} 件事全部完成，今天的你闪闪发光 ✨`;
  if (done === 0) return '没关系，休息也是前进的一部分，明天再出发 🌱';
  if (done / total >= 0.6) return `完成了 ${done}/${total}，已经很棒啦，给自己一个抱抱 🤗`;
  return `完成了 ${done}/${total}，每一小步都算数 🍀`;
}

function reviewCard(date, done, total) {
  const r = getReview(date) || {};
  const isToday = date === today();
  const title = `🌙 ${isToday ? '今日' : '这天的'}复盘`;
  const mood = MOODS.find((m) => m.k === r.mood);
  const photos = r.photos || [];
  const written = !!(mood || r.feel || r.mistakes || r.thoughts || photos.length);
  const field = (key, icon, label, ph) => `
    <label class="rv-field">
      <span class="rv-label">${icon} ${label}</span>
      <textarea class="rv-text" data-rv="${key}" data-date="${date}" rows="1" maxlength="2000" placeholder="${ph}">${esc(r[key] || '')}</textarea>
      <button type="button" class="rv-more" data-act="rv-more" data-key="${date}|${key}" hidden>展开全文 ▾</button>
    </label>`;
  return `
  <section class="review">
    <div class="rv-head">
      <h2>${title}</h2>
      <span class="rv-saved" id="rv-saved">${written ? '已保存 ✓' : ''}</span>
    </div>
    <p class="rv-cheer">${cheer(done, total)}</p>
    <div class="rv-moods" role="radiogroup" aria-label="今天的心情">
      ${MOODS.map((m) => `<button class="rv-mood ${r.mood === m.k ? 'on' : ''}" data-act="rv-mood" data-date="${date}" data-v="${m.k}" role="radio" aria-checked="${r.mood === m.k}" title="${m.t}">${m.e}</button>`).join('')}
      <span class="rv-mood-text">${mood ? mood.t : '今天心情如何？'}</span>
    </div>
    <div class="rv-photos">
      ${photos.map((p) => `<div class="rv-photo" data-photo="${esc(p.id)}" data-ext="${esc(p.ext)}" data-act="rv-photo-view" role="button" aria-label="查看照片">
        <img alt="复盘照片" />
        <button type="button" class="rv-photo-del" data-act="rv-photo-del" data-date="${date}" data-id="${esc(p.id)}" aria-label="删除这张照片">×</button>
      </div>`).join('')}
      ${photos.length < 3 ? `<label class="rv-photo-add">
        <span>📷</span><em>${photos.length ? '再加一张' : '添加照片'}</em>
        <input type="file" accept="image/*" multiple hidden data-act-change="rv-photo" data-date="${date}" />
      </label>` : ''}
    </div>
    ${field('feel', '💗', '今天的感受', '有什么开心或难忘的小事～')}
    ${field('mistakes', '🩹', '小错误 / 踩过的坑', '写下来就是进步')}
    ${field('thoughts', '🌟', '感想 / 想对明天的自己说', '留一句温柔的话吧')}
  </section>`;
}

/* ---------- 编辑一天（批量） ---------- */
export function rowHTML(r = {}) {
  return `<div class="edit-row ${r.fixed ? 'is-fixed' : ''}" data-id="${r.id || ''}">
    <div class="er-line">
      ${r.fixed ? PIN : ''}<input class="er-title" value="${esc(r.title || '')}" placeholder="任务内容" enterkeyhint="next" maxlength="80" />
      <button type="button" class="er-del" data-act="row-del" aria-label="${r.fixed ? '这一天跳过' : '删除这一行'}">${ICON.x}</button>
    </div>
    <div class="er-times">
      <input type="time" class="er-time" value="${r.time || ''}" aria-label="开始时间（可不填）" />
      <span>至</span>
      <input type="time" class="er-end" value="${r.endTime || ''}" aria-label="结束时间（可不填）" />
      ${r.fixed ? '<em>每周固定 · 这里改只影响这一天</em>' : ''}
    </div>
  </div>`;
}

export function viewEdit(date) {
  const list = tasksOn(date);
  const rows = list.length ? [...list, {}] : [{}, {}, {}];
  return `
  <header class="page-head">
    <button class="link" data-act="go" data-to="day/${date}">取消</button>
    <div class="center"><h2>编辑任务</h2><span class="sub">${formatDate(date)}</span></div>
    <button class="link strong" data-act="save-day" data-date="${date}">保存</button>
  </header>
  <p class="muted small tip">一行一个任务，时间可以不填。按回车自动新增一行。📌 是每周固定任务，在这里修改或删除只影响这一天；要改每周的安排请点「今天」页右上角的 📌。</p>
  <div class="card edit-list paper" id="edit-list">${rows.map(rowHTML).join('')}</div>
  <button class="btn block" data-act="row-add">${ICON.plus} 添加一行</button>
  <button class="btn primary block" data-act="save-day" data-date="${date}">保存</button>`;
}

/* ---------- 每周固定任务 ---------- */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export function daysText(days = []) {
  const set = new Set(days);
  if (set.size === 7) return '每天';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return '工作日';
  if (set.size === 6 && [1, 2, 3, 4, 5, 6].every((d) => set.has(d))) return '周一至周六';
  if (set.size === 2 && set.has(0) && set.has(6)) return '周末';
  return WEEK_ORDER.filter((d) => set.has(d)).map((d) => weekdayName(d)).join('、');
}
export function rangeText(f) {
  const t = today();
  const from = f.from && f.from > t ? `${formatDate(f.from, false)}起` : '';
  const until = f.until ? `至 ${formatDate(f.until, false)}` : '长期';
  return [from, until].filter(Boolean).join(' ');
}

export function viewFixed() {
  const t = today();
  const all = fixedTemplates();
  const active = all.filter((f) => !f.until || f.until >= t);
  const ended = all.filter((f) => f.until && f.until < t);
  const card = (f) => {
    const paused = tplPausedOn(f, t);
    const pauseInfo = f.pauseFrom && (!f.pauseTo || f.pauseTo >= t)
      ? `<span class="fx-pause">⏸ ${paused ? '暂停中' : '将暂停'}：${formatDate(f.pauseFrom, false)}${f.pauseTo ? ` - ${formatDate(f.pauseTo, false)}` : ' 起'}</span>` : '';
    return `<button class="fx-card ${paused ? 'is-paused' : ''}" data-act="fx-edit" data-id="${f.id}">
      <span class="fx-time">${f.time || '不定时'}${f.endTime ? `<br><small>${f.endTime}</small>` : ''}</span>
      <span class="fx-body"><b>${esc(f.title)}</b><span class="fx-meta">${daysText(f.days)} · ${rangeText(f)}</span>${pauseInfo}</span>
    </button>`;
  };
  const groups = WEEK_ORDER.map((d) => {
    const list = active.filter((f) => (f.days || []).includes(d));
    return `<section class="fx-day">
      <h3 class="fx-day-title"><span class="tape">${weekdayName(d)}</span><span class="count">${list.length} 项</span></h3>
      ${list.length ? list.map(card).join('') : '<p class="muted small fx-none">没有固定任务</p>'}
    </section>`;
  }).join('');
  return `
  <header class="page-head">
    <button class="icon-btn ghost" data-act="back-day" aria-label="返回">${ICON.left}</button>
    <div class="center"><h2>📌 每周固定</h2><span class="sub">每周按时出现在「今天」里</span></div>
    <button class="icon-btn accent" data-act="fx-new" aria-label="新建固定任务">${ICON.plus}</button>
  </header>
  ${active.length ? '' : '<div class="empty"><div class="empty-emoji">📌</div><p>把每周都要做的事放这里，比如「周一到周六 8:00 背单词」</p><button class="btn primary" data-act="fx-new">添加固定任务</button></div>'}
  ${active.length ? groups : ''}
  ${ended.length ? `<details class="done-box"><summary>已结束 ${ended.length} 项</summary>${ended.map(card).join('')}</details>` : ''}`;
}

/* ---------- 时间轴（截止任务） ---------- */
export function viewTimeline() {
  const t = today();
  const all = deadlines();
  const active = all.filter((d) => !d.done);
  const done = all.filter((d) => d.done);
  let lastMonth = '';
  const item = (d) => {
    const n = diffDays(t, d.date);
    let head = '';
    const month = d.date.slice(0, 7);
    if (!d.done && month !== lastMonth) {
      lastMonth = month;
      const [y, m] = month.split('-');
      head = `<li class="tl-month">${y}年${Number(m)}月</li>`;
    }
    const cls = d.done ? 'is-done' : n < 0 ? 'is-over' : n <= 2 ? 'is-soon' : n <= 7 ? 'is-near' : '';
    const badge = d.done ? '完成' : n === 0 ? '今天' : n < 0 ? `过了${-n}天` : `${n}天`;
    return `${head}
    <li class="tl-item ${cls}">
      <button class="tl-check" data-act="dl-toggle" data-id="${d.id}" aria-pressed="${!!d.done}" aria-label="标记完成">${ICON.check}</button>
      <button class="tl-body" data-act="dl-edit" data-id="${d.id}">
        <span class="tl-title">${esc(d.title)}</span>
        <span class="tl-date">${formatDate(d.date)} 截止</span>
      </button>
      <span class="tl-badge">${badge}</span>
    </li>`;
  };
  return `
  <header class="page-head"><div><h1><span class="hl">时间轴</span></h1><span class="sub">截止前 ${REMIND_DAYS.map((x) => (x ? x + ' 天' : '当天')).join('、')}提醒</span></div><div class="head-actions">${gearBtn()}</div></header>
  <form class="card dl-add" data-form="dl-add">
    <input name="title" placeholder="任务名称，如：雅思考试" required maxlength="60" autocomplete="off" />
    <div class="dl-add-row">
      <input type="date" name="date" required value="${addDays(t, 7)}" />
      <button class="btn primary">${ICON.plus} 添加</button>
    </div>
  </form>
  ${active.length ? `<ol class="tl">${active.map(item).join('')}</ol>`
    : '<div class="empty"><div class="empty-emoji">🧸</div><p>添加有截止日期的任务，会按日期自动排成时间线</p></div>'}
  ${done.length ? `<details class="done-box"><summary>已完成 ${done.length} 项</summary><ol class="tl">${done.map(item).join('')}</ol></details>` : ''}`;
}

/* ---------- 日历（按年月倒序：越新越靠上） ---------- */
const MONTH_STICKERS = ['⛄', '🧧', '🌸', '🌷', '🌼', '🍓', '🍉', '🌻', '🍁', '🎃', '🍂', '🎄'];

function calCell(ds, t, list, mood = '', hasPhoto = false) {
  const d = parseDate(ds).getDate();
  const isFuture = ds > t;
  // 还没到、也没安排任务的日子：不显示
  if (isFuture && !list.length) return '<div class="cal-cell blank"></div>';
  const done = list.filter((x) => x.done);
  const items = [...done, ...list.filter((x) => !x.done)];
  let label = '';
  if (ds === t) label = '今日';
  else if (ds === addDays(t, 1)) label = '明日任务';
  else if (ds === addDays(t, 2)) label = '后天';
  else if (isFuture) label = `${diffDays(t, ds)}天后`;
  const body = items.length
    ? `${label ? `<span class="cal-label">${label}</span>` : ''}${items.slice(0, 3).map((x) => `<span class="cal-task ${x.done ? 'ok' : ''}"><i>${x.done ? ICON.check : ''}</i><em>${esc(x.title)}</em></span>`).join('')}${items.length > 3 ? `<span class="cal-more">+${items.length - 3}</span>` : ''}`
    : `<span class="cal-empty">${ds === t ? '今日暂无' : '无任务'}</span>`;
  const cls = [ds === t ? 'today' : '', isFuture ? 'future' : '', !items.length ? 'none' : done.length === items.length ? 'all-done' : ''].join(' ');
  return `<button class="cal-cell ${cls}" data-act="go" data-to="day/${ds}" aria-label="${formatDate(ds)}，完成 ${done.length}/${list.length}">
    <span class="cal-num">${d}<span class="cal-badges">${mood ? `<i class="cal-mood">${mood}</i>` : ''}${hasPhoto ? '<i class="cal-photo" aria-label="有照片">📷</i>' : ''}${done.length && done.length === items.length ? '<b class="star">★</b>' : ''}</span></span>${body}
  </button>`;
}

export function viewCalendar() {
  const t = today();
  const now = parseDate(t);
  const cur = new Date(now.getFullYear(), now.getMonth(), 1);
  const range = taskDateRange();
  // 最上面：最晚有临时任务的月份（至少是本月）；最下面：最早有任务的月份（至少往前 2 个月，最多 24 个月）
  let top = cur;
  let bottom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (range) {
    const last = parseDate(range[1]);
    const lastM = new Date(last.getFullYear(), last.getMonth(), 1);
    if (lastM > top) top = lastM;
    const first = parseDate(range[0]);
    const firstM = new Date(first.getFullYear(), first.getMonth(), 1);
    const min = new Date(now.getFullYear(), now.getMonth() - 24, 1);
    if (firstM < bottom) bottom = firstM < min ? min : firstM;
  }
  const moods = reviewMoods();
  const photoDays = reviewPhotoDates();
  const map = calendarData(toDateStr(bottom), toDateStr(new Date(top.getFullYear(), top.getMonth() + 1, 0)));
  const dates = [...map.keys()];

  let html = '';
  let lastYear = null;
  for (let m = new Date(top); m >= bottom; m = new Date(m.getFullYear(), m.getMonth() - 1, 1)) {
    const y = m.getFullYear(), mo = m.getMonth();
    const isCur = m.getTime() === cur.getTime();
    const prefix = `${y}-${String(mo + 1).padStart(2, '0')}`;
    // 没有任何任务的月份跳过（本月除外）
    if (!isCur && !dates.some((d) => d.startsWith(prefix))) continue;
    if (y !== lastYear) {
      html += `<div class="cal-year"><span>${y}</span></div>`;
      lastYear = y;
    }
    const days = new Date(y, mo + 1, 0).getDate();
    const lead = (m.getDay() + 6) % 7; // 周一为第一列
    let cells = '<div class="cal-cell blank"></div>'.repeat(lead);
    let monthDone = 0;
    for (let d = 1; d <= days; d++) {
      const ds = toDateStr(new Date(y, mo, d));
      const list = map.get(ds) || [];
      monthDone += list.filter((x) => x.done).length;
      cells += calCell(ds, t, list, moods.get(ds), photoDays.has(ds));
    }
    html += `<section class="cal-month" ${isCur ? 'id="cur-month"' : ''}>
      <h2 class="cal-title"><span class="tape">${MONTH_STICKERS[mo]} ${mo + 1}月</span><span class="count">完成 ${monthDone} 项</span></h2>
      <div class="cal-week">${['一', '二', '三', '四', '五', '六', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </section>`;
  }

  return `
  <header class="page-head"><div><h1><span class="hl">日历</span></h1><span class="sub">翻翻走过的每一天 ✿</span></div><div class="head-actions">${gearBtn()}</div></header>
  ${html}`;
}

/* ---------- 随手小记 ---------- */
function noteTime(iso) {
  const d = new Date(iso);
  const ds = toDateStr(d);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const t = today();
  if (ds === t) return `今天 ${hm}`;
  if (ds === addDays(t, -1)) return `昨天 ${hm}`;
  return `${formatDate(ds, false)} ${hm}`;
}

function noteCard(n) {
  if (n.kind === 'todo') {
    return `<div class="note-card todo ${n.done ? 'is-done' : ''}">
      <button class="note-check" data-act="note-toggle" data-id="${n.id}" aria-pressed="${!!n.done}" aria-label="${n.done ? '标为未完成' : '标为已完成'}">${ICON.check}</button>
      <button class="note-body" data-act="note-menu" data-id="${n.id}">
        <span class="note-text">${esc(n.text)}</span>
        <span class="note-meta">📝 ${noteTime(n.createdAt)}${n.done ? ' · 已完成' : ''}</span>
      </button>
    </div>`;
  }
  const st = IDEA_STATUS[n.status] || IDEA_STATUS.new;
  return `<button class="note-card idea ${st.cls}" data-act="note-menu" data-id="${n.id}">
    <span class="note-head"><span class="note-bulb">💡</span><span class="st-badge ${st.cls}">${st.label}</span></span>
    <span class="note-text">${esc(n.text)}</span>
    ${n.revision ? `<span class="note-rev">✏️ 修改为：${esc(n.revision)}</span>` : ''}
    <span class="note-meta">${noteTime(n.createdAt)}</span>
  </button>`;
}

export function viewNotes(ui = {}) {
  const kind = ui.kind || 'idea';           // 添加时的类型
  const filter = ui.filter || 'all';        // all | idea | todo
  const sub = ui.sub || 'open';             // 灵感：open(待定+可行) / done / revised / dropped / all；随手记：open / done
  const all = notes();
  let list = filter === 'all' ? all : all.filter((n) => n.kind === filter);
  const ideaOpen = (n) => n.status === 'new' || n.status === 'ok';
  const isOpen = (n) => (n.kind === 'todo' ? !n.done : ideaOpen(n));
  let subTabs = '';
  if (filter === 'idea') {
    const tabs = [['open', '待定 / 可行'], ['done', '已执行'], ['revised', '已修改'], ['dropped', '已放弃'], ['all', '全部']];
    const cnt = { open: list.filter(ideaOpen).length, done: list.filter((n) => n.status === 'done').length, revised: list.filter((n) => n.status === 'revised').length, dropped: list.filter((n) => n.status === 'dropped').length, all: list.length };
    subTabs = `<div class="chips">${tabs.map(([k, l]) => `<button class="chip ${sub === k ? 'on' : ''}" data-act="note-sub" data-v="${k}">${l} ${cnt[k]}</button>`).join('')}</div>`;
    list = sub === 'all' ? list : sub === 'open' ? list.filter(ideaOpen) : list.filter((n) => n.status === sub);
  } else if (filter === 'todo') {
    const cnt = { open: list.filter((n) => !n.done).length, done: list.filter((n) => n.done).length };
    subTabs = `<div class="chips">${[['open', '未完成'], ['done', '已完成']].map(([k, l]) => `<button class="chip ${sub === k ? 'on' : ''}" data-act="note-sub" data-v="${k}">${l} ${cnt[k]}</button>`).join('')}</div>`;
    list = sub === 'done' ? list.filter((n) => n.done) : list.filter((n) => !n.done);
  }
  // 「全部」里：未处理的在上，已处理的收进下面
  let body;
  if (filter === 'all') {
    const open = list.filter(isOpen), closed = list.filter((n) => !isOpen(n));
    body = (open.length ? `<div class="note-list">${open.map(noteCard).join('')}</div>` : '')
      + (closed.length ? `<details class="done-box"><summary>已处理 ${closed.length} 条</summary><div class="note-list">${closed.map(noteCard).join('')}</div></details>` : '');
    if (!all.length) body = '<div class="empty"><div class="empty-emoji">💭</div><p>突然想到什么，就随手记下来吧</p></div>';
    else if (!open.length && !closed.length) body = '';
  } else {
    body = list.length ? `<div class="note-list">${list.map(noteCard).join('')}</div>` : '<div class="card hint muted small" style="text-align:center">这里还没有内容</div>';
  }

  return `
  <header class="page-head"><div><h1><span class="hl">小记</span></h1><span class="sub">灵感和小事，想到就记</span></div><div class="head-actions">${gearBtn()}</div></header>
  <form class="card note-add paper" data-form="note-add">
    <div class="kind-pick">
      <button type="button" class="${kind === 'idea' ? 'on' : ''}" data-act="note-kind" data-v="idea">💡 灵感</button>
      <button type="button" class="${kind === 'todo' ? 'on' : ''}" data-act="note-kind" data-v="todo">📝 随手记</button>
    </div>
    <textarea name="text" rows="2" maxlength="500" placeholder="${kind === 'idea' ? '想到了什么好点子？' : '突然想起要做的事…'}"></textarea>
    <button class="btn primary block">记下来</button>
  </form>
  <div class="segmented3">${[['all', '全部'], ['idea', '💡 灵感'], ['todo', '📝 随手记']].map(([k, l]) => `<button class="${filter === k ? 'on' : ''}" data-act="note-filter" data-v="${k}">${l}</button>`).join('')}</div>
  ${subTabs}
  ${body}`;
}

/* ---------- 设置 ---------- */
export function viewSettings() {
  const c = sync.config;
  const st = sync.state;
  const u = sync.user;
  const perm = permission();
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `
  <header class="page-head">
    <button class="icon-btn ghost" data-act="back" aria-label="返回">${ICON.left}</button>
    <div class="center"><h2>设置</h2></div><span style="width:40px"></span>
  </header>

  <h3 class="sec-title">${BUILTIN ? '账号与同步' : '云同步（Supabase）'}</h3>
  <div class="card pad">
    ${!sync.configured || !u ? `
    <form data-form="sync-config" class="form">
      ${BUILTIN ? `<input type="hidden" name="url" value="${esc(c.url)}" /><input type="hidden" name="key" value="${esc(c.key)}" />` : `
      <label>项目地址 Project URL<input name="url" value="${esc(c.url)}" placeholder="https://xxxx.supabase.co" inputmode="url" autocapitalize="off" /></label>
      <label>公开密钥 anon / publishable key<input name="key" value="${esc(c.key)}" placeholder="eyJhbGciOi... 或 sb_publishable_..." autocapitalize="off" /></label>`}
      <label>邮箱<input name="email" type="email" autocapitalize="off" autocomplete="email" /></label>
      <label>密码<input name="password" type="password" placeholder="至少 6 位" autocomplete="current-password" /></label>
      <div class="btn-row">
        <button class="btn primary" name="mode" value="signin">登录</button>
        <button class="btn" name="mode" value="signup">注册新账号</button>
      </div>
      <button type="button" class="link small forgot" data-act="forgot">忘记密码？</button>
      <p class="muted small">每个账号的数据互相独立；同一个账号在 iPhone、iPad、Mac 上登录会自动同步。不登录也能用，数据只存在本机。</p>
    </form>` : `
    <div class="kv"><span>账号</span><b>${esc(u.email)}</b></div>
    <div class="kv"><span>上次同步</span><b>${st.syncing ? '同步中…' : timeAgo(st.lastSync)}</b></div>
    ${st.error ? `<p class="danger small">⚠️ ${esc(st.error)}</p>` : ''}
    <div class="btn-row"><button class="btn primary" data-act="sync-now">立即同步</button><button class="btn" data-act="change-pw">修改密码</button><button class="btn" data-act="sign-out">退出登录</button></div>
    <button type="button" class="link small danger delete-acc" data-act="delete-account">注销账户</button>`}
  </div>

  <h3 class="sec-title">提醒</h3>
  <div class="card pad">
    <div class="kv"><span>每天 ${MORNING}</span><b>今日任务 + 截止提醒</b></div>
    <div class="kv"><span>每天 ${NIGHT}</span><b>未完成任务 + 复盘提醒</b></div>
    <div class="kv"><span>准点推送</span><b>${pushOn() ? '✅ 已开启' : !pushSupported() ? (standalone ? '此设备不支持' : '需先添加到主屏幕') : !u ? '登录后可开启' : perm === 'denied' ? '通知被拒绝，请到系统设置打开' : '未开启'}</b></div>
    ${pushSupported() && u && perm !== 'denied' && !pushOn() ? '<button class="btn primary" data-act="push-on">开启准点推送</button>' : ''}
    <p class="muted small">${pushOn() ? '这台设备已开启，App 关着也会准时提醒。' : '每台设备开启一次即可。iPhone / iPad 需先用 Safari「添加到主屏幕」，再从主屏幕打开开启。'}</p>
  </div>

  <h3 class="sec-title">数据</h3>
  <div class="card pad">
    <div class="btn-row">
      <button class="btn" data-act="export">导出备份</button>
      <label class="btn">导入备份<input type="file" accept=".json,application/json" data-act-change="import" hidden /></label>
    </div>
  </div>
  <p class="foot-hint">日拾 v0.8 · ${standalone ? '已安装到主屏幕' : '网页模式'}</p>`;
}
