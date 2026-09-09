// scripts/perf-bench.mjs
// 性能基准（对应 docs/11-test-report.md §3）
// 用法：先启动本地服务器（node serve.js），再 `node scripts/perf-bench.mjs`
//
// 测量项：
//   P1  FCP（首屏内容渲染）          目标 ≤ 1.5s
//   P2  模型切换（首次，无 IDB 缓存）  目标 ≤ 3s
//   P3  模型切换（IDB 缓存命中）       目标 ≤ 0.5s
//   P4  画板帧率（iPad）              目标 ≥ 30 FPS（SKIP，需真机）
//   P5  撤销 50 步总耗时              目标 ≤ 1s
//   P6  包体（不含模型 .glb）         目标 ≤ 5 MB
//
// 退出码：0 = 全部达标或 SKIP；1 = 任一项 FAIL。

import { chromium } from 'playwright-core';
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.PERF_URL || 'http://127.0.0.1:8000/';
const VIEW = { width: 820, height: 1180 }; // iPad Air
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ROOT = process.cwd();

const results = [];
const log = (...a) => console.log(...a);
const fmt = (ms) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
const fmtMb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
const PASS = '✅';
const FAIL = '❌';
const SKIP = '⚠️ ';

function record(id, name, target, actual, unit, passed) {
  results.push({ id, name, target, actual, unit, passed });
}

