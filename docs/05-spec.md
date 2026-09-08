# 技术规格（SPEC）· MVP v1.0

> 版本：v0.1
> 日期：2026-09-08
> 上游：[04-mvp-feature-list.md](./04-mvp-feature-list.md)
> 下游：[06-verification-plan.md](./06-verification-plan.md)

---

## 1. 数据模型

> 完整数据模型（**用户模型、用户偏好、作品、模型缓存**）见 **[09-data-strategy.md §4](./09-data-strategy.md)**。本节只列出与渲染相关的全局模型。

### 1.1 Model（3D 模型元数据 · 全局共享）

```ts
interface Model {
  id: string;              // uuid
  name: string;            // "男中年 3-4 侧"
  category: {
    gender: '' | 'male' | 'female';
    age: '' | 'young' | 'middle' | 'old';
    view: '' | 'front' | 'three-quarter' | 'side' | 'back' | 'top';
  };
  tags: string[];
  fileSize: number;        // bytes
  triangleCount: number;
  source: 'meshy' | 'manual' | 'sketchfab';
  license: string;         // 'self-generated', 'CC0', etc.
  createdAt: number;       // unix ms
  glbUrl: string;          // CDN URL or local blob URL
  thumbnailUrl: string;    // 缩略图
  defaultView: { az: number; el: number; dist: number };
  defaultLight: { az: number; el: number; intensity: number };
}
```

### 1.2 Artwork（用户作品）

```ts
interface Artwork {
  id: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;      // 实际绘画时长
  pngBlob: Blob;           // 合成后的 PNG（画板叠在 3D 视图上）
  sketchBlob: Blob;        // 仅画板层（v1.1+ 用）
  canvasSize: { w: number; h: number };
  strokeCount: number;
  // 元数据
  view: { az: number; el: number; dist: number };
  light: { az: number; el: number; intensity: number };
  backgroundColor: string;
}
```

### 1.3 Session（练习会话，v1.1+）

```ts
interface Session {
  id: string;
  startedAt: number;
  endedAt: number;
  modelId: string;
  artworkIds: string[];
  notes: string;
}
```

### 1.4 AppConfig（运行时配置）

```ts
interface AppConfig {
  defaultModelId: string;
  defaultBackground: string;
  showGround: boolean;
  showWireframe: boolean;
  showReticle: boolean;
  tracerSensitivity: number;   // 0-1
  tracerRange: number;         // 0-1
  tracerDamping: number;       // 0-1
}
```

---

## 2. 接口契约

### 2.1 模型加载 API

```ts
class ModelRepo {
  async list(): Promise<Model[]>;
  async get(id: string): Promise<Model>;
  async loadGlb(id: string): Promise<Blob>;  // 优先 IDB，回退 CDN
  async preloadAll(): Promise<void>;          // 后台预下载（v1.1）
}
```

### 2.2 画板 API

```ts
class SketchCanvas {
  constructor(container: HTMLElement, opts: { width: number; height: number });
  enable(): void;
  disable(): void;
  clear(): void;
  undo(): void;
  redo(): void;
  setColor(color: string): void;
  setLineWidth(w: number): void;
  setOpacity(o: number): void;
  exportPng(): Promise<Blob>;
  on(event: 'stroke', cb: (s: Stroke) => void): void;
}
```

### 2.3 视角控制 API

```ts
class ViewController {
  setAngles(az: number, el: number): void;
  setDistance(d: number): void;
  animateTo(target: { az: number; el: number; dist: number }, durationMs: number): void;
  fitToModel(box: Box3): void;
  enableTracer(enabled: boolean): void;
  setTracer(opts: { sensitivity: number; range: number; damping: number }): void;
  captureScreenshot(): Promise<Blob>;
}
```

### 2.4 事件总线

