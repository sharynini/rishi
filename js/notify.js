// 提醒：每天 07:30 今日任务 + 截止提醒；23:00 未完成任务
import { tasksOn, deadlinesToRemind } from './store.js';
import { today, pad, diffDays } from './utils.js';

export const MORNING = '07:30';
export const NIGHT = '23:00';
const SENT_KEY = 'daily.notified.v2';

export const notifySupported = () => 'Notification' in window;
export const permission = () => (notifySupported() ? Notification.permission : 'unsupported');
export async function requestPermission() {
  if (!notifySupported()) return 'unsupported';
  return Notification.requestPermission();
}

function sentSet() {
  try {
    const o = JSON.parse(localStorage.getItem(SENT_KEY) || '{}');
    return o.date === today() ? new Set(o.ids) : new Set();
  } catch { return new Set(); }
}
const markSent = (set) => { try { localStorage.setItem(SENT_KEY, JSON.stringify({ date: today(), ids: [...set] })); } catch {} };

let toastHandler = null;
export const onInAppToast = (fn) => { toastHandler = fn; };

async function show(title, body, tag) {
  // 开了准点推送就交给服务器发，避免同一条提醒收到两次
  try { if (localStorage.getItem('daily.push.on') === '1') return; } catch {}
  if (permission() === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) { await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png' }); return; }
      new Notification(title, { body, tag, icon: 'icons/icon-192.png' });
      return;
    } catch (e) { console.warn(e); }
  }
  toastHandler?.(`${title}：${body}`);
}

const list = (arr, n = 4) => arr.slice(0, n).map((t) => (t.time ? t.time + ' ' : '') + t.title).join('、') + (arr.length > n ? ` 等 ${arr.length} 项` : '');

export function checkReminders() {
  const now = new Date();
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const t = today();
  const sent = sentSet();
  const before = sent.size;

  if (hm >= MORNING && !sent.has('morning')) {
    sent.add('morning');
    const ts = tasksOn(t);
    if (ts.length) show(`今天有 ${ts.length} 个任务`, list(ts), 'morning');
    for (const d of deadlinesToRemind()) {
      const n = diffDays(t, d.date);
      show('截止提醒', n === 0 ? `「${d.title}」今天截止！` : `「${d.title}」还有 ${n} 天截止（${d.date}）`, 'dl-' + d.id);
    }
  }
  if (hm >= NIGHT && !sent.has('night')) {
    sent.add('night');
    const left = tasksOn(t).filter((x) => !x.done);
    if (left.length) show(`还有 ${left.length} 个任务没完成`, list(left) + '。做完记得写写今日复盘哦 🌙', 'night');
    else show('🌙 今天辛苦啦', '花几分钟写写今日复盘吧～', 'night');
  }
  if (sent.size !== before) markSent(sent);
}

export function startReminderLoop() {
  checkReminders();
  setInterval(checkReminders, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkReminders(); });
}
