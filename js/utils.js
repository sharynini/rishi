// 通用工具：日期、转义、ID
export const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// b - a 的天数
export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export const today = () => toDateStr(new Date());

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
export const weekdayOf = (s) => parseDate(s).getDay();
export const weekdayName = (i) => '周' + WEEK[i];

export function formatDate(s, withWeek = true) {
  const d = parseDate(s);
  const t = new Date();
  const base = d.getFullYear() === t.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return withWeek ? `${base} ${weekdayName(d.getDay())}` : base;
}

// 相对日期描述：今天/明天/还有N天/已过N天
export function relDays(s) {
  const n = diffDays(today(), s);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === -1) return '昨天';
  return n > 0 ? `还有 ${n} 天` : `已过 ${-n} 天`;
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function timeAgo(iso) {
  if (!iso) return '从未';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return new Date(iso).toLocaleString('zh-CN');
}