```ts
type Event =
  | { type: 'model-loaded'; model: Model }
  | { type: 'view-changed'; az: number; el: number; dist: number }
  | { type: 'light-changed'; az: number; el: number; intensity: number }
  | { type: 'stroke-finished'; strokes: number }
  | { type: 'artwork-saved'; id: string }
  | { type: 'error'; err: Error };

class EventBus {
  on(type: string, cb: (e: Event) => void): void;
  off(type: string, cb: (e: Event) => void): void;
  emit(e: Event): void;
}
```

---

## 3. 关键算法

### 3.1 视觉中心（已验证）

```js
function computeVisualCenter(geometry) {
  // 顶部 50% + 前方 50% 加权重心
  const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
  const topY = box.min.y + (box.max.y - box.min.y) * 0.5;
  const frontZ = box.max.z - (box.max.z - box.min.z) * 0.5;
  const positions = geometry.attributes.position.array;

  let sumX = 0, sumY = 0, sumZ = 0, count = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i+1], z = positions[i+2];
    // 权重：越靠顶、越靠前权重越大
    const wTop = (y - box.min.y) / (box.max.y - box.min.y);
    const wFront = (box.max.z - z) / (box.max.z - box.min.z);
    const w = wTop * wFront;
    sumX += x * w; sumY += y * w; sumZ += z * w;
    count += w;
  }
  return new THREE.Vector3(sumX/count, sumY/count, sumZ/count);
}
```

> 这是 commit `5c91d38` 验证过的算法。在半身像上，视觉中心落在头部，比纯几何中心（胸口）好。

### 3.2 压感曲线

```js
function pressureToWidth(p: number, baseWidth: number): number {
  // p ∈ [0, 1]
  // 曲线：p=0.1 → 0.3x, p=0.5 → 0.7x, p=1.0 → 1.0x
  // 模拟真实铅笔：轻按细、重按粗
  const eased = Math.pow(p, 0.6);
  return baseWidth * (0.3 + eased * 0.7);
}
```

### 3.3 NDC 偏移（已验证）

```js
function applyTargetOffset(camera, offsetX, offsetY) {
  // offsetX/Y ∈ [-1, 1]，1.0 = 可见区域 14%
  const distance = camera.position.length();
  const fov = camera.fov * Math.PI / 180;
  const visibleHeight = 2 * Math.tan(fov / 2) * distance;
  const visibleWidth = visibleHeight * camera.aspect;

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
  const offset = right.multiplyScalar(offsetX * visibleWidth * 0.14)
    .add(up.multiplyScalar(offsetY * visibleHeight * 0.14));
  camera.target.add(offset);
}
```

> commit `04bc483` 验证过——折叠侧栏后模型不跑偏。

### 3.4 fit-to-view

```js
function fitDistanceToModel(boxSize, fovDeg, aspect) {
  const distV = (boxSize.y / 2) / Math.tan((fovDeg / 2) * Math.PI / 180);
  const distH = (boxSize.x / 2) / (Math.tan((fovDeg / 2) * Math.PI / 180) * aspect);
  return Math.max(distV, distH) * 1.2;  // 1.2 = 留 20% 余量
}
```

---

## 4. 任务拆分（WBS）

### Phase A：关键验证（2 周）

| 任务 ID | 名称 | 工时 | 验收 |
|---|---|---|---|
| A-01 | Apple Pencil 压感 + iPad Safari demo | 2d | 在 iPad 上画 10 条线，压感可见 |
| A-02 | Android Chrome + S Pen demo | 2d | 同上 |
| A-03 | PWA 离线启动（manifest + SW） | 1d | Lighthouse PWA ≥ 90 |
| A-04 | IndexedDB 缓存 50 MB 模型 | 1d | 反复开关 App 不重新下载 |
| A-05 | meshify.py 跑 5 个头部模型 | 1d | 5 个 GLB 文件可用 |
| A-06 | 撤销/重做 200 步不卡顿 | 2d | 帧率 ≥ 30 |

### Phase B：MVP 主体开发（6 周）

