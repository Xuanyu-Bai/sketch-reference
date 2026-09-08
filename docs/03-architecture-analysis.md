# 架构分析 · 美术艺考生临摹 App

> 版本：v0.1
> 日期：2026-09-08
> 上游：[02-feasibility-analysis.md](./02-feasibility-analysis.md)
> 下游：[05-spec.md](./05-spec.md)

---

## 1. 顶层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    PWA Shell（index.html + Service Worker）       │
├─────────────────────────────────────────────────────────────────┤
│  UI 层  │  业务编排层  │  渲染层        │  画板层     │  数据层  │
│  CSS    │  Event Bus   │  Three.js     │  Canvas 2D  │  IDB     │
│  HTML   │  SceneMgr    │  WebGL        │  PointerEvt │  Cache   │
│  State  │  ViewCtrl    │  GLTFLoader   │  StrokeMgr  │  Manifest│
├─────────────────────────────────────────────────────────────────┤
│                  OS / Browser 抽象层（Pointer / WebGL / IDB）    │
└─────────────────────────────────────────────────────────────────┘
```

**关键设计原则**：
1. **渲染层和画板层完全独立**——3D 视图是底层，画板是叠在上面的 2D 透明层，二者通过 `pointer-events` 切换；
2. **数据层只暴露"模型/作品/会话"三个仓库**，不直接被 UI 访问；
3. **事件总线** 用简单的发布订阅（不用 Redux/Vuex，单文件 App 不值得引）。

---

## 2. 模块划分

### 2.1 模块树

```
src/
├── app.js                  # 入口，初始化所有模块
├── config.js               # CONFIG（当前 index.html 里那段）
├── ui/
│   ├── sidebar.js          # 右侧折叠工具栏
│   ├── header.js           # 顶部标题栏
│   ├── indicator.js        # 左上角方位/仰角/距离 HUD
│   └── compare-panel.js    # 右下角原图对比
├── scene/
│   ├── scene-mgr.js        # Three.js Scene + Renderer + Camera 总控
│   ├── model-loader.js     # GLB 加载 + 包围盒 + 法线修复
│   ├── light-mgr.js        # 主光 + 环境光 + 阴影
│   ├── ground.js           # 网格底盘（基座 + 主网格 + 远景网格）
│   ├── view-ctrl.js        # 球坐标相机 + 鼠标驱动 + 预设视角
│   └── post-fx.js          # 线框模式 / 水平镜像 / 截图
├── sketch/
│   ├── canvas.js           # 画板 Canvas（叠在 3D 之上）
│   ├── stroke.js           # 一笔画的数据结构 + 渲染
│   ├── undo-stack.js       # 撤销/重做（命令模式 + 离屏快照）
│   ├── pointer-bridge.js   # 触屏/笔/鼠标事件归一化
│   └── compare.js          # 同框对比：用户画 vs 参考
├── data/
│   ├── idb.js              # IndexedDB 包装（不开 raw API）
│   ├── model-repo.js       # 模型元数据 + GLB 二进制缓存
│   ├── artwork-repo.js     # 用户作品（PNG + 元数据）
│   └── session-repo.js     # 练习会话（时间、模型、时长）
├── ai/
│   ├── meshy-client.js     # Meshy.ai REST 包装（如果放在 App 里）
│   └── upload.js           # 匿名图床 fallback
└── utils/
    ├── event-bus.js        # 轻量 pub/sub
    ├── fit-distance.js     # FOV 自适应框选
    ├── ndc-offset.js       # 归一化屏幕偏移
    └── pressure-curve.js   # 压感曲线映射
```

### 2.2 当前原型（index.html）到模块树的映射

| 原型章节（行号） | 对应模块 |
|---|---|
| `CONFIG` (30-50) | `config.js` |
| Scene/Renderer/Camera 初始化 (200-260) | `scene/scene-mgr.js` |
| GLB 加载 (270-330) | `scene/model-loader.js` |
| 光源 (340-380) | `scene/light-mgr.js` |
| 底盘（基座+网格）(380-450) | `scene/ground.js` |
| 球坐标相机 (450-600) | `scene/view-ctrl.js` |
| 6 个预设视角按钮事件 (900-950) | `scene/view-ctrl.js` |
| 滑块事件绑定 (1050-1200) | `ui/sidebar.js` |
| 截图 (1200-1210) | `scene/post-fx.js` |
| 渲染循环 + HUD 更新 (1180-1216) | `scene/scene-mgr.js` + `ui/indicator.js` |

> 当前原型是 1 个文件，模块化只是**逻辑切分**（不强制拆文件），可以让代码可读性变好；将来如果迁移到 Vite 才需要真拆目录。

---

## 3. 关键数据流

### 3.1 模型加载流

```
[UI: 用户选模型]
   │
   ▼
[model-repo.get(id)]
   │
   ├─ IndexedDB 命中 ──────► Blob ──► URL.createObjectURL ──► GLTFLoader
   │
   └─ 未命中 ──► fetch(CDN) ──► 存 IDB ──► URL.createObjectURL ──► GLTFLoader
                                                         │
                                                         ▼
                                              [包围盒 + 视觉中心计算]
                                                         │
                                                         ▼
                                              [scene-mgr.add(root)]
                                                         │
                                                         ▼
                                              [view-ctrl.fitToView()]
