// 复盘照片：手机上先压缩 → 存进本机 IndexedDB（离线也能看）→ 联网后上传到 Supabase Storage 的私密存储桶
//
// 云端路径：review-photos/<用户 ID>/<照片 ID>.<扩展名>
//   - 存储桶是私密的，RLS 规则只允许本人读写自己 <用户 ID>/ 下的文件（见 photos.sql）
//   - 复盘数据里只记 { id, ext }，路径由当前登录账号拼出来，换设备同样能找到
// 免费额度：压缩后每张约 100–200 KB；每台设备每张只下载一次，之后从本机读取，几乎不耗流量
import { sync } from './sync.js';
import { getReview, saveReview } from './store.js';
import { uid } from './utils.js';

export const BUCKET = 'review-photos';
export const MAX_PER_DAY = 3;
const MAX_SIDE = 1280;           // 压缩后最长边
const QUALITY = 0.8;
const TRASH_KEY = 'daily.photos.trash';   // 待删除的云端照片 [{ id, ext }]

/* ---------- 本机存储（IndexedDB） ---------- */
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('rishi-photos', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const getLocal = (id) => idb('readonly', (s) => s.get(id));
const putLocal = (rec) => idb('readwrite', (s) => s.put(rec));
const delLocal = (id) => idb('readwrite', (s) => s.delete(id));
const allLocal = () => idb('readonly', (s) => s.getAll());

const urls = new Map();   // id -> objectURL（本次打开 App 内复用）

export async function clearLocalPhotos() {
  await idb('readwrite', (s) => s.clear());
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

const readTrash = () => { try { return JSON.parse(localStorage.getItem(TRASH_KEY)) || []; } catch { return []; } };
const writeTrash = (t) => { try { localStorage.setItem(TRASH_KEY, JSON.stringify(t)); } catch {} };

/* ---------- 压缩 ---------- */
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });   // 按拍摄方向转正
  } catch {
    // 个别浏览器不支持这个参数：退回 <img> 解码（现代浏览器的 <img> 会按 EXIF 方向显示）
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function compress(file) {
  let img;
  try {
    img = await decode(file);
  } catch {
    throw new Error('这张图片打不开（可能是 HEIC 格式），换一张试试');
  }
  const w = img.width, h = img.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';                     // 透明 PNG 铺白底，避免变黑
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const toBlob = (type) => new Promise((r) => canvas.toBlob(r, type, QUALITY));
  // 优先 WebP（更小）；旧版 Safari 不支持导出 WebP 时会悄悄给 PNG，这时改用 JPEG
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');
  if (!blob) throw new Error('图片压缩失败，换一张试试');
  return { blob, ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
}

/* ---------- 增删 ---------- */
export const reviewPhotos = (date) => (getReview(date)?.photos || []);

/** 给某天的复盘加照片；返回 { added, skipped } */
export async function addPhotos(date, files) {
  const left = MAX_PER_DAY - reviewPhotos(date).length;
  const picked = [...files].slice(0, Math.max(0, left));
  let added = 0;
  for (const file of picked) {
    const { blob, ext } = await compress(file);
    const id = uid();
    await putLocal({ id, ext, blob, uploaded: false });
    // 每张都重新读一次，避免连续添加时互相覆盖
    saveReview(date, { photos: [...reviewPhotos(date), { id, ext }] });
    added++;
  }
  if (added) uploadPending();
  return { added, skipped: files.length - added };
}

export async function removePhoto(date, id) {
  const photo = reviewPhotos(date).find((p) => p.id === id);
  if (!photo) return;
  saveReview(date, { photos: reviewPhotos(date).filter((p) => p.id !== id) });
  const local = await getLocal(id);
  // 还没上传过的只删本机；其余（包括别的设备传的）记到待删除，联网后删云端
  if (!local || local.uploaded) writeTrash([...readTrash(), { id, ext: photo.ext }]);
  await delLocal(id);
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  uploadPending();
}

/* ---------- 显示 ---------- */
/** 返回 { url, pending }；本机没有时从云端下载一次并存到本机 */
export async function photoURL(photo) {
  const local = await getLocal(photo.id);
  if (local) {
    if (!urls.has(photo.id)) urls.set(photo.id, URL.createObjectURL(local.blob));
    return { url: urls.get(photo.id), pending: !local.uploaded };
  }
  if (!sync.ready || !navigator.onLine) return { url: '', pending: false };
  const res = await storageFetch(`/object/authenticated/${BUCKET}/${path(photo)}`);
  const blob = await res.blob();
  await putLocal({ id: photo.id, ext: photo.ext, blob, uploaded: true });
  urls.set(photo.id, URL.createObjectURL(blob));
  return { url: urls.get(photo.id), pending: false };
}

/* ---------- 云端 ---------- */
const path = (photo) => `${sync.user.id}/${photo.id}.${photo.ext}`;

async function storageFetch(p, { method = 'GET', body, headers = {} } = {}) {
  const token = await sync.token();
  const res = await fetch(`${sync.baseUrl}/storage/v1${p}`, {
    method,
    body,
    headers: { apikey: sync.apiKey, Authorization: `Bearer ${token}`, ...headers },
  });
  if (!res.ok) {
    let msg = `照片${method === 'GET' ? '下载' : '同步'}失败 (${res.status})`;
    try {
      const d = await res.json();
      if (/bucket not found/i.test(d.message || d.error || '')) msg = '云端还没有照片存储：请管理员先运行 photos.sql';
      else if (d.message) msg += '：' + d.message;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res;
}

let running = false;
/** 上传本机还没上传的照片、删除云端待删除的照片；随数据同步自动调用 */
export async function uploadPending() {
  if (running || !sync.ready || !navigator.onLine) return;
  running = true;
  try {
    for (const rec of await allLocal()) {
      if (rec.uploaded) continue;
      await storageFetch(`/object/${BUCKET}/${path(rec)}`, {
        method: 'POST',
        body: rec.blob,
        headers: { 'Content-Type': rec.blob.type, 'x-upsert': 'true', 'cache-control': '31536000' },
      });
      await putLocal({ ...rec, uploaded: true });
      document.querySelectorAll(`[data-photo="${rec.id}"]`).forEach((el) => el.classList.remove('pending'));
    }
    const trash = readTrash();
    if (trash.length) {
      await storageFetch(`/object/${BUCKET}`, {
        method: 'DELETE',
        body: JSON.stringify({ prefixes: trash.map(path) }),
        headers: { 'Content-Type': 'application/json' },
      });
      // 删除期间又新增的待删除项保留
      const done = new Set(trash.map((t) => t.id));
      writeTrash(readTrash().filter((t) => !done.has(t.id)));
    }
  } catch (e) {
    console.warn('照片同步失败', e);
  } finally {
    running = false;
  }
}

/** 注销账户前：删除这个账号在云端的全部照片，并清空本机照片 */
export async function deleteAllCloudPhotos() {
  if (sync.ready) {
    const prefix = sync.user.id;
    for (let round = 0; round < 100; round++) {
      const list = await (await storageFetch(`/object/list/${BUCKET}`, {
        method: 'POST',
        body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
        headers: { 'Content-Type': 'application/json' },
      })).json();
      const names = (list || []).filter((o) => o.id).map((o) => `${prefix}/${o.name}`);
      if (!names.length) break;
      await storageFetch(`/object/${BUCKET}`, {
        method: 'DELETE',
        body: JSON.stringify({ prefixes: names }),
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  writeTrash([]);
  await clearLocalPhotos();
}

/** 把页面里 <img data-pid> 换成真实图片（异步加载，本机没有时从云端下载） */
export function hydratePhotos(root) {
  root.querySelectorAll('[data-photo]').forEach(async (box) => {
    const img = box.querySelector('img');
    try {
      const { url, pending } = await photoURL({ id: box.dataset.photo, ext: box.dataset.ext });
      if (url) { img.src = url; box.classList.add('loaded'); }
      else box.classList.add('missing');
      box.classList.toggle('pending', pending);
    } catch {
      box.classList.add('missing');
    }
  });
}

// 每次数据同步完成后顺便同步照片
let lastSync = null;
sync.subscribe(() => {
  const s = sync.state;
  if (!s.syncing && s.lastSync && s.lastSync !== lastSync) {
    lastSync = s.lastSync;
    uploadPending();
  }
});
window.addEventListener('online', () => uploadPending());
