# 素描临摹 3D 参考网站 · 部署说明

## 文件清单

把这 3 个文件放在**同一个目录**下即可：

```
your-site/
├── index.html                                       ← 网站主体
├── model.glb                                        ← 你的 3D 模型（重命名！）
└── original-sketch.png                              ← 原素描图（可选，仅对比时需要）
```

> 如果你想保留原文件名，编辑 `index.html` 顶部的 `<script type="module">` 块，把
> `CONFIG.modelFile` 改为实际文件名即可。

## 本地预览（三种方式）

### 方式 A：一键启动（推荐）⭐

直接双击 `start.bat`（Windows）或运行 `start.ps1`（PowerShell），脚本会自动：
1. 启动 Python/Node 内置的 HTTP 服务器
2. 自动打开浏览器到 `http://localhost:8000`
3. 控制台窗口保持打开，关掉即停止服务器

### 方式 B：手动启动服务器

任选其一：

```bash
# Python 3（最方便，几乎人人都有）
python -m http.server 8000

# Node.js
npx serve .

# VS Code 用户：装 "Live Server" 扩展，右键 index.html → Open with Live Server
```

然后浏览器打开 `http://localhost:8000`。

### 方式 C：直接双击 index.html（无服务器）⚠️ 首次需选一次文件

可以直接双击 `index.html` 在浏览器打开。**首次会弹出文件选择框**，选一次 GLB 即可：

> 这是因为 `file://` 协议下浏览器禁止 JS 自动读取本地文件（出于安全考虑）。
> 选择一次后浏览器会记住该会话。要分享给学生时，必须走方式 A 或 B（或部署到公网）。

如果想避免选择：在浏览器启动时加 `--allow-file-access-from-files` 参数（**仅开发测试**，不安全）。

## 部署到公网（给学生用）

### 方案一：GitHub Pages（免费，最稳）

1. 把这 3 个文件 push 到一个 GitHub 仓库根目录
2. Settings → Pages → Source 选 `main` 分支根目录
3. 几分钟后得到 `https://<user>.github.io/<repo>/` 这种 URL

### 方案二：Vercel / Netlify / Cloudflare Pages（免费，更快）

1. 注册账号 → New Project → 拖入这个文件夹
2. 无需任何构建配置，直接 Deploy
3. 得到 `https://xxx.vercel.app` 之类的 URL，可绑定自定义域名

### 方案三：自己的服务器

把文件夹扔进任何 nginx/Apache 静态目录即可。

## 功能速查

- **旋转 / 缩放 / 平移**：鼠标左键 / 滚轮 / Shift+左键
- **预设视角**：右侧 6 个按钮，或快捷键 `F`正面 / `S`侧 / `T`顶 / `R`重置
- **线框模式**：`W` 或勾栏右下角
- **网格**：`G` 或勾栏
- **截图**：右侧"📷 保存当前视角"按钮，会下载 PNG
- **原图对比**：勾栏"原图对比"，原图出现在右上角
- **关键光控制**：右侧滑块，可以模拟任意光源方向

## 给美术生的小提示

- 主光源的**水平角度 + 垂直仰角** 决定明暗交界线位置 —— 这是素描头像最关键的两条线
- 想要练习"高光在额头 / 鼻梁"时：仰角调小（约 15°），水平角度调到模型正前方 ±30°
- 想要练习"颧骨阴影"：水平角度 90° 或 -90°（全侧光）
- 想要"平光"（少见但考试有时考）：水平 0°，仰角 0°
- 线框模式适合研究"骨点结构"
- 网格适合研究"头身比例"（头高 ≈ 身高的 1/7~1/8）

## 常见问题

**Q: 模型加载失败？**
A: 99% 是文件名不匹配。把 GLB 重命名为 `model.glb`，或者改 `index.html` 里的 `CONFIG.modelFile`。

**Q: 模型太大加载慢？**
A: Meshy.ai 自带的 GLB 通常 10-50 MB。用 [https://gltf-transform.dev/](https://gltf-transform.dev/) 的 `draco` + `texture-compress` 命令可压缩到原来的 1/3 左右，纹理用 KTX2/BasisU 进一步减半。

**Q: 想加更多模型？**
A: 复制 `index.html` 为 `index2.html`，修改顶部的 `CONFIG.modelFile` 即可。后续可改造为下拉切换。

**Q: 想要学生直接在屏幕上画？**
A: 在 `canvas-container` 上叠一个 HTML5 `<canvas>`，监听鼠标 / 触摸事件绘制即可。需要的话我可以加上去。
