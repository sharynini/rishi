// 核心数据逻辑测试：本地仓库与同步合并、每周固定任务、截止提醒、复盘、日历
// 运行：npm test（或 node --test tests/*.test.js），只用 Node 自带的测试工具，无需安装依赖
import './_env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  store, tasksOn, fixedOn, addFixed, updateFixed, endFixed, setRestDay, saveDay, setFixedDay, toggleTask,
  fixedInstId, deadlinesToRemind, saveReview, getReview, reviewPhotoDates, calendarData,
} from '../js/store.js';
import { addDays, today, diffDays, weekdayOf } from '../js/utils.js';

// 2026-11-16 是周一；固定任务按「周几」展开
const MON = '2026-11-16', TUE = '2026-11-17', NEXT_MON = '2026-11-23';
const titles = (list) => list.map((t) => t.title);

beforeEach(() => {
  store.clearAll();
  store.clearDirty(store.dirtyItems().map((i) => i.id));
});

/* ---------------- 工具函数 ---------------- */
test('日期工具：跨月加减、相差天数、星期', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(diffDays('2026-11-16', '2026-11-23'), 7);
  assert.equal(weekdayOf(MON), 1);
});

/* ---------------- 本地仓库 + 同步合并 ---------------- */
test('修改后标记为待同步；删除只打墓碑标记，同步时把删除也推上去', () => {
  const id = store.put('dtask', { date: MON, title: '背单词' });
  assert.deepEqual(store.dirtyItems().map((i) => i.id), [id]);
  store.clearDirty([id]);

  store.remove(id);
  assert.equal(store.get(id), null);                       // 界面上看不到了
  const [tomb] = store.dirtyItems();
  assert.equal(tomb.id, id);
  assert.equal(tomb.deleted, true);                        // 但仍会推送给其他设备
});

test('合并云端数据：更新时间较新的一方胜出（Last-Write-Wins）', () => {
  const id = store.put('dtask', { date: MON, title: '本机版本' });
  const local = store.dirtyItems()[0];

  // 云端是旧数据：忽略，本机修改仍待推送
  store.mergeRemote([{ id, type: 'dtask', data: { date: MON, title: '旧版本' }, updated_at: '2000-01-01T00:00:00Z', deleted: false }]);
  assert.equal(store.get(id).title, '本机版本');
  assert.equal(store.dirtyItems().length, 1);

  // 云端更新：覆盖本机，且不再重复推送
  const newer = new Date(Date.parse(local.updated_at) + 1000).toISOString();
  store.mergeRemote([{ id, type: 'dtask', data: { date: MON, title: '另一台设备改的' }, updated_at: newer, deleted: false }]);
  assert.equal(store.get(id).title, '另一台设备改的');
  assert.equal(store.dirtyItems().length, 0);
});

test('合并云端数据：其他设备的删除（墓碑）会同步过来', () => {
  const id = store.put('dtask', { date: MON, title: '要被删掉' });
  store.clearDirty([id]);
  store.mergeRemote([{ id, type: 'dtask', data: { date: MON, title: '要被删掉' }, updated_at: '2999-01-01T00:00:00Z', deleted: true }]);
  assert.equal(store.get(id), null);
  assert.deepEqual(tasksOn(MON), []);
});

test('数据会写入 localStorage，刷新后仍在', async () => {
  store.put('dtask', { date: MON, title: '持久化' });
  await new Promise((r) => setTimeout(r, 80));            // 写盘有 50ms 防抖
  const saved = JSON.parse(localStorage.getItem('daily.items.v1'));
  assert.ok(saved.some((it) => it.data.title === '持久化'));
});

/* ---------------- 每周固定任务 ---------------- */
test('固定任务只在选定的星期、且在起止日期内出现', () => {
  addFixed({ title: '晨跑', days: [1, 3], time: '07:00', from: MON, until: '2026-11-30' });
  assert.deepEqual(titles(tasksOn(MON)), ['晨跑']);
  assert.deepEqual(titles(tasksOn(TUE)), []);              // 周二不在 days 里
  assert.deepEqual(titles(tasksOn('2026-11-09')), []);     // 开始日期之前
  assert.deepEqual(titles(tasksOn('2026-12-07')), []);     // 结束日期之后
});

test('临时任务和固定任务合并，按时间排序；没填时间的排在最后', () => {
  addFixed({ title: '晨跑', days: [1], time: '07:00', from: MON });
  store.put('dtask', { date: MON, title: '开会', time: '10:00' });
  store.put('dtask', { date: MON, title: '随时都行', time: '' });
  store.put('dtask', { date: MON, title: '早读', time: '06:30' });
  assert.deepEqual(titles(tasksOn(MON)), ['早读', '晨跑', '开会', '随时都行']);
});

test('暂停期间和休息日不显示固定任务，临时任务不受影响', () => {
  const tpl = addFixed({ title: '健身', days: [1, 2], time: '19:00', from: MON });
  store.put('fixed', { pauseFrom: TUE, pauseTo: TUE }, tpl);
  assert.deepEqual(titles(tasksOn(TUE)), []);              // 暂停
  assert.deepEqual(titles(tasksOn(NEXT_MON)), ['健身']);   // 暂停结束后恢复

  store.put('dtask', { date: MON, title: '取快递' });
  setRestDay(MON, true);
  assert.deepEqual(titles(tasksOn(MON)), ['取快递']);       // 休息日：只剩临时任务
  setRestDay(MON, false);
  assert.equal(tasksOn(MON).length, 2);
});

