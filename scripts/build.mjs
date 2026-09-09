// scripts/build.mjs
// 构建脚本：src/app.js → dist/app.bundle.js（带 three.js 内联 + minify）
//             src/app.css → dist/app.min.css（minify）
//
// 用法：npm run build

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_JS = join(ROOT, 'src/app.js');
const SRC_CSS = join(ROOT, 'src/app.css');
const OUT_DIR = join(ROOT, 'dist');
const OUT_JS = join(OUT_DIR, 'app.min.js');

mkdirSync(OUT_DIR, { recursive: true });

const t0 = Date.now();
console.log('⚙️  构建中...');

// 策略：app.js 走 esbuild minify（68KB → ~25KB），three.js 仍走 importmap CDN（异步、gzip、可缓存）。
// esbuild 用 external + paths 把 'three' 重写为 importmap 已有的 specifier
const jsResult = await build({
  entryPoints: [SRC_JS],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  treeShaking: true,
  // 不打包 three：保持 import 'three' / 'three/addons/...' 字面量
  external: ['three', 'three/*'],
  outfile: OUT_JS,
  metafile: true,
  logLevel: 'warning',
});

// CSS minify
await build({
  entryPoints: [SRC_CSS],
  bundle: true,
  loader: { '.css': 'css' },
  minify: true,
  outfile: join(OUT_DIR, 'app.min.css'),
  logLevel: 'warning',
});

const dt = Date.now() - t0;
const appJsSize = readFileSync(OUT_JS).length;
const appCssSize = readFileSync(join(OUT_DIR, 'app.min.css')).length;

console.log(`✅ app.min.js  ${(appJsSize / 1024).toFixed(1)} KB`);
console.log(`✅ app.min.css ${(appCssSize / 1024).toFixed(1)} KB`);
console.log(`⏱️  耗时: ${dt}ms`);
console.log(`📦 three.js 走 importmap CDN（异步 + gzip）`);


