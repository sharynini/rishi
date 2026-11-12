// Supabase 云同步（直接调用 REST 接口，无需 SDK）
import { store } from './store.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const CFG_KEY = 'daily.sync.cfg';
const SESSION_KEY = 'daily.sync.session';
const STATE_KEY = 'daily.sync.state';

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const OWNER_KEY = 'daily.sync.owner';   // 本机数据属于哪个账号（换账号登录时不把别人的数据传上去）
export const BUILTIN = !!(SUPABASE_URL && SUPABASE_KEY);
let cfg = read(CFG_KEY, { url: '', key: '' });
let session = read(SESSION_KEY, null);       // { access_token, refresh_token, expires_at, user: {id,email} }
if (BUILTIN && (cfg.url !== SUPABASE_URL.trim() || cfg.key !== SUPABASE_KEY.trim())) {
  if (cfg.url && cfg.url.replace(/\/+$/, '') !== SUPABASE_URL.trim().replace(/\/+$/, '')) session = null;
  cfg = { url: SUPABASE_URL.trim(), key: SUPABASE_KEY.trim() };
  write(CFG_KEY, cfg); write(SESSION_KEY, session);
}
let state = read(STATE_KEY, { lastPull: null, lastSync: null, error: '' });
let syncing = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

const base = () => cfg.url.replace(/\/+$/, '');

