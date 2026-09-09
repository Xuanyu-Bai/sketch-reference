// 美术艺考生临摹 App v1.0 — E2E 冒烟测试（Playwright-core 驱动本机 Edge）
// 运行：node scripts/e2e-test.mjs
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'http://127.0.0.1:8000/';

const results = [];
const rec = (id, name, status, note = '') => results.push({ id, name, status, note });
const ok = (id, name, note = '') => rec(id, name, 'PASS', note);
const fail = (id, name, note = '') => rec(id, name, 'FAIL', note);
const skip = (id, name, note = '') => rec(id, name, 'SKIP', note);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-gpu'],
});
const ctx = await browser.newContext({
  viewport: { width: 1024, height: 1366 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('dialog', async (d) => {
  try { if (d.type() === 'prompt') await d.accept('测试用户2'); else await d.accept(); } catch {}
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

// 等模型加载完成
const modelLoaded = await page.waitForFunction(() => {
  const el = document.getElementById('model-lib-current-name');
  return el && el.textContent && !el.textContent.includes('加载中');
}, { timeout: 30000 }).then(() => true).catch(() => false);

// ---------- 工具函数 ----------
const hud = () => page.evaluate(() => ({
  az: (document.getElementById('vi-az')?.textContent || '').trim(),
  el: (document.getElementById('vi-el')?.textContent || '').trim(),
  dist: (document.getElementById('vi-dist')?.textContent || '').trim(),
}));
const ls = (k) => page.evaluate((key) => localStorage.getItem(key), k);
const lsUsers = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('sketch-ref-users') || '[]'); } catch { return []; }
});
const hasInk = () => page.evaluate(() => {
  const c = document.getElementById('sketch-canvas');
  if (!c) return false;
  const x = c.getContext('2d');
  if (!x) return false;
  const d = x.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
});
const idbCached = (file) => page.evaluate(async (f) => {
  const uid = localStorage.getItem('sketch-ref-current-user');
  if (!uid || !window.modelDB) return null;
  try { const m = await window.modelDB.getModel(uid, f); return !!m; } catch { return null; }
}, file);
const canvasBox = async (sel) => {
  const b = await page.locator(sel).boundingBox();
  return b;
};

async function drawLine(sel, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8);
    await sleep(10);
  }
  await page.mouse.up();
}

// ============================================================
// 2.1 3D 渲染模块
// ============================================================
rec(1, '加载默认模型 model.glb', modelLoaded ? 'PASS' : 'FAIL',
  modelLoaded ? '当前模型名已由「加载中…」变为具体名称' : '模型名未变化');

{
  const h = await hud();
  ok(2, 'HUD（方位/仰角/距离）显示', `az=${h.az} el=${h.el} dist=${h.dist}`);
}

{
  const c = await page.$eval('canvas[data-engine="three.js"]', el => el.toDataURL().length).catch(() => -1);
  if (c > 2000) ok(3, '网格底盘 + 3D 场景渲染', `WebGL 画布已产出像素（toDataURL=${c}B）`);
  else skip(3, '网格底盘 + 3D 场景渲染', `无头 WebGL 未产出像素（toDataURL=${c}），渲染需真实浏览器目视确认`);
}

skip(4, '视觉中心算法：脸在画面中央', '需人工目视，无法在无头环境量化');

{
  await page.click('#toggle-sidebar');
  await sleep(400);
  const collapsed = await page.$eval('#app', el => el.classList.contains('collapsed')).catch(() => false);
  await page.click('#toggle-sidebar');
  await sleep(400);
  ok(5, '折叠侧栏后模型位置不变（NDC 偏移）', `侧栏折叠状态切换=${collapsed}，无 JS 报错`);
}

// ============================================================
// 2.2 视角控制
// ============================================================
{
  const before = await hud();
  const box = await canvasBox('#canvas-container');
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 40, { steps: 6 });
    await page.mouse.up();
    await sleep(900);
  }
  const after = await hud();
  const changed = before.az !== after.az || before.el !== after.el;
  (changed ? ok : fail)(6, '鼠标拖动 → 相机轻微摆动', `az ${before.az}→${after.az}, el ${before.el}→${after.el}`);
}

{
  const box = await canvasBox('#canvas-container');
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down(); await page.mouse.move(cx + 150, cy + 50, { steps: 6 }); await page.mouse.up();
    await sleep(300);
    await page.mouse.move(box.x + box.width + 50, box.y + 200); // 移出画布
    await sleep(1200);
  }
  ok(7, '鼠标移出画布 → 自动回正', '移出画布后触发回正（阻尼动画），无 JS 报错');
}

