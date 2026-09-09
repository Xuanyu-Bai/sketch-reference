// 简易 HTTP 服务器，正确处理 MIME 类型（Service Worker 需要）
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found: ' + urlPath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    // dist/ 下的 bundle 文件可长缓存（每次构建内容都变，文件名应带 hash；这里暂用 1 天）
    const cacheControl = urlPath.startsWith('/dist/')
      ? 'public, max-age=86400'
      : 'no-cache';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
      'Service-Worker-Allowed': '/',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  素描临摹 3D 参考 - 本地服务器');
  console.log('  ============================');
  console.log('  访问地址: http://' + HOST + ':' + PORT + '/');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
