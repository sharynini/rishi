// App 外壳：路由、事件分发
import { store, toggleTask, saveDay, toggleDeadline, fixedOn, setFixedDay, overrideFixed, setRestDay, addFixed, updateFixed, endFixed, deleteFixedForever, addNote, setIdeaStatus, toggleNote, noteToTask, IDEA_STATUS, saveReview } from './store.js';
import { sync } from './sync.js';
import { enablePush, disablePush, refreshPushSilently } from './push.js';
import { startReminderLoop, requestPermission, onInAppToast } from './notify.js';
import { today, esc, addDays, formatDate, weekdayName } from './utils.js';
import { TABS, viewDay, viewEdit, rowHTML, viewTimeline, viewCalendar, viewSettings, viewFixed, WEEK_ORDER, daysText, viewNotes } from './views.js';

const $main = document.getElementById('main');
const $nav = document.getElementById('nav');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');

/* ---------- 路由 ---------- */
const route = () => {
  const [page, arg] = (location.hash.slice(2) || 'day').split('/');
  return { page, arg };
};
const go = (to) => { location.hash = '#/' + to; };
let prevHash = '#/day';
const noteUI = { kind: 'idea', filter: 'all', sub: 'open' };

function render() {
  const { page, arg } = route();
  let html;
  switch (page) {
    case 'edit': html = viewEdit(arg || today()); break;
    case 'timeline': html = viewTimeline(); break;
    case 'calendar': html = viewCalendar(); break;
    case 'settings': html = viewSettings(); break;
    case 'fixed': html = viewFixed(); break;
    case 'notes': html = viewNotes(noteUI); break;
    default: html = viewDay(arg || today());
  }
  const y = window.scrollY;
  $main.innerHTML = html;
  window.scrollTo(0, y);
  document.body.dataset.page = page;
  $main.querySelectorAll('.rv-text').forEach(autoGrow);
  const active = page === 'edit' || page === 'settings' ? '' : page === 'fixed' ? 'day' : page;
  $nav.innerHTML = TABS.map((t) => `<a href="#/${t.key}" class="${active === t.key ? 'on' : ''}">${t.icon}<span>${t.label}</span></a>`).join('');
}

// 从「忘记密码」邮件链接回来：地址里带着登录信息
function handleAuthHash() {
  if (!/access_token=|error_description=/.test(location.hash)) return false;
  sync.consumeAuthHash().then((r) => {
    if (!r) return;
    render();
    if (r.error) toast(r.error);
    else if (r.type === 'recovery') { toast('已验证邮箱，请设置新密码'); openNewPassword(); }
    else toast('登录成功');
  }).catch((e) => toast(e.message));
  return true;
}

window.addEventListener('hashchange', (e) => {
  if (handleAuthHash()) return;
  const oldPage = new URL(e.oldURL).hash;
  if (route().page === 'settings' && !oldPage.startsWith('#/settings')) prevHash = oldPage || '#/day';
  render();
  if (route().page === 'calendar') document.getElementById('cur-month')?.scrollIntoView({ block: 'start' });
  else window.scrollTo(0, 0);
  if (route().page === 'edit') focusFirstEmpty();
});

/* ---------- 提示条 ---------- */
let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2600);
}
onInAppToast(toast);

/* ---------- 编辑一天 ---------- */
function focusFirstEmpty() {
  const el = [...document.querySelectorAll('.er-title')].find((i) => !i.value) || document.querySelector('.er-title');
  // 手机上自动弹键盘会挡住页面，只在大屏自动聚焦
  if (el && window.innerWidth >= 700) el.focus();
}
function addRow(after) {
  const tmp = document.createElement('div');
  tmp.innerHTML = rowHTML();
  const row = tmp.firstElementChild;
  if (after) after.after(row); else document.getElementById('edit-list').append(row);
  row.querySelector('.er-title').focus();
}
function readRows() {
  return [...document.querySelectorAll('.edit-row')].map((r) => ({
    id: r.dataset.id || null,
    time: r.querySelector('.er-time').value,
    endTime: r.querySelector('.er-end').value,
    title: r.querySelector('.er-title').value,
  }));
}
let editDirty = false;