async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const h = { apikey: cfg.key, 'Content-Type': 'application/json', ...headers };
  if (auth) {
    await ensureFresh();
    h.Authorization = `Bearer ${session?.access_token || cfg.key}`;
  }
  const res = await fetch(base() + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.msg || data?.error_description || data?.message || data?.error || `请求失败 (${res.status})`;
    const err = new Error(translate(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

function translate(msg) {
  const m = String(msg);
  if (/Invalid login credentials/i.test(m)) return '邮箱或密码不正确';
  if (/Email not confirmed/i.test(m)) return '邮箱还没验证：请去邮箱点确认链接，或在 Supabase 关闭「Confirm email」';
  if (/already registered/i.test(m)) return '这个邮箱已经注册过了，直接登录即可';
  if (/Password should be/i.test(m)) return '密码至少 6 位';
  if (/relation .*items.* does not exist/i.test(m)) return '云端还没有 items 表：请先在 Supabase 运行 supabase.sql';
  if (/Failed to fetch/i.test(m)) return '网络连接失败，请检查网络或项目地址';
  if (/Signups not allowed/i.test(m)) return '暂不开放注册，请联系 App 的管理员';
  if (/after \d+ seconds|rate limit/i.test(m)) return '操作太频繁了，请过一会儿再试';
  if (/same.*password|different from the old/i.test(m)) return '新密码不能和旧密码一样';
  if (/Error sending recovery email|sending.*email/i.test(m)) return '邮件发送失败：管理员还没在 Supabase 配置发信邮箱（SMTP）';
  if (/delete_my_account/i.test(m)) return '云端还没有注销功能：请管理员先运行 supabase-update.sql';
  if (/User not found/i.test(m)) return '账号不存在';
  return m;
}

function saveSession(s) {
  session = s ? {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
    user: { id: s.user?.id, email: s.user?.email },
  } : null;
  write(SESSION_KEY, session);
  notify();
}

async function ensureFresh() {
  if (!session) return;
  if (session.expires_at - 60 > Date.now() / 1000) return;
  const res = await fetch(`${base()}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) { saveSession(null); throw new Error('登录已过期，请重新登录'); }
  saveSession(await res.json());
}

function setState(patch) { state = { ...state, ...patch }; write(STATE_KEY, state); notify(); }

export const sync = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get config() { return { ...cfg }; },
  get user() { return session?.user || null; },
  get state() { return { ...state, syncing }; },
  get configured() { return !!(cfg.url && cfg.key); },
  get ready() { return this.configured && !!session; },

  setConfig(url, key) {
    const changed = url !== cfg.url;
    cfg = { url: url.trim(), key: key.trim() };
    write(CFG_KEY, cfg);
    if (changed) { saveSession(null); setState({ lastPull: null, lastSync: null, error: '' }); }
    notify();
  },

  async signUp(email, password) {
    const data = await api('/auth/v1/signup', { method: 'POST', auth: false, body: { email, password } });
    if (data?.access_token) { saveSession(data); await this.firstSync(); return 'ok'; }
    return 'confirm'; // 需要邮箱确认
  },
  async signIn(email, password) {
    const data = await api('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
    saveSession(data);
    await this.firstSync();
  },
  signOut() {
    saveSession(null);
    setState({ lastPull: null, lastSync: null, error: '' });
  },
  get pendingCount() { return store.dirtyItems().length; },
  // 给推送等功能用：带登录令牌调用接口
  async call(path, opts = {}) { return api(path, opts); },
  async token() { await ensureFresh(); return session?.access_token || ''; },
  get baseUrl() { return base(); },
  get apiKey() { return cfg.key; },

  // 忘记密码：发重置邮件，邮件里的链接会回到本 App
  async requestReset(email) {
    const back = location.origin + location.pathname;
    await api(`/auth/v1/recover?redirect_to=${encodeURIComponent(back)}`, { method: 'POST', auth: false, body: { email } });
  },
  // 从邮件链接回来时，读取地址栏里的登录信息；返回 'recovery' / 错误信息 / null
  async consumeAuthHash() {
    const h = location.hash.replace(/^#\/?/, '');
    if (!/access_token=|error_description=/.test(h)) return null;
    const q = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + '#/settings');
    if (q.get('error_description')) {
      const d = q.get('error_description');
      return { error: /expired|invalid/i.test(d) ? '链接已过期或已使用，请重新点「忘记密码」' : d };
    }
    const token = q.get('access_token');
    const res = await fetch(`${base()}/auth/v1/user`, { headers: { apikey: cfg.key, Authorization: `Bearer ${token}` } });
    if (!res.ok) return { error: '链接已失效，请重新点「忘记密码」' };
    const user = await res.json();
    saveSession({ access_token: token, refresh_token: q.get('refresh_token'), expires_in: Number(q.get('expires_in')) || 3600, user });
    await this.firstSync();
    return { type: q.get('type') || 'login' };
  },
  async updatePassword(password) {
    await api('/auth/v1/user', { method: 'PUT', body: { password } });
  },
  // 注销账户：删除云端账号和全部数据，并清空本机
  async deleteAccount() {
    await api('/rest/v1/rpc/delete_my_account', { method: 'POST', body: {} });
    store.clearAll();
    try { localStorage.removeItem(OWNER_KEY); } catch {}
    this.signOut();
  },

  // 首次登录：把本机已有数据全部推上去，再拉取云端
  async firstSync() {
    const uid = session?.user?.id;
    const owner = read(OWNER_KEY, null);
    if (uid && owner && owner !== uid) store.clearAll();   // 换了另一个账号：本机旧数据属于别人，不上传
    if (uid) write(OWNER_KEY, uid);
    store.markAllDirty();
    setState({ lastPull: null });
    await this.run();
  },

  async run() {
    if (!this.ready || syncing) return;
    if (!navigator.onLine) { setState({ error: '离线中，联网后自动同步' }); return; }
    syncing = true; notify();
    try {
      // 1. 拉取云端变化（按服务器时间增量）
      let q = '/rest/v1/items?select=id,type,data,updated_at,deleted,server_updated_at&order=server_updated_at.asc&limit=1000';
      if (state.lastPull) q += `&server_updated_at=gt.${encodeURIComponent(state.lastPull)}`;
      let lastPull = state.lastPull;
      for (let page = 0; page < 50; page++) {
        const rows = await api(q + `&offset=${page * 1000}`);
        if (!rows.length) break;
        store.mergeRemote(rows);
        lastPull = rows[rows.length - 1].server_updated_at;
        if (rows.length < 1000) break;
      }
      // 2. 推送本地改动
      const pending = store.dirtyItems();
      for (let i = 0; i < pending.length; i += 200) {
        const chunk = pending.slice(i, i + 200);
        await api('/rest/v1/items?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: chunk.map((it) => ({ id: it.id, type: it.type, data: it.data, updated_at: it.updated_at, deleted: !!it.deleted })),
        });
        store.clearDirty(chunk.map((c) => c.id));
      }
      setState({ lastPull, lastSync: new Date().toISOString(), error: '' });
    } catch (e) {
      console.warn('同步失败', e);
      setState({ error: e.message });
    } finally {
      syncing = false; notify();
    }
  },
};

// 自动同步：本地修改后 1.5 秒、回到前台、恢复联网、每 60 秒
let debounce = null;
store.subscribe((fromRemote) => {
  if (fromRemote || !sync.ready) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => sync.run(), 1500);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.run(); });
window.addEventListener('online', () => sync.run());
setInterval(() => { if (document.visibilityState === 'visible') sync.run(); }, 60000);
