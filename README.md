# 素描临摹 · 3D 参考

> 一个面向美术艺考生/写生练习的网页工具：**3D 模型 + 可控光源 + 写生视角微动 + 画板 + 多用户 + PWA 离线**。
>
> 完整规划见 `docs/` 目录。

[![CI](https://github.com/Xuanyu-Bai/sketch-reference/actions/workflows/ci.yml/badge.svg)](https://github.com/Xuanyu-Bai/sketch-reference/actions/workflows/ci.yml)
[![Deploy](https://github.com/Xuanyu-Bai/sketch-reference/actions/workflows/deploy.yml/badge.svg)](https://github.com/Xuanyu-Bai/sketch-reference/actions/workflows/deploy.yml)
[![PWA Score](https://img.shields.io/badge/PWA-100%2F100-success)](docs/11-test-report.md#3-性能基准)
[![Performance](https://img.shields.io/badge/Lighthouse_Perf-70%2F100-yellow)](docs/11-test-report.md#3-性能基准)


## 在线访问

**🎨 在线版本**：https://xuanyu-bai.github.io/sketch-reference/

GitHub Pages 部署，全栈功能（PWA 离线 + IndexedDB + 多用户）。

## 快速开始

### Windows（推荐 Node.js）

```bash
# 双击 start.bat，或：
node serve.js
```
然后浏览器访问 `http://localhost:8000`。

### 手动启动

任选其一：

```bash
# Node.js（推荐，PWA 离线需要正确 MIME）
node serve.js

# Python 3（基本功能可用，但 Service Worker 注册会失败）
python -m http.server 8000

# npx serve
npx serve .
```

> **关于 PWA 离线**：必须用 `node serve.js` 或 `npx serve` 才能正确注册 Service Worker。
> Python `http.server` 把 `.js` 当 `text/html` 吐，SW 会注册失败。

### 直接双击 `index.html` ⚠️

可以打开，但首次会弹出文件选择框（`file://` 协议禁止 JS 读取本地文件）。选一次 GLB 即可。

## 文件结构

```
├── index.html              主应用 HTML（280 行：UI 骨架 + importmap + bundle 引用）
├── src/
│   ├── app.js              应用代码（1917 行，esbuild minify → 42KB）
│   └── app.css             样式（254 行，esbuild minify → 18KB）
├── dist/                   构建产物（自动生成，git 跟踪）
│   ├── app.min.js          应用代码 minify
│   └── app.min.css         样式 minify
├── serve.js                Node HTTP 服务器（正确 MIME + 缓存策略）
├── manifest.webmanifest    PWA 配置
├── sw.js                   Service Worker（缓存策略：cache-first shell / network-first GLB）
├── icon-192.svg / icon-512.svg  PWA 图标
├── model.glb               3D 模型（**自己提供**，不放仓库里）
├── natural.png             参考图（用于对比模式，可选）
├── start.bat / start.ps1   一键启动脚本
├── scripts/
│   ├── build.mjs           esbuild 构建脚本
│   ├── e2e-test.mjs        Playwright E2E 套件（45 用例）
│   ├── perf-bench.mjs      Playwright 性能基准
│   ├── lighthouse-bench.mjs Lighthouse 性能基准
│   ├── meshify.py          Meshy.ai 2D→3D 批量工具（生产级）
│   └── image_to_3d.py      Meshy.ai 单图脚本
├── .github/workflows/
│   ├── ci.yml              CI：每次 push 跑 npm test + perf
│   └── deploy.yml          Cloudflare Pages 手动部署
├── docs/                   产品规划文档
│   ├── 01-requirements-analysis.md   需求分析
│   ├── 02-feasibility-analysis.md    技术可行性
│   ├── 03-architecture-analysis.md   架构分析
│   ├── 04-mvp-feature-list.md        MVP 功能清单
│   ├── 05-spec.md                    技术规格 + WBS
│   ├── 06-verification-plan.md       验证计划
│   ├── 07-prd.md                     PRD 产品说明书
│   ├── 08-ui-design.md               UI 设计规范
│   ├── 09-data-strategy.md           数据与多用户策略
│   ├── 10-dev-progress.md            开发进度记录
│   └── 11-test-report.md             测试报告 + 性能基准
└── README.md               本文件
```

## 开发流程

```bash
# 1. 安装依赖
npm install

# 2. 跑 E2E 测试（自动先 build）
npm test

# 3. 跑性能基准（自动先 build）
npm run perf         # Playwright 真实加载
npm run perf:lighthouse  # Lighthouse 模拟中端机
npm run perf:all     # 两者都跑

# 4. 修改 src/ 后需要重新 build
npm run build
```

## 主要功能

### 临摹者视角（鼠标驱动相机）

- **鼠标移动** → 相机围绕模型做轻微轨道运动，模拟写生时头部的微摆
- **手机触控** → 单指拖动旋转视角，双指捏合缩放模型
- **移出画布** → 视角自动回正
- **滚轮** → 缩放距离（0.3 ~ 60 单位）
- **灵敏度 / 摆动范围 / 阻尼** 三个滑块调节手感

### 底盘（地面）

- 大型网格地面（4×4 主网格 + 20×20 远景网格）
- 暗灰色圆形基座 + 香槟金高光圈
- 单独控制显示/隐藏、底盘大小、不透明度

### 预设视角

正面 / 3/4 侧 / 全侧 / 3/4 后 / 背面 / 顶视，快捷键 F/S/T/R

### 主光源（4 套经典布光预设）

模拟任意方向的关键光（水平角度 + 垂直仰角 + 强度 + 环境光）。
快捷按钮：**平光 / 侧光 / 顶光 / 伦勃朗光**。

### 画板（F-006 · 核心新增）

直接在 3D 视图上叠加画板绘画：
- **压感支持**：Apple Pencil / S Pen 压感有效（线条粗细随压力）
- **5 色选择器**：黑 / 白 / 灰 / 红 / 蓝
- **线宽 1-50px** + **不透明度 0-100%**
- **撤销 / 重做 / 清空**
- **快捷键**：B 切换模式 / Z 撤销 / Y 重做
- **截图（含画板）**：合成 3D + 画板导出 PNG

### 多用户（v1.0 新增）

- 顶栏头像点开用户菜单
- 每个用户独立：偏好设置、画板、IndexedDB 模型缓存
- 支持 **新建 / 切换 / 重命名 / 导出 JSON / 导入 JSON / 删除**
- 设备主人（第一个用户）不可被删
- 切换用户自动重新加载所有偏好

### 同框对比（F-005 · 完整重写）

右侧 380px 面板，上下分栏：
- 上半：当前画板快照
- 下半：参考原图（natural.png）
- 参考图透明度滑块
- 刷新按钮重新捕捉画板

### 辅助功能

- **线框模式**（快捷键 W）
- **水平镜像**
- **原图对比**（开关）
- **截图保存**：当前视角导出 PNG
- **持久化**：所有偏好（光源/视角/画板）自动存 localStorage

### PWA 离线（v1.0 新增）

- manifest.webmanifest: 标准 PWA 配置
- sw.js: Service Worker 缓存 shell + 模型
- iPad 可"添加到主屏幕"像原生 App 一样使用
- 首次打开后离线可用（已下载的模型）

## 切换模型

把任意 GLB 文件放到本目录，重命名为 `model.glb`，刷新页面即可。

或在右侧栏点 **"加载其他 GLB 文件"** 按钮选择其他位置的模型。

> 模型会自动缓存到当前用户的 IndexedDB，第二次访问秒开。

## 浏览器要求

需要支持 ES Modules + importmap + Pointer Events + IndexedDB + Service Worker 的现代浏览器：

- Chrome / Edge 89+
- Firefox 108+
- Safari 16.4+（iPadOS 16+ / iOS 16+）

## 配置修改

打开 `index.html`，最上面 `<script type="module">` 块里的 `CONFIG` 对象：

```js
const CONFIG = {
  modelFile: 'model.glb',          // 默认加载的模型文件名
  originalSketch: 'natural.png',   // 原图对比的图
  title: '素描临摹 · 3D 参考模型',
  defaultBackground: '#f5f3ee',    // 画布背景色
};
```

## 模型素材生成

用 `scripts/meshify.py` 通过 Meshy.ai 把 2D 素描图转为 3D GLB：

```bash
pip install requests
export MESHY_API_KEY=<your_key>
python scripts/meshify.py ./sketches/ -o ./models/ --polycount 10000
```

## License

MIT