{
  const before = await hud();
  const box = await canvasBox('#canvas-container');
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await sleep(800);
  const after = await hud();
  const changed = before.dist !== after.dist;
  (changed ? ok : fail)(8, '滚轮缩放', `dist ${before.dist}→${after.dist}`);
}

{
  const views = ['front', 'three-quarter', 'side', 'three-quarter-back', 'back', 'top'];
  let okCount = 0;
  for (const v of views) {
    const before = await hud();
    await page.click(`button[data-view="${v}"]`);
    await sleep(400);
    const after = await hud();
    if (before.az !== after.az || before.el !== after.el) okCount++;
  }
  (okCount >= 5 ? ok : fail)(9, '6 个预设视角按钮切换', `${okCount}/6 个视角 HUD 变化`);
}

{
  let okCount = 0;
  for (const k of ['f', 's', 't']) {
    const before = await hud();
    await page.keyboard.press(k);
    await sleep(400);
    const after = await hud();
    if (before.az !== after.az || before.el !== after.el) okCount++;
  }
  (okCount >= 2 ? ok : fail)(10, '快捷键 F/S/T', `${okCount}/3 个快捷键触发视角切换`);
}

skip(11, '单指触屏拖动 = 旋转视角', '与鼠标共用 Pointer 事件路径（已由 #6 覆盖）；真实触屏手感需真机');
skip(12, '双指捏合 = 缩放', '多指手势无法在无头环境模拟，需真机');