test('只改某一天：其他日子不受影响；模板以后改了，这一天没改过的字段跟着变', () => {
  const tpl = addFixed({ title: '背单词', days: [1], time: '08:00', from: MON });
  setFixedDay(fixedInstId(tpl, MON), { title: '背单词', time: '09:00', endTime: '' });
  assert.equal(fixedOn(MON)[0].time, '09:00');
  assert.equal(fixedOn(NEXT_MON)[0].time, '08:00');

  store.put('fixed', { title: '背单词 50 个' }, tpl);      // 改模板标题
  assert.equal(fixedOn(MON)[0].title, '背单词 50 个');      // 标题没被单独改过 → 跟着变
  assert.equal(fixedOn(MON)[0].time, '09:00');              // 时间单独改过 → 保留
});

test('编辑一天时删掉固定任务 = 只跳过这一天；删掉的临时任务被真正删除', () => {
  const tpl = addFixed({ title: '晨跑', days: [1], time: '07:00', from: MON });
  const keep = store.put('dtask', { date: MON, title: '留着', time: '10:00' });
  store.put('dtask', { date: MON, title: '删掉', time: '11:00' });

  saveDay(MON, [{ id: keep, title: '留着', time: '10:00', endTime: '' }]);
  assert.deepEqual(titles(tasksOn(MON)), ['留着']);
  assert.ok(fixedOn(MON).find((f) => f.fixedId === tpl).skipped);
  assert.deepEqual(titles(tasksOn(NEXT_MON)), ['晨跑']);  // 下周照常
});

test('修改每周安排只影响以后：模板自动拆成两段，历史记录保持原样', () => {
  const tpl = addFixed({ title: '练口语', days: [1], time: '20:00', from: '2026-11-02' });
  toggleTask(fixedInstId(tpl, '2026-11-09'));               // 上周已完成

  updateFixed(tpl, { title: '练口语（新题库）' }, MON);
  assert.equal(store.all('fixed').length, 2);
  assert.equal(tasksOn('2026-11-09')[0].title, '练口语');    // 以前：旧标题
  assert.equal(tasksOn('2026-11-09')[0].done, true);         // 完成记录还在
  assert.equal(tasksOn(MON)[0].title, '练口语（新题库）');   // 以后：新标题
  assert.equal(tasksOn(MON).length, 1);                      // 不会两段重叠出现两次
});

test('结束固定任务：从那天起不再出现，之前的保留', () => {
  const tpl = addFixed({ title: '打卡', days: [1], from: '2026-11-02' });
  endFixed(tpl, MON);
  assert.deepEqual(titles(tasksOn('2026-11-09')), ['打卡']);
  assert.deepEqual(titles(tasksOn(MON)), []);
});

test('勾选固定任务只记录这一天的完成状态', () => {
  const tpl = addFixed({ title: '吃药', days: [1], from: MON });
  toggleTask(fixedInstId(tpl, MON));
  assert.equal(tasksOn(MON)[0].done, true);
  assert.equal(tasksOn(NEXT_MON)[0].done, false);
  toggleTask(fixedInstId(tpl, MON));
  assert.equal(tasksOn(MON)[0].done, false);
});

/* ---------------- 截止任务提醒 ---------------- */
test('截止任务在截止前 7/5/2 天和当天提醒，已完成的不提醒', () => {
  const t = today();
  for (const n of [0, 1, 2, 5, 6, 7, 8]) store.put('deadline', { title: `D${n}`, date: addDays(t, n), done: false });
  store.put('deadline', { title: '已完成', date: addDays(t, 2), done: true });
  assert.deepEqual(deadlinesToRemind().map((d) => d.title).sort(), ['D0', 'D2', 'D5', 'D7']);
});

/* ---------------- 复盘 ---------------- */
test('复盘：全部清空时删除记录；只有照片时也会保存', () => {
  saveReview(MON, { feel: '今天很开心' });
  assert.equal(getReview(MON).feel, '今天很开心');
  saveReview(MON, { feel: '' });
  assert.equal(getReview(MON), null);

  saveReview(MON, { photos: [{ id: 'p1', ext: 'webp' }] });
  assert.ok(getReview(MON));
  assert.ok(reviewPhotoDates().has(MON));
});

/* ---------------- 日历 ---------------- */
test('日历：未来的日子只有安排了临时任务才显示', () => {
  const t = today();
  addFixed({ title: '每天都有', days: [0, 1, 2, 3, 4, 5, 6], from: addDays(t, -3) });
  store.put('dtask', { date: addDays(t, 3), title: '三天后的事' });
  const m = calendarData(addDays(t, -2), addDays(t, 5));
  assert.ok(m.has(addDays(t, -1)));             // 过去：固定任务也算
  assert.ok(m.has(t));
  assert.ok(!m.has(addDays(t, 1)));             // 未来：只有固定任务 → 不显示
  assert.deepEqual(titles(m.get(addDays(t, 3))), ['每天都有', '三天后的事']);  // 都没填时间时固定任务在前
});
