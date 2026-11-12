// 准点推送：把这台设备登记到云端，由服务器在 07:30 / 23:00 准时推送（App 关着也能收到）
import { sync } from './sync.js';
import { VAPID_PUBLIC_KEY } from './config.js';

const ON_KEY = 'daily.push.on';
const EP_KEY = 'daily.push.endpoint';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC_KEY;
export const pushOn = () => get(ON_KEY) === '1';

function keyBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// 开启（或刷新）这台设备的推送订阅
export async function enablePush({ ask = true } = {}) {
  if (!pushSupported()) throw new Error('这台设备不支持推送：iPhone / iPad 需要先「添加到主屏幕」，再从主屏幕打开');
  if (!sync.ready) throw new Error('请先登录账号，推送需要知道发给谁');
  let perm = Notification.permission;
  if (perm === 'default' && ask) perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('没有通知权限：请到系统设置里允许「日拾」发送通知');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await sync.call('/rest/v1/rpc/save_push_subscription', {
    method: 'POST',
    body: { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai' },
  });
  set(ON_KEY, '1'); set(EP_KEY, j.endpoint);
  return true;
}

// 退出登录前调用：这台设备不再接收这个账号的推送
export async function disablePush() {
  const ep = get(EP_KEY);
  set(ON_KEY, null);
  try {
    if (ep && sync.ready) await sync.call(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE' });
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch (e) { console.warn(e); }
  set(EP_KEY, null);
}

export async function testPush() {
  const res = await fetch(`${sync.baseUrl}/functions/v1/send-reminders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: sync.apiKey, Authorization: `Bearer ${await sync.token()}` },
    body: JSON.stringify({ test: true }),
  });
  if (res.status === 404) throw new Error('云端还没有部署推送函数 send-reminders');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.msg || `测试失败（${res.status}）`);
  if (!data.devices) throw new Error('云端没有找到这台设备的订阅，请先点「开启准点推送」');
  return data;
}

// App 启动时：之前开过推送，就静默刷新一次订阅（订阅地址偶尔会变）
export function refreshPushSilently() {
  if (pushOn() && pushSupported() && sync.ready && Notification.permission === 'granted') {
    enablePush({ ask: false }).catch((e) => console.warn('刷新推送订阅失败', e));
  }
}