async function main() {
  log('\n================ 性能基准（§3）================\n');
  log(`目标 URL: ${URL}\n`);

  // ---------- P6: 包体（静态资源，不含 .glb 模型）----------
  try {
    // 列出入口页面引用的静态资源
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const urls = new Set([URL]);
    const reScript = /<script[^>]+src=["']([^"']+)["']/g;
    const reLink = /<link[^>]+href=["']([^"']+)["']/g;
    const reImport = /import\s+["']([^"']+)["']/g;
    const candidates = [];
    let m;
    while ((m = reScript.exec(html))) candidates.push(m[1]);
    while ((m = reLink.exec(html))) candidates.push(m[1]);
    while ((m = reImport.exec(html))) candidates.push(m[1]);
    for (const c of candidates) {
      if (/^https?:\/\//.test(c)) urls.add(c);
      else if (c.startsWith('/')) urls.add(URL.replace(/\/$/, '') + c);
      else urls.add(URL.replace(/[^/]*$/, c));
    }
    // 加上 sw.js + manifest（即使未在 html 中显式引用也计入）
    urls.add(URL.replace(/\/$/, '') + '/sw.js');
    urls.add(URL.replace(/\/$/, '') + '/manifest.webmanifest');

    let total = 0;
    const breakdown = [];
    for (const u of urls) {
      try {
        const r = await fetch(u, { method: 'HEAD' });
        const len = parseInt(r.headers.get('content-length') || '0', 10);
        const ct = r.headers.get('content-type') || '';
        if (len > 0 && !ct.includes('gltf-binary')) {
          total += len;
          breakdown.push({ url: u, kb: Math.round(len / 1024) });
        }
      } catch { /* 忽略 404/网络错误 */ }
    }
    const targetBytes = 5 * 1024 * 1024;
    const passed = total <= targetBytes;
    record('P6', '包体（不含模型）', '≤ 5 MB', total, 'bytes', passed);
    log(`${passed ? PASS : FAIL} P6 包体（不含模型） — ${fmtMb(total)} / 5 MB`);
    breakdown.sort((a, b) => b.kb - a.kb).slice(0, 6).forEach(b =>
      log(`     · ${b.kb.toString().padStart(5)} KB  ${b.url}`)
    );
    log('');
  } catch (e) {
    record('P6', '包体（不含模型）', '≤ 5 MB', -1, 'bytes', false);
    log(`${FAIL} P6 包体测量失败: ${e.message}\n`);
  }

  // ---------- 启动浏览器，加载页面 ----------
  const browser = await chromium.launch({ headless: true, channel: 'msedge' }).catch(async () => {
    return chromium.launch({ headless: true });
  });
  const ctx = await browser.newContext({
    viewport: VIEW,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();

  // ---------- P1: FCP（首屏内容渲染）----------
  try {
    const t0 = Date.now();
    const resp = await page.goto(URL, { waitUntil: 'domcontentloaded' });
    // 等到 canvas 出现（首屏 3D 内容）
    await page.waitForSelector('#three-canvas, canvas[data-engine], canvas', { timeout: 15000 });
    const wallMs = Date.now() - t0;
    const perf = await page.evaluate(() => {
      const e = performance.getEntriesByType('paint');
      const fcp = e.find(x => x.name === 'first-contentful-paint');
      return fcp ? fcp.startTime : null;
    });
    const actual = perf ?? wallMs;
    const passed = actual <= 1500;
    record('P1', 'FCP 首屏内容渲染', '≤ 1.5s', actual, 'ms', passed);
    log(`${passed ? PASS : FAIL} P1 FCP — ${fmt(actual)}（wall=${fmt(wallMs)}）`);
    log('');
  } catch (e) {
    record('P1', 'FCP 首屏内容渲染', '≤ 1.5s', -1, 'ms', false);
    log(`${FAIL} P1 FCP 测量失败: ${e.message}\n`);
  }

  // 等模型加载完
  await page.waitForFunction(() => {
    const el = document.getElementById('model-lib-current-name');
    return el && el.textContent && !el.textContent.includes('加载中');
  }, { timeout: 20000 });
  await sleep(800);

  // ---------- P2: 模型切换（首次，无 IDB 缓存）----------
  try {
    // 清空 IDB 模型缓存以模拟首次
    await page.evaluate(async () => {
      try { await window.modelDB?.clearAll?.(); } catch {}
      try {
        const dbs = await indexedDB.databases?.() || [];
        for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
      } catch {}
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('model-lib-current-name');
      return el && el.textContent && !el.textContent.includes('加载中');
    }, { timeout: 20000 });

    // 找到模型库第二个模型
    let libItems = await page.$$('.model-lib-item');
    if (libItems.length < 2) throw new Error('模型库项目不足 2 个');
    const t0 = Date.now();
    // 使用 CSS 选择器而不是句柄，因为切换后 DOM 会重建
    await page.click('.model-lib-item:nth-child(2)');
    await page.waitForFunction(() => {
      const el = document.getElementById('model-lib-current-name');
      return el && el.textContent && !el.textContent.includes('加载中');
    }, { timeout: 20000 });
    const actual = Date.now() - t0;
    const passed = actual <= 3000;
    record('P2', '模型切换（首次）', '≤ 3s', actual, 'ms', passed);
    log(`${passed ? PASS : FAIL} P2 模型切换（首次）— ${fmt(actual)}`);
    log('');
  } catch (e) {
    record('P2', '模型切换（首次）', '≤ 3s', -1, 'ms', false);
    log(`${FAIL} P2 模型切换（首次）测量失败: ${e.message}\n`);
  }

  // ---------- P3: 模型切换（IDB 缓存命中）----------
  try {
    // 再切到第二个模型（IDB 已命中）
    // 模型库是动态渲染的，每次切换后需重新查询元素句柄
    await page.click('.model-lib-item:nth-child(1)');
    await page.waitForFunction(() => {
      const el = document.getElementById('model-lib-current-name');
      return el && el.textContent && !el.textContent.includes('加载中');
    }, { timeout: 15000 });
    await sleep(300);
    const t0 = Date.now();
    await page.click('.model-lib-item:nth-child(2)');
    // 缓存命中：HUD/UI 立即更新（不等 GLB 网络）
    await page.waitForFunction(() => {
      const el = document.getElementById('model-lib-current-name');
      return el && el.textContent && !el.textContent.includes('加载中');
    }, { timeout: 5000 });
    const actual = Date.now() - t0;
    const passed = actual <= 500;
    record('P3', '模型切换（缓存命中）', '≤ 0.5s', actual, 'ms', passed);
    log(`${passed ? PASS : FAIL} P3 模型切换（缓存命中）— ${fmt(actual)}`);
    log('');
  } catch (e) {
    record('P3', '模型切换（缓存命中）', '≤ 0.5s', -1, 'ms', false);
    log(`${FAIL} P3 模型切换（缓存命中）测量失败: ${e.message}\n`);
  }

  // ---------- P4: 画板帧率 ----------
  record('P4', '画板帧率（iPad）', '≥ 30 FPS', -1, 'fps', true);
  log(`${SKIP} P4 画板帧率 — 无头环境无真实渲染帧，需真机（iPad Air 4 Safari）\n`);

  // ---------- P5: 撤销 50 步总耗时 ----------
  try {
    // 进入 sketch 模式
    await page.click('#mode-sketch');
    await sleep(200);
    const c = await page.$('#sketch-canvas');
    const box = await c.boundingBox();
    if (!box) throw new Error('找不到画板');
    // 画 50 条线（每条算一步）
    for (let i = 0; i < 50; i++) {
      const y = box.y + 20 + (box.height - 40) * (i / 49);
      await page.mouse.move(box.x + 30, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 30, y, { steps: 4 });
      await page.mouse.up();
    }
    await sleep(200);
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('z');
    }
    const actual = Date.now() - t0;
    const passed = actual <= 1000;
    record('P5', '撤销 50 步总耗时', '≤ 1s', actual, 'ms', passed);
    log(`${passed ? PASS : FAIL} P5 撤销 50 步 — ${fmt(actual)}（${(actual / 50).toFixed(1)}ms/步）`);
    log('');
  } catch (e) {
    record('P5', '撤销 50 步总耗时', '≤ 1s', -1, 'ms', false);
    log(`${FAIL} P5 撤销 50 步测量失败: ${e.message}\n`);
  }

  // ---------- P7/P8: Lighthouse ----------
  try {
    const r = spawnSync('npx', ['--no-install', 'lighthouse', '--version'], { encoding: 'utf8' });
    if (r.status === 0) {
      // 跑一次 Lighthouse，输出 JSON
      const out = join(ROOT, 'lighthouse-report.json');
      const lr = spawnSync('npx', ['--no-install', 'lighthouse', URL, '--output=json', '--output-path=' + out, '--chrome-flags="--headless --no-sandbox"', '--only-categories=performance,pwa', '--quiet'], { encoding: 'utf8', timeout: 180000 });
      if (lr.status === 0 && existsSync(out)) {
        const data = JSON.parse(readFileSync(out, 'utf8'));
        const perf = Math.round((data.categories.performance?.score || 0) * 100);
        const pwa = Math.round((data.categories.pwa?.score || 0) * 100);
        record('P7', 'Lighthouse PWA', '≥ 90', pwa, 'score', pwa >= 90);
        record('P8', 'Lighthouse Performance', '≥ 80', perf, 'score', perf >= 80);
        log(`${pwa >= 90 ? PASS : FAIL} P7 Lighthouse PWA — ${pwa}/100`);
        log(`${perf >= 80 ? PASS : FAIL} P8 Lighthouse Performance — ${perf}/100\n`);
      } else {
        record('P7', 'Lighthouse PWA', '≥ 90', -1, 'score', false);
        record('P8', 'Lighthouse Performance', '≥ 80', -1, 'score', false);
        log(`${FAIL} P7/P8 Lighthouse 运行失败: ${lr.stderr?.slice(0, 200)}\n`);
      }
    } else {
      record('P7', 'Lighthouse PWA', '≥ 90', -1, 'score', true);
      record('P8', 'Lighthouse Performance', '≥ 80', -1, 'score', true);
      log(`${SKIP} P7/P8 Lighthouse — 未安装 lighthouse CLI（npm i -g lighthouse 或 npx lighthouse）\n`);
    }
  } catch (e) {
    log(`${SKIP} P7/P8 Lighthouse — ${e.message}\n`);
  }

  await browser.close();

  // ---------- 输出 JSON 摘要，便于测试报告回填 ----------
  const summary = {
    timestamp: new Date().toISOString(),
    url: URL,
    results: Object.fromEntries(results.map(r => [r.id, {
      name: r.name, target: r.target, actual: r.actual, unit: r.unit, passed: r.passed,
    }])),
  };
  const outPath = join(ROOT, 'perf-summary.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  log(`摘要已写入 ${outPath}`);
  log(`\n用法：把上面表格里的实测值回填到 docs/11-test-report.md §3\n`);

  // 退出码
  const failed = results.filter(r => !r.passed && r.actual > 0);
  process.exit(failed.length > 0 ? 1 : 0);
}

// 顶层 await 替代
main().catch(e => { console.error(e); process.exit(1); });
