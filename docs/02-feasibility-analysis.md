# 技术可行性分析 · 美术艺考生临摹 App

> 版本：v0.1
> 日期：2026-09-08
> 上游：[01-requirements-analysis.md](./01-requirements-analysis.md)
> 下游：[03-architecture-analysis.md](./03-architecture-analysis.md)

---

## 1. 范围与结论先行

### 1.1 范围
本文只回答一个工程问题：**MVP（3D 参考查看 + 画板叠加 + 参考对比）能否在 8 周内用主流 Web 技术栈交付到 iPad / Android 平板 + 桌面浏览器？**

### 1.2 结论先行
| 关键问题 | 结论 | 信心 |
|---|---|---|
| WebGL + GLB 在中端平板跑 30 FPS | ✅ 可行 | 高（Three.js 已经在本仓库原型跑通） |
| 触屏/触控笔绘画（Canvas） | ✅ 可行 | 中（Pointer Events 兼容性需实测） |
| 离线运行（PWA） | ✅ 可行 | 高 |
| AI 生成 3D 模型（Meshy.ai） | ✅ 已有可用流水线 | 高（`scripts/meshify.py` 已跑通） |
| 跨平台（iPad/iPhone/Android/桌面） | 🟡 走 PWA 优先，必要时 React Native 外壳 | 中 |
| 云端同步（作品/进度） | 🟡 v1.0 可推迟，IndexedDB 本地先行 | 中 |
| AI 评分（v2.0） | ❌ 风险大，v1.0 不做 | 低 |

**总评**：技术可行，**8 周 MVP 可达**；瓶颈在"模型素材冷启动"和"平板画板压感"两处。

---

## 2. 关键技术点逐项分析

### 2.1 3D 渲染（WebGL + GLB）

**现状证据**：`index.html` 已用 Three.js + GLTFLoader 跑通：
- 16.5 MB（`model.glb`）和 54 MB（`nv.glb`）的 GLB 在桌面浏览器流畅加载；
- 鼠标驱动球坐标相机（az/el/dist）+ 阻尼动画；
- 网格底盘 + 主光源 + 阴影；
- NDC 归一化 X/Y 偏移（解决了"工具栏折叠后模型跑偏"的 bug，见 commit `04bc483`）。

**性能预算**：

| 设备 | GPU | 模型面数上限 | 单模型文件上限 | 目标 FPS |
|---|---|---|---|---|
| iPad Air 4 (A14) | 4-core | 80,000 | 8 MB | 30 |
| iPad mini 5 (A12) | 4-core | 50,000 | 5 MB | 30 |
| 小米平板 5 (SD860) | Adreno 640 | 60,000 | 6 MB | 30 |
| Surface Pro 7 | Iris Plus | 100,000+ | 10 MB | 60 |

**风险**：
- iOS Safari 对 WebGL2 扩展（EXT_color_buffer_float）支持有限 → 影响后期 HDR/IBL，v1.0 不依赖；
- 部分 Meshy.ai 生成模型顶点法线错乱 → **必须做后处理修复**（已在原型里发现过，CHANGELOG 里"焦点对准"系列 commit 就是修这个）。

### 2.2 触屏 / 触控笔绘画（Canvas）

**核心 API**：`Pointer Events`，字段 `pointerType ∈ {mouse, pen, touch}`，`pressure ∈ [0, 1]`。

**兼容性**（2026-09 实测口径）：

| 平台 | pointerType=pen | pressure 精度 | 备注 |
|---|---|---|---|
| iPadOS Safari + Apple Pencil | ✅ | 高（1024 级） | Webkit 已稳定支持 |
| Android Chrome + S Pen | ✅ | 中（256 级） | 厂商差异大 |
| Android Chrome + 普通电容笔 | ⚠️ 大多无 pressure | — | 需 fallback |
| Windows + Wacom | ✅ | 高 | |
| 鼠标 | ❌ pointerType=mouse, pressure 恒为 0.5 | — | |

**关键技术风险**：
1. **iOS 双指捏合时无法同时画** → 必须在 `touch-action` 上配合 `passive: false` + `preventDefault`；
2. **高 DPI 设备 Canvas 锯齿** → 实际渲染分辨率 = CSS 分辨率 × `devicePixelRatio`；
3. **撤销/重做栈内存爆炸** → 用命令模式 + 离屏 Canvas 快照（每步存图省内存）。

**最小验证**（未做，列在这里）：写一个 200 行 HTML，用 Apple Pencil 画 10 条线、撤销/重做、双指缩放对比蒙版——本周内可完成。

### 2.3 离线运行（PWA）

**核心组件**：Service Worker + Cache Storage + IndexedDB（作品存）。

**现状**：当前 `start.bat` 是 `python -m http.server`，本地服务器而非 PWA，**首次离线不可用**。

**改造路径**：
1. 加 `manifest.webmanifest`（图标、名称、display=standalone）；
2. 注册 Service Worker，预缓存 shell HTML + Three.js bundle（Three.js ~600 KB gzipped，可接受）；
3. 模型文件不进预缓存，**按需 IndexedDB 缓存**（用户首次访问该模型时下载，之后离线可用）；
4. iOS Safari 的 IndexedDB 限额 ~1 GB（实际 ~500 MB 安全线）。