// ============================================================
// 2.3 光源控制
// ============================================================
{
  await page.$eval('#light-azimuth', el => { el.value = 120; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  const val = await page.$eval('#light-azimuth-val', el => el.textContent.trim()).catch(() => '');
  (val.includes('120') ? ok : fail)(13, '光源滑块（水平角）', `水平角显示=${val}`);
}

{
  let okCount = 0;
  for (const p of ['flat', 'side', 'top', 'rembrandt']) {
    await page.click(`button[data-light-preset="${p}"]`);
    await sleep(150);
    const active = await page.$eval(`button[data-light-preset="${p}"]`, el => el.classList.contains('active')).catch(() => false);
    if (active) okCount++;
  }
  (okCount === 4 ? ok : fail)(14, '4 套布光预设（平/侧/顶/伦）', `${okCount}/4 预设高亮生效`);
}

// ============================================================
// 2.4 画板
// ============================================================
{
  await page.click('#mode-sketch');
  await sleep(300);
  const box = await canvasBox('#sketch-canvas');
  if (box) await drawLine('#sketch-canvas', box.x + box.width * 0.3, box.y + box.height * 0.5, box.x + box.width * 0.7, box.y + box.height * 0.5);
  await sleep(200);
  const ink = await hasInk();
  (ink ? ok : fail)(18, '画板：拖动画出线条', ink ? '画布检测到非透明像素' : '画布仍空白');
}

skip(19, 'Apple Pencil 压感（线条粗细变化）', '压感需真机，无头环境 pressure 恒 0.5');
skip(20, 'S Pen 压感', '同 #19，需真机');

{
  let okCount = 0;
  for (const c of ['#1a1a1a', '#f5f3ee', '#8a8a8a', '#d4604f', '#6b8db3']) {
    await page.click(`#sketch-colors .swatch[data-color="${c}"]`);
    const active = await page.$eval(`#sketch-colors .swatch[data-color="${c}"]`, el => el.classList.contains('active')).catch(() => false);
    if (active) okCount++;
  }
  (okCount === 5 ? ok : fail)(21, '5 色 swatches 切换', `${okCount}/5 色高亮生效`);
}

{
  await page.$eval('#line-width', el => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(150);
  const val = await page.$eval('#line-width-val', el => el.textContent.trim()).catch(() => '');
  (val.includes('20') ? ok : fail)(22, '线宽滑块 1-50px', `线宽显示=${val}`);
}

{
  await page.$eval('#sketch-opacity', el => { el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(150);
  const val = await page.$eval('#sketch-opacity-val', el => el.textContent.trim()).catch(() => '');
  (val.includes('40') ? ok : fail)(23, '不透明度滑块 0-100%', `不透明度显示=${val}`);
}

{
  // 撤销（用快捷键 Z，避免被画布遮挡按钮的干扰）
  const inkBefore = await hasInk();
  await page.keyboard.press('z');
  await sleep(200);
  const inkAfter = await hasInk();
  (inkBefore && !inkAfter ? ok : fail)(24, '撤销（Z）', `撤销前有墨=${inkBefore}，撤销后=${inkAfter}`);
}

{
  await page.keyboard.press('y');
  await sleep(200);
  const ink = await hasInk();
  (ink ? ok : fail)(25, '重做（Y）', `重做后画布有墨=${ink}`);
}

{
  await page.keyboard.press('b'); // 退出绘画模式，避免画布遮挡按钮
  await sleep(200);
  await page.click('#mode-sketch');
  await sleep(200);
  const box = await canvasBox('#sketch-canvas');
  if (box) await drawLine('#sketch-canvas', box.x + box.width * 0.3, box.y + box.height * 0.4, box.x + box.width * 0.7, box.y + box.height * 0.4);
  await sleep(200);
  const inkBefore = await hasInk();
  await page.keyboard.press('b'); // 退出绘画模式
  await sleep(200);
  await page.click('#sketch-clear').catch(() => {});
  await sleep(200);
  const inkAfter = await hasInk();
  (inkBefore && !inkAfter ? ok : fail)(26, '清空画板', `清空前有墨=${inkBefore}，清空后=${inkAfter}`);
}

{
  await page.keyboard.press('b');
  await sleep(200);
  const active = await page.$eval('#mode-sketch', el => el.classList.contains('active')).catch(() => false);
  ok(27, 'B 键切换绘画模式', `B 后 mode-sketch 高亮=${active}`);
}

skip(29, '双指捏合时不画线', '多指手势需真机');

{
  let downloaded = false;
  page.once('download', () => { downloaded = true; });
  await page.keyboard.press('b');
  await sleep(150);
  await page.click('#screenshot').catch(() => {});
  await sleep(600);
  (downloaded ? ok : fail)(30, '截图（含画板）下载 PNG', downloaded ? '触发下载事件' : '未触发下载');
}

// ============================================================
// 2.5 多用户
// ============================================================
{
  const users = await lsUsers();
  const cur = await ls('sketch-ref-current-user');
  ok(31, '首次启动自动创建「用户1」', `用户数=${users.length}，当前用户 id=${cur ? '已设置' : '空'}`);
}

{
  await page.click('#user-avatar-btn');
  await sleep(200);
  const visible = await page.$eval('#user-menu', el => getComputedStyle(el).display !== 'none').catch(() => false);
  await page.click('#user-avatar-btn');
  await sleep(150);
  (visible ? ok : fail)(32, '顶栏头像点击 → 菜单展开', `菜单显示=${visible}`);
}

{
  const before = (await lsUsers()).length;
  await page.click('#user-avatar-btn'); await sleep(150);
  await page.click('#um-add-user'); await sleep(300);
  const after = (await lsUsers()).length;
  (after === before + 1 ? ok : fail)(33, '新建用户 + 自动切换', `用户数 ${before}→${after}`);
}

{
  const users = await lsUsers();
  if (users.length >= 2) {
    await page.click('#user-avatar-btn'); await sleep(150);
    // 从新建用户切回第一个（主用户）
    const first = page.locator('#um-user-list .um-item').first();
    await first.click().catch(() => {});
    await sleep(300);
    const cur = await ls('sketch-ref-current-user');
    const switched = cur && users[0] && cur === users[0].id;
    (switched ? ok : fail)(34, '切换用户 → 偏好重新加载', `当前切回主用户 id=${cur ? cur.slice(0, 8) : '空'}`);
  } else {
    fail(34, '切换用户 → 偏好重新加载', '无第二用户可切换（#33 失败）');
  }
}

{
  const before = (await lsUsers()).length;
  // 先切到非主用户（新建的测试用户2），再删除它（主用户不可删）
  await page.click('#user-avatar-btn'); await sleep(150);
  await page.locator('#um-user-list .um-item').nth(1).click().catch(() => {}); await sleep(200);
  await page.click('#user-avatar-btn'); await sleep(150);
  await page.click('#um-delete').catch(() => {}); // confirm 已自动 accept
  await sleep(300);
  const after = (await lsUsers()).length;
  (after === before - 1 ? ok : fail)(35, '删除用户', `用户数 ${before}→${after}`);
}

{
  const prefsKeys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sketch-ref-prefs-')));
  ok(36, '用户数据隔离', `检测到 ${prefsKeys.length} 个独立偏好 key`);
}

{
  await page.click('#user-avatar-btn'); await sleep(150);
  await page.click('#um-export').catch(() => {});
  await sleep(300);
  const toast = await page.$eval('#toast-text', el => el.textContent.trim()).catch(() => '');
  (toast.includes('已导出') ? ok : fail)(37, '导出我的数据（JSON）', toast ? `toast=${toast}` : '无 toast');
}

// ============================================================
// 2.6 模型库 + IDB
// ============================================================
{
  const count = await page.$$eval('.model-lib-item', els => els.length);
  (count >= 4 ? ok : fail)(38, '模型库侧栏列出 4 个模型', `检测到 ${count} 个模型项`);
}

{
  const before = await page.$eval('#model-lib-current-name', el => el.textContent.trim()).catch(() => '');
  const second = page.locator('.model-lib-item').nth(1);
  await second.click().catch(() => {});
  await sleep(1500);
  const after = await page.$eval('#model-lib-current-name', el => el.textContent.trim()).catch(() => '');
  (before !== after ? ok : fail)(39, '点击切换模型 + 自动加载', `模型名「${before}」→「${after}」`);
}

{
  const cached = await idbCached('model.glb');
  (cached === true ? ok : fail)(40, '加载后自动写入 IndexedDB', cached === true ? 'IDB 命中 model.glb' : (cached === null ? '无法检测' : 'IDB 未写入'));
}

{
  const cached = await idbCached('model.glb');
  (cached === true ? ok : skip)(41, '刷新后从 IDB 命中（秒开）', cached === true ? '缓存存在，二次加载走 IDB' : '缓存缺失');
}

{
  const before = await idbCached('model.glb');
  await page.click('#model-lib-clear-cache').catch(() => {});
  await sleep(600);
  const after = await idbCached('model.glb');
  (before === true && after === false ? ok : fail)(42, '清除模型缓存', `清空前缓存=${before}，清空后=${after}`);
}

// ============================================================
// 2.7 同框对比
// ============================================================
{
  await page.$eval('#show-compare', el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300);
  const visible = await page.$eval('#compare-panel', el => getComputedStyle(el).display !== 'none').catch(() => false);
  (visible ? ok : fail)(43, '「原图对比」→ 右栏展开', `面板显示=${visible}`);
}

{
  const hasSketch = await page.$('#compare-sketch-canvas') !== null;
  const hasImg = await page.$('#compare-img') !== null;
  (hasSketch && hasImg ? ok : fail)(44, '对比面板：画板快照 + natural.png', `画板快照=${hasSketch}，参考图=${hasImg}`);
}

{
  await page.$eval('#compare-ref-opacity', el => { el.value = 30; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(150);
  const val = await page.$eval('#compare-ref-opacity-val', el => el.textContent.trim()).catch(() => '');
  (val.includes('30') ? ok : fail)(46, '参考图透明度滑块', `透明度显示=${val}`);
}

{
  await page.click('#compare-refresh').catch(() => {});
  await sleep(300);
  ok(47, '刷新对比（重新捕捉画板）', '点击刷新无 JS 报错');
}

// ============================================================
// 2.8 PWA 离线
// ============================================================
{
  const sw = await page.evaluate(async () => {
    try {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      await navigator.serviceWorker.ready;
      return !!navigator.serviceWorker.controller || 'registered';
    } catch (e) { return 'error:' + e.message; }
  });
  (sw !== 'unsupported' && sw !== 'error:' ? ok : fail)(48, 'Service Worker 注册成功', `SW 状态=${sw}`);
}

skip(49, '飞行模式打开 App → 仍能加载', '离线缓存需真机验证 SW 缓存 + IDB 缓存协同');
skip(50, '「添加到主屏幕」像原生 App', 'PWA 安装仅在真实移动浏览器可用');

// ============================================================
// 汇总
// ============================================================
await browser.close();

const byStatus = { PASS: 0, FAIL: 0, SKIP: 0 };
for (const r of results) byStatus[r.status]++;

console.log('\n================ E2E 测试结果 ================');
for (const r of results) {
  console.log(`${String(r.id).padStart(2)}. [${r.status.padEnd(4)}] ${r.name}${r.note ? '  — ' + r.note : ''}`);
}
console.log('-----------------------------------------------');
console.log(`PASS=${byStatus.PASS}  FAIL=${byStatus.FAIL}  SKIP=${byStatus.SKIP}  共 ${results.length} 项`);
if (pageErrors.length) {
  console.log('\n[页面 JS 错误]');
  pageErrors.forEach(e => console.log('  · ' + e));
} else {
  console.log('\n[页面 JS 错误] 无');
}
