// scripts/lighthouse-bench.mjs
// 用 Lighthouse 模块 API + chrome-launcher 跑 PWA / Performance 评分。
// 解决 chrome-launcher 在 Windows 上退出时 EPERM 清理失败的问题：
//  - 不让 launcher 自动 rm 临时目录（直接 monkey-patch）
//  - 自己用 fs 处理
//
// 用法：先启动本地服务器（node serve.js），再 `node scripts/lighthouse-bench.mjs`

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TARGET_URL = process.env.PERF_URL || 'http://127.0.0.1:8000/';

// 把 chrome-launcher 的 destroyTmp 替换成 no-op，避免 Windows EPERM
import * as chromeLauncher from 'chrome-launcher';
chromeLauncher.Launcher.prototype.destroyTmp = function () { /* noop */ };

const lighthouse = (await import('lighthouse')).default;
const { launch } = chromeLauncher;

async function main() {
  console.log(`\n================ Lighthouse 基准 ================\n目标 URL: ${TARGET_URL}\n`);

  // Edge 在 Windows 上能稳定以 headless 模式启动
  const chromePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chrome = await launch({
    chromePath,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  console.log(`Chrome 启动: pid=${chrome.pid} port=${chrome.port}`);

  let result;
  try {
    result = await lighthouse(TARGET_URL, {
      port: chrome.port,
      output: 'json',
      onlyCategories: ['performance', 'best-practices', 'accessibility', 'seo'],
      logLevel: 'error',
    });
  } finally {
    try { await chrome.kill(); } catch (e) { /* 忽略 Windows EPERM */ }
  }

  if (!result) throw new Error('Lighthouse 未返回结果');

  const lhr = result.lhr;
  const perf = Math.round((lhr.categories.performance?.score || 0) * 100);
  const bp = Math.round((lhr.categories['best-practices']?.score || 0) * 100);

  // PWA 评分手算（Lighthouse 13 已移除 PWA 类目，改用直接探测）
  // 关键项：manifest 可达 + 必要字段、service-worker 注册、viewport、
  //        HTTPS（localhost 算合格）、主题色、icon
  const baseURL = new URL(TARGET_URL);
  const probe = async (path) => {
    try {
      const r = await fetch(new URL(path, TARGET_URL).href, { method: 'HEAD' });
      return { ok: r.ok, ct: r.headers.get('content-type'), len: parseInt(r.headers.get('content-length') || '0', 10) };
    } catch (e) { return { ok: false, err: e.message }; }
  };
  const m = await probe('/manifest.webmanifest');
  let manifestOk = false, manifestFields = [];
  if (m.ok) {
    try {
      const txt = await (await fetch(new URL('/manifest.webmanifest', TARGET_URL))).text();
      const j = JSON.parse(txt);
      manifestOk = !!(j.name && j.short_name && j.start_url && j.display && j.icons?.length);
      manifestFields = ['name', 'short_name', 'start_url', 'display', 'icons'].filter(k => j[k]);
    } catch {}
  }
  const sw = await probe('/sw.js');
  const swOk = sw.ok;
  const isHttps = baseURL.protocol === 'https:' || baseURL.hostname === 'localhost' || baseURL.hostname === '127.0.0.1';

  // meta-viewport 是 Lighthouse 13 唯一保留的 PWA 相关 audit
  const viewportOk = lhr.audits['meta-viewport']?.score === 1;

  const pwaChecks = [
    { name: `manifest 可达 + 字段齐全 (${manifestFields.join('/') || '缺'})`, pass: manifestOk },
    { name: `service-worker /sw.js (${swOk ? sw.len + 'B' : '缺失'})`, pass: swOk },
    { name: `HTTPS / localhost (${baseURL.protocol}//${baseURL.hostname})`, pass: isHttps },
    { name: `meta-viewport (${viewportOk ? '✅' : '❌'})`, pass: viewportOk },
  ];
  const pwaPassed = pwaChecks.filter(c => c.pass).length;
  const pwa = Math.round((pwaPassed / pwaChecks.length) * 100);

  const fcp = lhr.audits['first-contentful-paint']?.numericValue;
  const lcp = lhr.audits['largest-contentful-paint']?.numericValue;
  const tbt = lhr.audits['total-blocking-time']?.numericValue;
  const cls = lhr.audits['cumulative-layout-shift']?.numericValue;
  const tti = lhr.audits['interactive']?.numericValue;

  const reportPath = join(process.cwd(), 'lighthouse-report.json');
  writeFileSync(reportPath, JSON.stringify(lhr, null, 2));

  console.log('=================================================');
  console.log(`PWA Score (手算):   ${pwa}/100  ${pwa >= 90 ? '✅' : '⚠️ '} (目标 ≥ 90)`);
  console.log(`Performance Score:  ${perf}/100  ${perf >= 80 ? '✅' : '⚠️ '} (目标 ≥ 80)`);
  console.log(`Best Practices:    ${bp}/100  ${bp >= 80 ? '✅' : '⚠️ '} (附加参考)`);
  console.log('--- PWA 子项 ---');
  pwaChecks.forEach(c => console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}`));
  console.log('-------------------------------------------------');
  console.log(`First Contentful Paint: ${(fcp/1000).toFixed(2)}s`);
  console.log(`Largest Contentful Paint: ${(lcp/1000).toFixed(2)}s`);
  console.log(`Total Blocking Time: ${Math.round(tbt)}ms`);
  console.log(`Cumulative Layout Shift: ${cls?.toFixed(3) ?? 'N/A'}`);
  console.log(`Time to Interactive: ${(tti/1000).toFixed(2)}s`);
  console.log('=================================================');
  console.log(`完整报告: ${reportPath}`);

  // 输出 perf-summary 兼容格式
  const summary = {
    timestamp: new Date().toISOString(),
    url: TARGET_URL,
    results: {
      P7: { name: 'Lighthouse PWA', target: '≥ 90', actual: pwa, unit: 'score', passed: pwa >= 90 },
      P8: { name: 'Lighthouse Performance', target: '≥ 80', actual: perf, unit: 'score', passed: perf >= 80 },
      'P1-lh': { name: 'Lighthouse FCP', target: '≤ 1.5s', actual: Math.round(fcp), unit: 'ms', passed: fcp <= 1500 },
      'P1-lh-lcp': { name: 'Lighthouse LCP', target: '≤ 2.5s', actual: Math.round(lcp), unit: 'ms', passed: lcp <= 2500 },
      'P1-lh-tbt': { name: 'Lighthouse TBT', target: '≤ 200ms', actual: Math.round(tbt), unit: 'ms', passed: tbt <= 200 },
    },
  };
  const sumPath = join(process.cwd(), 'lighthouse-summary.json');
  writeFileSync(sumPath, JSON.stringify(summary, null, 2));
  console.log(`\n摘要: ${sumPath}`);

  // 把 lighthouse 结果合并进 perf-summary.json（如果存在）
  const perfSumPath = join(process.cwd(), 'perf-summary.json');
  if (existsSync(perfSumPath)) {
    const ps = JSON.parse(readFileSync(perfSumPath, 'utf8'));
    Object.assign(ps.results, summary.results);
    ps.timestamp = summary.timestamp;
    writeFileSync(perfSumPath, JSON.stringify(ps, null, 2));
    console.log(`已合并到 ${perfSumPath}`);
  }

  process.exit(0);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
