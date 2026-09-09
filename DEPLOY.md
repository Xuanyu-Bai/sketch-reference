# 部署指南 · 美术艺考生临摹 App

> 把 v1.0 MVP 部署到公网，让艺考生能直接用。

## 推荐方案：Cloudflare Pages

**为什么选 Cloudflare Pages**：
- ✅ 免费（个人项目无限制流量）
- ✅ 全球 CDN（200+ 节点，中国访问速度不错）
- ✅ 自动 HTTPS
- ✅ 支持自定义域名
- ✅ 一行命令部署：`npx wrangler pages deploy .`

## 部署步骤（3 种方式）

### 方式 A：手动部署（最快，5 分钟）

```bash
# 1. 安装 wrangler
npm install -g wrangler

# 2. 登录（会打开浏览器授权）
wrangler login

# 3. 创建 Pages 项目（首次）
wrangler pages project create sketch-reference

# 4. 部署（生产环境会得到 https://sketch-reference.pages.dev）
npx wrangler pages deploy . --project-name=sketch-reference
```

部署完成后访问 `https://sketch-reference.pages.dev` 即可。

### 方式 B：GitHub Actions 自动部署（推荐用于持续集成）

需要先在 GitHub 仓库设置 2 个 Secrets：

1. 打开 https://github.com/Xuanyu-Bai/sketch-reference/settings/secrets/actions/new
2. 添加：
   - `CLOUDFLARE_API_TOKEN` - 在 https://dash.cloudflare.com/profile/api-tokens 创建，模板选 "Edit Cloudflare Pages"
   - `CLOUDFLARE_ACCOUNT_ID` - 在 Cloudflare Dashboard 右侧栏

之后 push 到 `main` 分支自动部署。

### 方式 C：本地临时分享（最快，2 分钟）

如果只想分享给几个人测试：

```bash
# 在项目根目录跑
node serve.js

# 然后用 ngrok 暴露到公网
ngrok http 8000
```

## 部署后必测

部署完成先验证这些：

| 测试 | 命令 / 方法 |
|---|---|
| HTTPS 工作 | 浏览器打开看锁图标 |
| Service Worker 注册 | DevTools Console 看 `[SW] registered` |
| PWA 安装 | Chrome → 地址栏右侧"安装"图标 |
| 模型能加载 | 默认 model.glb 加载 |
| 移动端打开 | 用手机扫码访问 |
| iPad 画板 | 用 iPad Safari 测试压感 |

## CI / CD

**自动测试**：[`.github/workflows/ci.yml`](.github/workflows/ci.yml) — 每次 push / PR 自动跑：
- `npm test`（Playwright E2E 50 用例）
- `npm run perf`（Playwright 性能基准 P1-P3/P5/P6）
- `npm run perf:lighthouse`（Lighthouse P7/P8，软失败）
- 上传 `perf-summary.json` 到 artifact（30 天保留）

**自动部署**：当前主部署走 GitHub Pages（push 到 main 自动）。Cloudflare Pages workflow（`.github/workflows/deploy.yml`）默认手动触发，可选启用。

## PWA 安装提示

用户访问 https://sketch-reference.pages.dev 后：
- **iPad Safari**：分享按钮 → "添加到主屏幕"
- **Android Chrome**：菜单 → "添加到主屏幕" / "安装应用"
- **桌面 Chrome**：地址栏右侧安装图标

安装后可以从主屏幕像原生 App 一样打开（全屏，无浏览器地址栏）。

## 自定义域名

如有域名（如 sketch.yourdomain.com）：

1. Cloudflare Dashboard → Pages → sketch-reference → Custom domains
2. 添加 CNAME 指向 `sketch-reference.pages.dev`
3. DNS 自动配置（如果域名在 Cloudflare）

## 性能优化建议

部署后建议做的优化：

1. **启用 Cloudflare 缓存**：默认就开了
2. **模型文件走 R2/Storage**：当前 `.glb` 在 gitignore，未来上传到 R2 后用 CDN 加速
3. **Cloudflare Analytics**：启用 Web Analytics 看真实用户指标

## 故障排查

| 问题 | 排查方法 |
|---|---|
| SW 注册失败 | DevTools → Application → Service Workers，看 error |
| GLB 加载 404 | 检查 model.glb / models/*.glb 是否在部署目录 |
| HTTPS 警告 | Cloudflare 默认会签证书，等 5 分钟 |
| Service Worker 缓存旧版 | `wrangler pages deployment tail` 看实时日志 |
| 模型加载慢 | 启用 Cloudflare 的"Auto Minify"（HTML/CSS/JS） |

## 当前部署状态

| 项目 | 值 |
|---|---|
| 仓库 | https://github.com/Xuanyu-Bai/sketch-reference |
| Pages URL | **https://xuanyu-bai.github.io/sketch-reference/** ✅（当前主部署） |
| 自定义域名 | 无 |
| HTTPS | ✅（GitHub Pages 自动）|
| PWA | ✅ |
| 总包大小 | ~5 MB（不含 .glb 模型）|