#### Week 1-2：基础与画板
| B-01 | 拆模块（index.html → ui/scene/sketch 逻辑分区） | 2d | 单文件内代码组织清晰 |
| B-02 | F-006 画板 Canvas + Pointer 桥 | 3d | 能画、压感可见 |
| B-03 | F-006 撤销/重做栈 | 2d | 50 步流畅 |
| B-04 | F-006 颜色/线宽/橡皮 | 1d | 工具栏 UI |
| B-05 | F-007 同框对比 UI | 2d | 开关 + 透明度 |

#### Week 3：模型库 + 数据
| B-06 | meshify.py 跑 30 个模型（后台批量） | 2d | 30 个 GLB |
| B-07 | ModelRepo（IndexedDB + fetch） | 2d | 二次访问零延迟 |
| B-08 | F-001 模型库 UI（分类/搜索） | 2d | 可点击切换 |

#### Week 4：PWA + 离线
| B-09 | manifest.webmanifest | 0.5d | |
| B-10 | Service Worker 预缓存 shell | 1d | 离线可启动 |
| B-11 | 模型按需缓存到 IDB | 1d | |
| B-12 | F-010 离线模式提示 | 1d | UI 友好 |
| B-13 | F-004 加 4 套经典布光预设 | 1d | |

#### Week 5：打磨 + 跨设备
| B-14 | 触屏 + Apple Pencil 完整适配 | 2d | iPad 全功能 |
| B-15 | Android 平板适配 | 2d | 小米平板 5 测过 |
| B-16 | 桌面浏览器（Chrome/Safari/FF） | 1d | |

#### Week 6：性能 + 收尾
| B-17 | 性能 profiling + 调优 | 2d | iPad Air ≥ 30 FPS |
| B-18 | 可访问性（快捷键、键盘导航） | 1d | |
| B-19 | 国际化文案（中/英） | 1d | |
| B-20 | README + 部署文档 | 1d | |

### Phase C：缓冲 + Bug bash（1 周）
| C-01 | Bug bash 5 天 | 5d | 0 P0/P1 bug |

### Phase D：内测 + 上架（1 周）
| D-01 | TestFlight / 内测 5 人 | 3d | 反馈汇总 |
| D-02 | 修复内测 P0 | 2d | |
| D-03 | 商店截图 / 文案 | 2d | |

**总周期：2 + 6 + 1 + 1 = 10 周**

---

## 5. 验收定义（DoD）

每个任务完成必须满足：
1. 代码可运行、无 console 报错；
2. 在 iPad Air + Chrome 最新版测试通过；
3. 关键路径有手动测试记录（截图 + 操作步骤）；
4. 提交到 git，有清晰 commit message。

每个 Phase 完成必须满足：
- 对应 [06-verification-plan.md](./06-verification-plan.md) 的验收清单全过。

---

## 6. 依赖项

### 6.1 第三方库（CDN）

| 库 | 版本 | 用途 | 包体 |
|---|---|---|---|
| three | r160+ | 3D 渲染 | 600 KB gz |
| （无） | — | 画板用原生 Canvas | — |
| （无） | — | 数据用原生 IndexedDB | — |

> **故意不引** 的库：React（不必要）、Vue（同）、Tailwind（手写 CSS 更可控）、axios（fetch 够用）、Lodash（用 ES2020 原生方法）。

### 6.2 外部服务

| 服务 | 用途 | 何时用 |
|---|---|---|
| Meshy.ai | 生成头部 GLB | 开发期，开发者手动跑脚本 |
| Cloudflare Pages | 静态托管 | v1.0 |
| Cloudflare R2 | 模型 GLB 存储 | v1.0 |

---

## 7. 风险缓冲

| 风险 | 触发条件 | 应急方案 |
|---|---|---|
| Apple Pencil 压感不可用 | A-01 失败 | v1.0 砍压感，只做触控笔画 |
| 模型生成成本超预算 | Meshy 单价 > $2 | 砍到 15 个模型，10 个用 CC0 免费资源补 |
| PWA 在 iOS 行为异常 | Lighthouse < 80 | v1.0 退回"在线 App"，离线推迟 |
| Phase B 延期 > 1 周 | — | 砍 F-007 同框对比，v1.0.1 再补 |