```

**关键点**：
- 模型永远走 `URL.createObjectURL(blob)`，避免反复 fetch；
- 视觉中心算法（commit `a307549` / `5c91d38`）：用"顶部 50% 顶点重心 + 前方 50% 顶点重心"加权，**比几何中心更接近人脸**——这是当前原型已经验证的算法。

### 3.2 绘画流

```
[Pointer 事件]
   │
   ▼
[pointer-bridge.normalize(evt)]
   │ 输出：{x, y, pressure, pointerType, isPen}
   ▼
[stroke.begin / stroke.extend]
   │ 内部：维护 Bezier 平滑点
   ▼
[canvas.requestRender()]
   │
   ▼
（每帧）[stroke.render(ctx)]
   │
   ▼
[undo-stack.push(command)]
```

**关键设计**：
- **每帧只重画当前笔触**，历史笔触是离屏 Canvas 缓存（避免每帧全部重绘）；
- 撤销栈每 10 步做一次离屏快照（性能/内存平衡）；
- pressure 曲线经过 `pressure-curve.js` 映射（不同笔粗细风格不同）。

### 3.3 离线模型同步流

```
[App 启动]
   │
   ▼
[SW: 命中 cache] ──► 直接用
   │
   ▼（未命中）
[fetch + 存 Cache Storage] ──► 用 + 后台异步存 IndexedDB
                                          │
                                          ▼
                                  [model-repo 标记为 cached]
```

---

## 4. 关键技术决策（ADR 摘要）

### ADR-001：渲染栈用 Three.js 裸，不用 react-three-fiber

- **理由**：当前原型已经基于 Three.js 跑通；引入 R3F 要重写整个 UI，且 v1.0 不会用到 R3F 的组件化优势；
- **代价**：大型 UI 项目代码组织差，但 MVP 单文件可控；
- **撤销条件**：v2.0 如果要做"班级后台"或复杂状态管理，再迁移。

### ADR-002：画板用 Canvas 2D，不用 WebGL

- **理由**：Canvas 2D 的 stroke 性能（60 FPS 在 iPad 上稳定）+ 压感直接拿，零学习成本；
- **代价**：撤销/重做要自己做；
- **撤销条件**：如果撤销栈超过 1000 步卡顿，迁移到 OffscreenCanvas + 路径对象池。

### ADR-003：模型加载用"首次下载 + IndexedDB 缓存"

- **理由**：商店包体限制 + 用户流量成本；
- **代价**：首次必须联网；
- **撤销条件**：做原生 App 时改为内置。

### ADR-004：MVP 不做云同步

- **理由**：后端运维成本高，v1.0 用户规模小，本地够用；
- **撤销条件**：DAU 超过 1000 或用户反馈强烈。

### ADR-005：Meshy.ai 走服务端代理，不暴露 API Key

- **理由**：API Key 放前端会被滥用；
- **方案**：v1.0 模型生成跑在开发机（开发者手动生成），用户侧只下载成品 GLB；
- **撤销条件**：如果做"用户上传照片生成自己头像"，再加后端代理。

---

## 5. 部署架构

### 5.1 v1.0（静态托管）

```
┌────────────────────────┐
│ Cloudflare Pages / CDN │  index.html + sw.js + manifest
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ 模型 GLB 在 R2 / OSS    │  按需 fetch，浏览器缓存
└────────────────────────┘
```

### 5.2 v1.1（加后端）

```
┌────────────────────────┐
│ Cloudflare Pages        │  前端
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Cloudflare Workers      │  Meshy.ai 代理、用户上传签名
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Supabase / Postgres    │  用户、作品元数据
└────────────────────────┘
```

---

## 6. 性能与扩展性

| 维度 | v1.0 目标 | v2.0 目标 |
|---|---|---|
| 并发用户 | 10K DAU | 100K DAU |
| 模型库规模 | 30 个 | 200 个 |
| 单用户作品数 | 100 个 | 1000 个 |
| 离线支持 | 已下载模型 + 已有作品 | 全部本地 + 队列同步 |

v1.0 阶段 CDN + 静态托管足够；v2.0 才考虑分片 / 多 CDN。

---

## 7. 安全与隐私

| 项 | 措施 |
|---|---|
| API Key 不暴露前端 | 后端代理（v1.1+） |
| 用户作品默认本地 | 不上传 |
| 第三方 Cookie / Tracker | 无（v1.0 全静态） |
| 模型版权 | 仅用 Meshy 自生成 + 自有版权图，元数据里写明来源 |
| 数据加密 | IndexedDB 明文（本地），云同步走 TLS |

---

## 8. 与现状对照（已做 / 待做）

| 模块 | 现状 | 行动 |
|---|---|---|
| 渲染层 | ✅ 原型已跑通 | 模块化拆分（不急） |
| 视角控制 | ✅ 原型已跑通 | 同上 |
| 光源 | ✅ 原型已跑通 | 加 4 套经典预设 |
| 底盘 | ✅ 原型已跑通 | 无 |
| 画板 | ❌ 没做 | **关键技术风险，最高优先级** |
| 模型库 | ⚠️ 只有 1 个 model.glb | 用 meshify.py 批量生成 30 个 |
| 离线 | ❌ 没做 PWA | 加 SW + manifest |
| 数据持久化 | ❌ 没做 | IndexedDB |
| 云同步 | v1.0 不做 | — |