/* ---------- 截止任务编辑弹窗 ---------- */
function openDeadline(d) {
  $modal.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <form class="form" data-form="dl-edit" data-id="${d.id}">
        <div class="sheet-head"><button type="button" class="link" data-act="modal-close">取消</button><h3>编辑</h3><button class="link strong">保存</button></div>
        <label>任务名称<input name="title" value="${esc(d.title)}" required maxlength="60" /></label>
        <label>截止日期<input type="date" name="date" value="${d.date}" required /></label>
        <button type="button" class="btn danger-btn block" data-act="dl-delete" data-id="${d.id}">删除</button>
      </form>
    </div>`;
  $modal.classList.add('open');
}
const closeModal = () => { $modal.classList.remove('open'); $modal._submit = null; };

// 通用弹窗：inner 为表单内容，onSubmit(fd) 返回字符串表示错误
function openSheet(title, inner, onSubmit, saveText = '保存') {
  $modal.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <form class="form" data-form="sheet">
        <div class="sheet-head"><button type="button" class="link" data-act="modal-close">取消</button><h3>${esc(title)}</h3>${onSubmit ? `<button class="link strong">${saveText}</button>` : '<span style="width:2em"></span>'}</div>
        ${inner}
      </form>
    </div>`;
  $modal._submit = onSubmit;
  $modal.classList.add('open');
}

function refreshPushAfterLogin() {
  try { if (Notification.permission === 'granted') enablePush({ ask: false }).then(() => render()).catch(() => {}); } catch {}
}

/* ---------- 账号：设置新密码 ---------- */
function openNewPassword(title = '设置新密码') {
  openSheet(title, `
    <p class="muted small">新密码至少 6 位，设置后各个设备用新密码登录。</p>
    <label>新密码<input type="password" name="pw" required minlength="6" autocomplete="new-password" /></label>
    <label>再输入一次<input type="password" name="pw2" required minlength="6" autocomplete="new-password" /></label>`,
  (fd) => {
    const pw = fd.get('pw'), pw2 = fd.get('pw2');
    if (pw.length < 6) return '密码至少 6 位';
    if (pw !== pw2) return '两次输入的密码不一样';
    sync.updatePassword(pw).then(() => toast('🔑 密码已更新')).catch((e) => toast(e.message));
  });
}

/* ---------- 随手小记 ---------- */
function openNoteMenu(id) {
  const n = store.get(id);
  if (!n) return;
  const isIdea = n.kind === 'idea';
  const st = IDEA_STATUS[n.status] || IDEA_STATUS.new;
  const b = (act, label, cls = '') => `<button type="button" class="btn block ${cls}" data-act="${act}" data-id="${id}">${label}</button>`;
  openSheet(isIdea ? '💡 灵感' : '📝 随手记', `
    <p class="note-preview">${esc(n.text)}</p>
    ${n.revision ? `<p class="note-rev">✏️ 修改为：${esc(n.revision)}</p>` : ''}
    ${isIdea ? `<p class="muted small">当前状态：${st.label}</p>` : ''}
    <div class="menu">
      ${isIdea ? `
        ${n.status !== 'ok' ? b('ns-ok', '👍 想法可行') : ''}
        ${n.status !== 'done' ? b('ns-done', '✅ 已执行') : ''}
        ${b('ns-revise', n.status === 'revised' ? '✏️ 再次修改' : '✏️ 不可行，修改为…')}
        ${n.status !== 'dropped' ? b('ns-drop', '🗑 不可行，放弃') : ''}
        ${n.status !== 'new' ? b('ns-reset', '↩ 恢复为待定') : ''}`
      : b('note-toggle-close', n.done ? '↩ 标为未完成' : '✅ 标为已完成')}
      ${b('note-schedule', '📅 安排到某一天的任务')}
      ${b('note-edit', '✍️ 编辑文字')}
      ${b('note-delete', '删除这条小记', 'danger-btn ghost-danger')}
    </div>`, null);
}

