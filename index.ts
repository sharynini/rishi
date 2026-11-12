// 日拾 · 准点推送（Supabase Edge Function：send-reminders）
// 由定时任务每分钟调用一次：到 07:30 推送今日任务 + 截止提醒，到 23:00 推送未完成任务 + 复盘提醒。
// 也支持 App 里的「发送测试推送」。
// 需要在 Edge Functions → Secrets 里设置：VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、CRON_SECRET
// （SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动提供）

const MORNING = '07:30';
const NIGHT = '23:00';
const REMIND_DAYS = [7, 5, 2, 0];
const SUBJECT = 'mailto:rishi-app@example.com';

const env = (k: string) => (globalThis as any).Deno?.env.get(k) ?? (globalThis as any).process?.env?.[k] ?? '';
const SB_URL = () => env('SUPABASE_URL').replace(/\/+$/, '');
const SB_KEY = () => env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');

/* ================= Web Push 加密（RFC 8291 / 8292，纯 WebCrypto） ================= */
const te = new TextEncoder();
const b64u = {
  enc(buf: ArrayBuffer | Uint8Array) { let s = ''; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str: string) { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); },
};
const concat = (...arrs: Uint8Array[]) => { const o = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0)); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function encryptPayload(payload: string, p256dh: string, authSecret: string) {
  const uaPublic = b64u.dec(p256dh), auth = b64u.dec(authSecret);
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as any, kp.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(te.encode(payload), new Uint8Array([2]))));
  return concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPublic.length]), asPublic, ct);
}
let vapidKey: CryptoKey | null = null;
async function vapidHeader(endpoint: string) {
  const pub = b64u.dec(env('VAPID_PUBLIC_KEY'));
  if (!vapidKey) {
    vapidKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env('VAPID_PRIVATE_KEY'), x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const head = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey, te.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${env('VAPID_PUBLIC_KEY')}`;
}
// 返回 HTTP 状态码；404/410 表示订阅已失效
async function sendPush(sub: any, msg: { title: string; body: string; tag?: string; url?: string }) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body: await encryptPayload(JSON.stringify(msg), sub.p256dh, sub.auth),
  });
  return res.status;
}

/* ================= 数据读取（service role，绕过行级安全，只在服务器上用） ================= */
async function db(path: string, init: RequestInit = {}) {
  const key = SB_KEY();
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json', ...(init.headers as any) };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
// 去重：同一用户同一天同一类提醒只发一次（插入成功才发）
async function claim(userId: string, kind: string, day: string) {
  const rows = await db('push_log?on_conflict=user_id,kind,day', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([{ user_id: userId, kind, day }]),
  });
  return Array.isArray(rows) && rows.length > 0;
}

/* ================= 提醒内容（和 App 里的逻辑一致） ================= */
const pad = (n: number) => String(n).padStart(2, '0');
function localNow(tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}
const dayNum = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const weekday = (s: string) => new Date(dayNum(s) * 86400000).getUTCDay();
const diffDays = (a: string, b: string) => dayNum(b) - dayNum(a);

export function tasksOn(items: any[], date: string) {
  const dtasks = items.filter((i) => i.type === 'dtask');
  const oneoff = dtasks.filter((t) => !t.data.fixedId && t.data.date === date).map((t) => ({ ...t.data }));
  const overrides = new Map(dtasks.filter((t) => t.data.fixedId).map((t) => [t.id, t.data]));
  const rest = items.some((i) => i.type === 'rest' && i.data.date === date);
  const fixed: any[] = [];
  if (!rest) {
    for (const t of items.filter((i) => i.type === 'fixed')) {
      const f = t.data;
      if (!(f.days || []).includes(weekday(date))) continue;
      if (f.from && f.from > date) continue;
      if (f.until && date > f.until) continue;
      if (f.pauseFrom && date >= f.pauseFrom && (!f.pauseTo || date <= f.pauseTo)) continue;
      const o: any = overrides.get(`fx|${t.id}|${date}`) || {};
      if (o.skipped) continue;
      fixed.push({ title: o.title ?? f.title, time: o.time ?? f.time ?? '', done: !!o.done });
    }
  }
  return [...oneoff, ...fixed].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}
const list = (arr: any[], n = 4) => arr.slice(0, n).map((t) => (t.time ? t.time + ' ' : '') + t.title).join('、') + (arr.length > n ? ` 等 ${arr.length} 项` : '');

export function buildMessages(items: any[], day: string, kind: 'morning' | 'night') {
  const out: { title: string; body: string; tag: string; url: string }[] = [];
  const ts = tasksOn(items, day);
  if (kind === 'morning') {
    if (ts.length) out.push({ title: `☀️ 今天有 ${ts.length} 个任务`, body: list(ts), tag: 'morning', url: './#/day' });
    for (const d of items.filter((i) => i.type === 'deadline' && !i.data.done && i.data.date)) {
      const n = diffDays(day, d.data.date);
      if (REMIND_DAYS.includes(n)) out.push({ title: '⏰ 截止提醒', body: n === 0 ? `「${d.data.title}」今天截止！` : `「${d.data.title}」还有 ${n} 天截止（${d.data.date}）`, tag: 'dl-' + d.id, url: './#/timeline' });
    }
  } else {
    const left = ts.filter((t) => !t.done);
    out.push(left.length
      ? { title: `🌙 还有 ${left.length} 个任务没完成`, body: list(left) + '。做完记得写写今日复盘哦', tag: 'night', url: './#/day' }
      : { title: '🌙 今天辛苦啦', body: '花几分钟写写今日复盘吧～', tag: 'night', url: './#/day' });
  }
  return out;
}

async function pushToUser(subs: any[], msgs: any[]) {
  let sent = 0;
  for (const s of subs) {
    for (const m of msgs) {
      try {
        const st = await sendPush(s, m);
        if (st === 404 || st === 410) { await db(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }); break; }
        if (st < 300) sent++;
      } catch (e) { console.error('push failed', e); }
    }
  }
  return sent;
}

/* ================= 入口 ================= */
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (obj: any, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));

  // App 里点「发送测试推送」：用用户自己的登录令牌确认身份
  if (body.test) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const ur = await fetch(`${SB_URL()}/auth/v1/user`, { headers: { apikey: SB_KEY(), Authorization: `Bearer ${token}` } });
    if (!ur.ok) return json({ error: '未登录' }, 401);
    const user = await ur.json();
    const subs = await db(`push_subscriptions?user_id=eq.${user.id}&select=*`);
    const sent = await pushToUser(subs, [{ title: '🌷 日拾', body: '测试推送成功！以后每天 07:30 和 23:00 会准时提醒你', tag: 'test', url: './#/day' }]);
    return json({ ok: true, devices: subs.length, sent });
  }

  // 定时任务
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'forbidden' }, 403);
  const subs = await db('push_subscriptions?select=*');
  const byUser = new Map<string, any[]>();
  for (const s of subs) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id)!.push(s); }
  const report: any[] = [];
  for (const [userId, us] of byUser) {
    const { day, hm } = localNow(us[0].tz);
    const kind = hm >= NIGHT ? 'night' : hm >= MORNING && hm < '12:00' ? 'morning' : null;
    if (!kind) continue;
    if (!(await claim(userId, kind, day))) continue;
    const items = await db(`items?user_id=eq.${userId}&deleted=eq.false&type=in.(dtask,fixed,rest,deadline)&select=id,type,data`);
    const msgs = buildMessages(items, day, kind);
    const sent = msgs.length ? await pushToUser(us, msgs) : 0;
    report.push({ userId, kind, day, msgs: msgs.length, sent });
  }
  return json({ ok: true, report });
}

(globalThis as any).Deno?.serve(handler);