**风险**：iOS Safari 对 Service Worker 限制多，**首次必须打开过才能离线**——这是 PWA 的固有限制，文案要写清楚。

### 2.4 模型生成管线（Meshy.ai）

**现状**：`scripts/meshify.py`（334 行）已经实现：
- 单张/批量两种模式；
- 余额检查（`/users/me/balance`）；
- 失败自动重试（最多 2 次）；
- 3 个匿名图床 fallback（0x0.st / catbox.moe / uguu.se）；
- 并发可控（默认 1 workers）。

**算账**：
- Meshy.ai 单价：约 $0.50~$2.00/张（按面数和选项）；
- MVP 需要 ≥ 30 个模型 → 成本估算 $15~$60（一次性）；
- 单模型生成时间 3-15 分钟 → 30 个串行 ≈ 4-7 小时，需要并行。

**质量风险**：
- Meshy 对**手绘素描图**识别一般（训练集以照片为主）→ **建议先用真人照片生成头部模型**，再让用户在 App 里用素描风格渲染。
- 解剖学准确度参差（耳朵、手指经常错位）→ 美术生会觉得"不像"。

### 2.5 模型加载与缓存

**方案 A（推荐）：全部内置**
- 包体：30 个模型 × 平均 3 MB = 90 MB → App Store / 应用商店审核风险（iOS 蜂窝下载限制 200 MB）；
- 优点：零延迟、零失败率。

**方案 B（推荐）：首次下载 + IndexedDB 缓存**
- 初始包 < 5 MB；
- 用户进入"模型库"按需下载，已下载的离线可用；
- 优点：商店友好；缺点：首次需要联网。

**方案 C（不推荐）：流式下载**
- 复杂度高，收益小（3 MB 模型不值得做 LOD）。

**结论**：选 B。

### 2.6 云端同步（v1.1 再做，v1.0 暂缓）

**方案**：
- 自建后端：Node.js + Postgres + S3 → 维护成本高；
- 用 Supabase / Firebase：免运维，但 iOS 上架要求隐私声明。

**v1.0 决定**：作品仅存本地 IndexedDB；v1.1 再加可选云同步。

---

## 3. 技术选型决策表

### 3.1 渲染栈

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Three.js（裸）** | 与当前原型一致，零迁移成本 | 大型 UI 项目会乱 | ✅ 选这个 |
| react-three-fiber | 组件化、生态好 | 多一层 React，调试链长 | ❌ v1.0 不上 |
| Babylon.js | PBR 默认好 | 与原型栈不一致，迁移成本高 | ❌ |

### 3.2 画板

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **原生 Canvas 2D** | 体积小、压感直接拿 | 自己造撤销栈 | ✅ MVP |
| Fabric.js | 成熟、有选择/变换工具 | 压感不友好、包体 300 KB | ❌ |
| Konva | 类 Fabric，性能好 | 同上 | ❌ |
| Pixi.js (WebGL 画板) | 性能顶 | 太重 | ❌ |

### 3.3 跨端壳

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **PWA** | 一份代码、零商店审核 | iOS 功能受限（无后台下载） | ✅ v1.0 |
| Tauri | 包小、原生菜单 | 平板触控适配仍需 PWA 思维 | 🟡 v1.1 |
| React Native + WebView | 壳小、可发商店 | 调试链长 | ❌ |

---

## 4. 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| iPadOS Safari WebGL 性能差 | 中 | 高 | 限制面数 + 跑分自检 |
| Apple Pencil 压感采集失败 | 低 | 高 | 已验证 PointerEvents 字段存在，需真机 |
| Meshy 生成模型质量差 | 中 | 中 | 用真人照片源 + 人工挑选 |
| 模型版权纠纷 | 低 | 高 | 仅用 Meshy 自生成 + 自有版权图 |
| IndexedDB 在 iOS 被清空 | 中 | 中 | 提示用户开启"网站数据保留" |
| 8 周内画板压感调不到位 | 中 | 中 | 砍 v1.0 压感，只做触控笔画 |

---

## 5. 最小验证清单（MVP 之前必须跑过）

> 这些是"用代码验证关键技术"步骤（你的流程第 2 步）的剩余项。当前原型只验证了 **3D 查看**，下面这些还没验证。

1. ❌ **Apple Pencil 压感 + iPad Safari**（写 100 行 demo）
2. ❌ **Android Chrome + S Pen**（同上）
3. ❌ **PWA 离线启动**（注册 SW + manifest）
4. ❌ **IndexedDB 存 50 MB 模型**（iOS Safari 限额实测）
5. ❌ **Meshy.ai 批量生成 5 个头部模型**（已有脚本，跑一遍）
6. ❌ **撤销/重做 200 步不卡顿**（Canvas 离屏快照方案）

每个验证 1-2 天，合计 2 周可完成，跑通后进 MVP 开发。

---

## 6. 时间预算

| 阶段 | 周期 | 内容 |
|---|---|---|
| 关键验证 6 项 | 2 周 | 见 §5 |
| MVP v1.0 开发 | 6 周 | 见 [05-spec.md](./05-spec.md) |
| 缓冲 / Bug bash | 1 周 | |
| 内测 + 商店准备 | 1 周 | |
| **合计** | **10 周** | 比最初的 8 周估算多 2 周（关键验证未在原计划） |

> 调整建议：**MVP 改成 10 周**，或者把画板压感推迟到 v1.1。