/* ---------- 固定任务 ---------- */
// 某一天固定任务的操作菜单
function openFixedMenu(id) {
  const [, tplId, date] = id.split('|');
  const inst = fixedOn(date).find((f) => f.id === id);
  const tpl = store.get(tplId);
  if (!inst || !tpl) return;
  openSheet('📌 ' + inst.title, `
    <p class="muted small">${formatDate(date)} · 每周固定（${daysText(tpl.days)} ${tpl.time || ''}${tpl.endTime ? '-' + tpl.endTime : ''}）</p>
    <div class="menu">
      <button type="button" class="btn block" data-act="fxm-toggle" data-id="${id}">${inst.done ? '↩ 取消完成' : '✅ 标记完成'}</button>
      <button type="button" class="btn block" data-act="fxm-day" data-id="${id}">✏️ 只改这一天</button>
      <button type="button" class="btn block" data-act="fxm-all" data-id="${id}">🔁 修改以后的每周安排</button>
      <button type="button" class="btn block" data-act="fxm-skip" data-id="${id}">⏭ 这一天跳过</button>
      <button type="button" class="btn block danger-btn" data-act="fxm-end" data-id="${id}">⏹ 从这天起不再安排</button>
    </div>`, null);
}

function openFixedDayForm(id) {
  const [, , date] = id.split('|');
  const inst = fixedOn(date).find((f) => f.id === id);
  if (!inst) return;
  openSheet('只改这一天', `
    <p class="muted small">${formatDate(date)}，其他日子不受影响</p>
    <label>任务<input name="title" value="${esc(inst.title)}" required maxlength="80" /></label>
    <div class="two"><label>开始<input type="time" name="time" value="${inst.time || ''}" /></label><label>结束<input type="time" name="endTime" value="${inst.endTime || ''}" /></label></div>`,
  (fd) => {
    const title = fd.get('title').trim();
    if (!title) return '请填写任务';
    setFixedDay(id, { title, time: fd.get('time'), endTime: fd.get('endTime') });
    toast('已修改这一天');
  });
}

// 新建 / 修改固定任务。effective：修改从哪天起生效
function openFixedForm(tpl = null, effective = today()) {
  const days = tpl ? tpl.days : [1, 2, 3, 4, 5];
  const isEdit = !!tpl;
  openSheet(isEdit ? '修改每周固定任务' : '新建每周固定任务', `
    ${isEdit && effective !== today() ? `<p class="muted small">从 ${formatDate(effective)} 起生效，之前的日子保持不变</p>` : isEdit ? '<p class="muted small">从今天起生效，之前的日子保持不变</p>' : ''}
    <label>任务<input name="title" value="${esc(tpl?.title || '')}" placeholder="比如：背 50 个雅思单词" required maxlength="80" /></label>
    <div class="field"><span>每周哪几天</span>
      <div class="day-pick">${WEEK_ORDER.map((d) => `<label><input type="checkbox" name="days" value="${d}" ${days.includes(d) ? 'checked' : ''}/><span>${weekdayName(d).slice(1)}</span></label>`).join('')}</div>
      <div class="quick-days">
        <button type="button" class="chip" data-act="qd" data-v="1,2,3,4,5">工作日</button>
        <button type="button" class="chip" data-act="qd" data-v="1,2,3,4,5,6">周一至周六</button>
        <button type="button" class="chip" data-act="qd" data-v="0,1,2,3,4,5,6">每天</button>
        <button type="button" class="chip" data-act="qd" data-v="0,6">周末</button>
      </div>
    </div>
    <div class="two"><label>开始时间<input type="time" name="time" value="${tpl?.time || ''}" /></label><label>结束时间<input type="time" name="endTime" value="${tpl?.endTime || ''}" /></label></div>
    <div class="field"><span>执行时间段</span>
      <div class="two"><label class="sm">从<input type="date" name="from" value="${isEdit ? tpl.from || '' : today()}" required /></label><label class="sm">到（不填 = 一直重复）<input type="date" name="until" value="${tpl?.until || ''}" /></label></div>
    </div>
    ${isEdit ? `
    <div class="field"><span>⏸ 暂停一段时间（考试周、放假）</span>
      <div class="two"><label class="sm">从<input type="date" name="pauseFrom" value="${tpl.pauseFrom || ''}" /></label><label class="sm">到<input type="date" name="pauseTo" value="${tpl.pauseTo || ''}" /></label></div>
      ${tpl.pauseFrom ? '<button type="button" class="link small" data-act="clear-pause">清除暂停</button>' : ''}
    </div>
    <button type="button" class="btn block danger-btn" data-act="fx-stop" data-id="${tpl.id}" data-date="${effective}">⏹ 从${effective === today() ? '今天' : formatDate(effective, false)}起停止（保留以前的记录）</button>
    <button type="button" class="btn block danger-btn ghost-danger" data-act="fx-delete" data-id="${tpl.id}">🗑 彻底删除（连同以前的记录）</button>` : ''}`,
  (fd) => {
    const title = fd.get('title').trim();
    const d = fd.getAll('days').map(Number);
    if (!title) return '请填写任务';
    if (!d.length) return '请至少选择一天';
    const from = fd.get('from'), until = fd.get('until') || '';
    if (!from) return '请选择开始日期';
    if (until && until < from) return '结束日期不能早于开始日期';
    const pauseFrom = fd.get('pauseFrom') || '', pauseTo = fd.get('pauseTo') || '';
    if (pauseFrom && pauseTo && pauseTo < pauseFrom) return '暂停的结束日期不能早于开始日期';
    const data = { title, days: d.sort(), time: fd.get('time') || '', endTime: fd.get('endTime') || '', until };
    if (isEdit) {
      data.pauseFrom = pauseFrom; data.pauseTo = pauseFrom ? pauseTo : '';
      if (from !== tpl.from) data.from = from;
      updateFixed(tpl.id, data, from !== tpl.from ? from : effective);
      toast('已修改每周安排');
    } else {
      addFixed({ ...data, from });
      toast('已添加，每周都会出现在「今天」里');
      maybeAskNotify();
    }
  });
}

async function maybeAskNotify() {
  if ('Notification' in window && Notification.permission === 'default') { try { await requestPermission(); } catch {} }
}

/* ---------- 点击 ---------- */
const actions = {
  go: (el) => go(el.dataset.to),
  back: () => { location.hash = prevHash; },
  toggle: (el) => { toggleTask(el.dataset.id); if (navigator.vibrate) navigator.vibrate(10); },
  'row-add': () => addRow(),
  'row-del': (el) => {
    const row = el.closest('.edit-row');
    editDirty = true;
    if (document.querySelectorAll('.edit-row').length > 1) row.remove();
    else { row.querySelectorAll('input').forEach((i) => { i.value = ''; }); }
  },
  'save-day': (el) => {
    const date = el.dataset.date;
    const rows = readRows();
    saveDay(date, rows);
    editDirty = false;
    const n = rows.filter((r) => r.title.trim()).length;
    toast(n ? `已保存 ${n} 个任务` : '已清空这一天');
    if (n) maybeAskNotify();
    go('day/' + date);
  },
  'dl-toggle': (el) => {
    const d = store.get(el.dataset.id);
    toggleDeadline(el.dataset.id);
    if (d && !d.done) toast(`🎉 完成「${d.title}」`);
  },
  'dl-edit': (el) => { const d = store.get(el.dataset.id); if (d) openDeadline(d); },
  'dl-delete': (el) => { if (!confirm('确定删除吗？')) return; store.remove(el.dataset.id); closeModal(); toast('已删除'); },
  'modal-close': () => closeModal(),
  'rv-more': (el) => {
    const k = el.dataset.key;
    if (rvExpanded.has(k)) rvExpanded.delete(k); else rvExpanded.add(k);
    autoGrow(el.parentElement.querySelector('.rv-text'));
  },
  'rv-mood': (el) => {
    const cur = el.classList.contains('on');
    saveReview(el.dataset.date, { mood: cur ? '' : el.dataset.v });
    if (!cur && navigator.vibrate) navigator.vibrate(10);
  },
  'note-kind': (el) => {
    const text = document.querySelector('.note-add textarea')?.value || '';
    noteUI.kind = el.dataset.v; render();
    const ta = document.querySelector('.note-add textarea'); if (ta) { ta.value = text; }
  },
  'note-filter': (el) => { noteUI.filter = el.dataset.v; noteUI.sub = 'open'; render(); },
  'note-sub': (el) => { noteUI.sub = el.dataset.v; render(); },
  'note-toggle': (el) => { toggleNote(el.dataset.id); if (navigator.vibrate) navigator.vibrate(10); },
  'note-toggle-close': (el) => { toggleNote(el.dataset.id); closeModal(); },
  'note-menu': (el) => openNoteMenu(el.dataset.id),
  'ns-ok': (el) => { setIdeaStatus(el.dataset.id, 'ok'); closeModal(); toast('👍 标为可行'); },
  'ns-done': (el) => { setIdeaStatus(el.dataset.id, 'done'); closeModal(); toast('🎉 已执行'); },
  'ns-drop': (el) => { setIdeaStatus(el.dataset.id, 'dropped'); closeModal(); toast('已放弃，可在「已放弃」里找回'); },
  'ns-reset': (el) => { setIdeaStatus(el.dataset.id, 'new'); closeModal(); toast('已恢复为待定'); },
  'ns-revise': (el) => {
    const id = el.dataset.id, n = store.get(id);
    openSheet('不可行，修改为…', `
      <p class="note-preview">原想法：${esc(n.text)}</p>
      <label>修改后的想法<textarea name="revision" rows="3" maxlength="500" required placeholder="换个方式试试…">${esc(n.revision || '')}</textarea></label>`,
    (fd) => {
      const r = fd.get('revision').trim();
      if (!r) return '请写下修改后的想法';
      setIdeaStatus(id, 'revised', r); toast('已修改');
    });
  },
  'note-edit': (el) => {
    const id = el.dataset.id, n = store.get(id);
    openSheet('编辑小记', `<label>内容<textarea name="text" rows="4" maxlength="500" required>${esc(n.text)}</textarea></label>`, (fd) => {
      const t = fd.get('text').trim();
      if (!t) return '内容不能为空';
      store.put('note', { text: t }, id); toast('已保存');
    });
  },
  'note-schedule': (el) => {
    const id = el.dataset.id;
    openSheet('安排到某一天', `<label>日期<input type="date" name="date" value="${today()}" required /></label><p class="muted small">会加到那一天的任务里，可以再去编辑页设置时间。</p>`, (fd) => {
      const d = fd.get('date');
      if (!d) return '请选择日期';
      noteToTask(id, d); toast(`已加到 ${formatDate(d, false)} 的任务`);
    }, '添加');
  },
  'note-delete': (el) => { if (!confirm('删除这条小记？')) return; store.remove(el.dataset.id); closeModal(); toast('已删除'); },
  'back-day': () => go('day'),
  'fx-menu': (el) => openFixedMenu(el.dataset.id),
  'fxm-toggle': (el) => { toggleTask(el.dataset.id); closeModal(); },
  'fxm-day': (el) => openFixedDayForm(el.dataset.id),
  'fxm-all': (el) => { const [, tplId, date] = el.dataset.id.split('|'); const tpl = store.get(tplId); if (tpl) openFixedForm(tpl, date); },
  'fxm-skip': (el) => { overrideFixed(el.dataset.id, { skipped: true }); closeModal(); toast('这一天已跳过，可在页面底部恢复'); },
  'fxm-end': (el) => {
    const [, tplId, date] = el.dataset.id.split('|');
    if (!confirm(`从 ${formatDate(date)} 起不再安排这个固定任务？以前的记录会保留。`)) return;
    endFixed(tplId, date); closeModal(); toast('已停止，以后不再出现');
  },
  'fx-restore': (el) => { overrideFixed(el.dataset.id, { skipped: false }); toast('已恢复'); },
  'rest-on': (el) => { setRestDay(el.dataset.date, true); toast('😴 已设为休息日'); },
  'rest-off': (el) => { setRestDay(el.dataset.date, false); toast('已取消休息日'); },
  'fx-new': () => openFixedForm(),
  'fx-edit': (el) => { const tpl = store.get(el.dataset.id); if (tpl) openFixedForm(tpl); },
  'fx-stop': (el) => {
    if (!confirm('停止后不再出现，以前的完成记录会保留。确定？')) return;
    endFixed(el.dataset.id, el.dataset.date || today()); closeModal(); toast('已停止');
  },
  'fx-delete': (el) => {
    if (!confirm('会删除这个固定任务和以前每一天的完成记录，日历上也会消失。确定彻底删除？')) return;
    deleteFixedForever(el.dataset.id); closeModal(); toast('已彻底删除');
  },
  qd: (el) => {
    const v = el.dataset.v.split(',');
    $modal.querySelectorAll('input[name=days]').forEach((i) => { i.checked = v.includes(i.value); });
  },
  'clear-pause': () => { $modal.querySelectorAll('input[name=pauseFrom],input[name=pauseTo]').forEach((i) => { i.value = ''; }); },
  'sync-now': async () => { await sync.run(); toast(sync.state.error ? '同步失败：' + sync.state.error : '同步完成'); },
  'sign-out': () => {
    const n = sync.pendingCount;
    const msg = n ? `还有 ${n} 条修改没同步到云端，现在退出会留在本机、暂时不上传。确定退出？` : '退出后本机数据保留，但不再同步。确定退出？';
    if (confirm(msg)) disablePush().finally(() => { sync.signOut(); render(); });
  },
  'push-on': async (el) => {
    el.disabled = true;
    try { await enablePush(); toast('🔔 准点推送已开启'); } catch (e) { toast(e.message); }
    render();
  },
  forgot: () => {
    const email = document.querySelector('[data-form=sync-config] input[name=email]')?.value || '';
    openSheet('忘记密码', `
      <p class="muted small">输入注册时用的邮箱，我们会发一封重置密码的邮件。点邮件里的链接回到日拾，就能设置新密码。</p>
      <label>邮箱<input type="email" name="email" value="${esc(email)}" required autocapitalize="off" /></label>`,
    (fd) => {
      const em = fd.get('email').trim();
      if (!/.+@.+\..+/.test(em)) return '请填写正确的邮箱';
      sync.requestReset(em).then(() => toast('📮 邮件已发送，请查收（可能在垃圾箱里）')).catch((e) => toast(e.message));
    }, '发送');
  },
  'change-pw': () => openNewPassword('修改密码'),
  'delete-account': () => {
    openSheet('注销账户', `
      <p class="danger">注销后，这个账号和它在云端的<b>所有任务、固定任务、小记、复盘</b>都会被永久删除，所有设备上都无法恢复。</p>
      <p class="muted small">建议先在「数据 → 导出备份」保存一份。确认注销请在下面输入「注销」两个字。</p>
      <label>确认<input name="confirm" placeholder="注销" autocomplete="off" /></label>`,
    (fd) => {
      if (fd.get('confirm').trim() !== '注销') return '请输入「注销」两个字确认';
      disablePush().catch(() => {}); sync.deleteAccount().then(() => { toast('账户已注销，所有数据已删除'); render(); }).catch((e) => toast('注销失败：' + e.message));
    }, '永久注销');
  },
  'ask-notify': async () => { const r = await requestPermission(); toast(r === 'granted' ? '通知已开启' : '未开启通知'); render(); },
  export: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' }));
    a.download = `日拾备份-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (e.target === $modal) closeModal(); return; }
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('input', (e) => {
  if (e.target.closest('.edit-row')) editDirty = true;
  const rv = e.target.closest('.rv-text');
  if (rv) {
    autoGrow(rv);
    const tag = document.getElementById('rv-saved');
    if (tag) tag.textContent = '正在记录…';
    clearTimeout(rvTimer);
    rvTimer = setTimeout(() => saveRv(rv), 700);
  }
});
let rvTimer = null;
function saveRv(el) {
  saveReview(el.dataset.date, { [el.dataset.rv]: el.value });
  const tag = document.getElementById('rv-saved');
  if (tag) tag.textContent = '已保存 ✓';
}
// 复盘输入框：字多时只预览前 3 行，可展开；正在输入时自动完整显示
const rvExpanded = new Set();
const RV_CAP = 3 * 24 + 12;
function autoGrow(el) {
  el.style.height = 'auto';
  const full = el.scrollHeight + 2;
  const key = `${el.dataset.date}|${el.dataset.rv}`;
  const open = rvExpanded.has(key) || document.activeElement === el;
  const long = full > RV_CAP + 4;
  el.style.height = (long && !open ? RV_CAP : full) + 'px';
  el.classList.toggle('clamped', long && !open);
  const more = el.parentElement.querySelector('.rv-more');
  if (more) {
    more.hidden = !long || document.activeElement === el;
    more.textContent = rvExpanded.has(key) ? '收起 ▴' : '展开全文 ▾';
  }
}
document.addEventListener('focusin', (e) => { if (e.target.classList?.contains('rv-text')) autoGrow(e.target); });
document.addEventListener('focusout', (e) => {
  const rv = e.target.closest?.('.rv-text');
  if (rv) { clearTimeout(rvTimer); saveRv(rv); setTimeout(() => autoGrow(rv), 0); }
});

// 编辑行里按回车：新增一行
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || !e.target.classList.contains('er-title')) return;
  e.preventDefault();
  const row = e.target.closest('.edit-row');
  const next = row.nextElementSibling;
  if (next && !next.querySelector('.er-title').value) next.querySelector('.er-title').focus();
  else addRow(row);
});

document.addEventListener('change', async (e) => {
  const el = e.target.closest('[data-act-change]');
  if (!el) return;
  if (el.dataset.actChange === 'pick-day' && el.value) go('day/' + el.value);
  if (el.dataset.actChange === 'import') {
    const f = el.files[0];
    if (!f) return;
    try { store.importJSON(await f.text()); toast('导入成功'); } catch (err) { toast('导入失败：' + err.message); }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  const kind = form.dataset.form;

  if (kind === 'sheet') {
    const err = $modal._submit?.(fd);
    if (typeof err === 'string') { toast(err); return; }
    closeModal();
    return;
  }
  if (kind === 'note-add') {
    const text = (fd.get('text') || '').trim();
    if (!text) { toast('先写点什么吧'); return; }
    const ta = form.querySelector('textarea'); ta.value = ''; ta.blur();
    addNote(noteUI.kind, text);
    toast(noteUI.kind === 'idea' ? '💡 灵感已记下' : '📝 已记下');
    return;
  }
  if (kind === 'dl-add') {
    const title = fd.get('title').trim();
    if (!title || !fd.get('date')) return;
    store.put('deadline', { title, date: fd.get('date'), done: false });
    toast('已加入时间轴');
    maybeAskNotify();
    return;
  }
  if (kind === 'dl-edit') {
    const title = fd.get('title').trim();
    if (!title || !fd.get('date')) return;
    store.put('deadline', { title, date: fd.get('date') }, form.dataset.id);
    closeModal(); toast('已保存');
    return;
  }
  if (kind === 'sync-config') {
    const url = (fd.get('url') || '').trim(), key = (fd.get('key') || '').trim();
    const email = (fd.get('email') || '').trim(), password = fd.get('password') || '';
    if (!/^https?:\/\/.+/.test(url) || !key) { toast('请填写正确的项目地址和公开密钥'); return; }
    if (!email || password.length < 6) { toast('请填写邮箱和至少 6 位的密码'); return; }
    sync.setConfig(url, key);
    const btns = form.querySelectorAll('button');
    btns.forEach((b) => (b.disabled = true));
    try {
      if ((e.submitter?.value || 'signin') === 'signup') {
        const r = await sync.signUp(email, password);
        toast(r === 'confirm' ? '注册成功！请去邮箱点确认链接，然后回来登录' : '注册成功，已开始同步');
      } else {
        await sync.signIn(email, password);
        refreshPushAfterLogin();
        toast(sync.state.error ? '登录成功，但同步出错：' + sync.state.error : '登录成功，已同步');
      }
    } catch (err) { toast(err.message); } finally { btns.forEach((b) => (b.disabled = false)); render(); }
  }
});

/* ---------- 启动 ---------- */
// 可爱字体：能访问 Google Fonts 时加载，不能访问时自动用系统字体，不影响打开速度
(() => {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap';
  document.head.append(l);
})();

let queued = false;
const scheduleRender = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const p = route().page;
    // 正在编辑或输入时不重绘，避免内容被覆盖
    if (p === 'edit' && editDirty) return;
    if ((p === 'settings' || p === 'notes' || p === 'day') && document.activeElement?.matches('input, textarea')) return;
    render();
  });
};
store.subscribe(scheduleRender);
sync.subscribe(scheduleRender);

let day = today();
setInterval(() => { if (today() !== day) { day = today(); render(); } }, 30000);
window.addEventListener('hashchange', () => { if (route().page !== 'edit') editDirty = false; });

render();
handleAuthHash();
refreshPushSilently();
if (route().page === 'calendar') document.getElementById('cur-month')?.scrollIntoView({ block: 'start' });
startReminderLoop();
sync.run();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 注册失败', e));
}
