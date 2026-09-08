# 数据与多用户策略 · v1.0

> 版本：v1.0
> 日期：2026-09-08
> 修订：[07-prd.md §8](./07-prd.md)、[05-spec.md §1](./05-spec.md)
>
> 本文档由 PRD §8 + 用户提问"是否保存每个用户偏好 / 是否有专属数据库"扩展而来。
> 一次性把**所有数据相关的痛点**列清 + 给方案。

---

## 0. 痛点全景（11 类，全部要解决）

| # | 痛点 | 真实场景 | 严重度 |
|---|---|---|---|
| 1 | **设备共享无隔离** | 集训宿舍 iPad 共用，A 调的视角被 B 改 | 高 |
| 2 | **设置不持久化** | 刷新页面，所有偏好归零（当前代码 bug） | 高 |
| 3 | **模型缓存无隔离** | 共用设备时，模型被另一人下载占空间 | 中 |
| 4 | **作品无隔离** | A 的画出现在 B 的历史里 | 高（隐私） |
| 5 | **数据丢失风险** | 浏览器数据被清 → 全部丢失 | 高 |
| 6 | **跨设备不跟随** | 在家和在学校两台 iPad，不能同步 | 中（v1.1 解） |
| 7 | **iOS Safari 偷偷清数据** | 7 天不用可能清掉 IndexedDB | 中 |
| 8 | **配额耗尽无感知** | 模型下载太多，IndexedDB 满了不报错 | 中 |
| 9 | **无法导出 / 备份** | 用户作品只锁在 App 里 | 中 |
| 10 | **Schema 演进** | 数据结构改了，旧用户加载崩溃 | 低（一次性） |
| 11 | **合规与隐私** | 个保法要求"删除权 / 数据可导出" | 中（法律） |

---

## 1. 总体策略

### 1.1 一句话

> **v1.0 在每台设备上维护一个"匿名多用户"系统，所有数据按用户隔离、持久化、可导出。v1.1 加云端账号同步。**

### 1.2 三条铁律

1. **每个用户的数据完全隔离**：设置、模型缓存、作品
2. **数据可导出**：用户随时可以把"自己的全部数据"下载成一个 zip
3. **删除权**：用户可以彻底删掉自己的账号，连带删 IndexedDB 数据库

### 1.3 版本演进

| 版本 | 范围 |
|---|---|
| **v1.0** | 设备本地、匿名多用户、可导出 |
| v1.1 | 加手机号/微信登录、云端同步 |
| v1.2 | 跨设备实时同步（settings）+ 作品云备份 |

---

## 2. 用户模型

### 2.1 概念

| 概念 | 定义 |
|---|---|
| **设备（Device）** | 一台物理设备（iPad / Android / 电脑），对应一个浏览器 |
| **用户（User）** | 设备上的一个身份，无真实姓名（v1.0） |
| **当前用户（Current User）** | 当前登录的那个 |
| **设备主人（Owner）** | 第一个创建的用户，拥有删除其他用户的权限 |

### 2.2 数据结构

```ts
// 用户身份
interface User {
  id: string;            // UUID v4
  displayName: string;   // "张三" / "我" / 默认 "用户1"
  avatarColor: string;   // 头像背景色（自动生成）
  avatarIcon: string;    // emoji 或首字
  isOwner: boolean;      // 是否设备主人
  createdAt: number;     // unix ms
  lastActiveAt: number;
  schemaVersion: number; // 数据迁移用
}
```

**存储位置**：`localStorage["sketch.users"]` → `User[]`

```ts
// 当前用户 ID
localStorage["sketch.currentUserId"] = "uuid-string"

// 首次启动时
// 1. 生成新用户
// 2. 设为 owner
// 3. 设为 currentUserId
```

---

## 3. 存储分层

### 3.1 localStorage（轻量配置）

| Key | 内容 | 大小限制 |
|---|---|---|
| `sketch.users` | `User[]` | < 10 KB |
| `sketch.currentUserId` | string | < 100 B |
| `sketch.userPrefs.{userId}` | `UserPrefs` JSON | < 5 KB |
| `sketch.ui.{userId}.lastView` | 视角快照 `{az,el,dist}` | < 100 B |
| `sketch.schemaVersion` | number | < 10 B |

### 3.2 IndexedDB（大数据，按用户分库）

```
sketch-ref-v1--{userId}
├── models          // 模型 GLB Blob
├── artworks        // 截图 PNG Blob
├── sketchMeta      // 用户的画板快照（v1.1+）
└── meta            // 用户的其他元数据
```

**关键决策**：**每个用户一个独立数据库**（不是一个大库多 store）。

理由：
- 删一个用户 = 直接删一个数据库（一行代码）
- iOS 配额管理可以按库粒度
- 不会因为一个大库内 store 太多触发性能问题

### 3.3 数据隔离表

| 数据 | 是否按用户隔离 | 存储位置 |
|---|---|---|
| 偏好设置（光源/视角/画板参数） | ✅ | `localStorage.sketch.userPrefs.{userId}` |
| 模型 GLB 缓存 | ✅ | `IndexedDB.sketch-ref-v1--{userId}.models` |
| 用户作品（PNG） | ✅ | `IndexedDB.sketch-ref-v1--{userId}.artworks` |
| 用户信息（姓名/头像） | ✅ | `localStorage.sketch.users` |
| 应用全局配置（主题版本） | ❌ | `localStorage.sketch.global` |

---

## 4. 详细数据模型

### 4.1 UserPrefs（用户偏好）

```ts
interface UserPrefs {
  schemaVersion: 1;
  updatedAt: number;

  // 视角
  view: {
    sensitivity: number;     // 0-1
    range: number;           // 0-1
    damping: number;         // 0-1
    tracerEnabled: boolean;
  };

  // 光源
  light: {
    az: number;              // 0-360
    el: number;              // -90 ~ +90
    intensity: number;       // 0-2
    ambient: number;         // 0-1
    shadowSoftness: number;  // 0-1
  };

  // 画板
  sketch: {
    color: string;           // '#000000'
    lineWidth: number;       // 1-50
    opacity: number;         // 0-1
    pressureEnabled: boolean;
  };

  // 显示
  display: {
    showGround: boolean;
    showWireframe: boolean;
    showReticle: boolean;
    showCompare: boolean;
    backgroundColor: string;
  };

  // 模型
  model: {
    defaultModelId: string;
    customGlbList: string[]; // 用户导入的 GLB 名
  };
}
```

### 4.2 Artwork（作品）

```ts
interface Artwork {
  id: string;                // uuid
  userId: string;            // 冗余（虽然 DB 已隔离）
  modelId: string;
  createdAt: number;
  durationMs: number;
  pngBlob: Blob;
  canvasSize: { w: number; h: number };
  view: { az: number; el: number; dist: number };
  light: { az: number; el: number; intensity: number };
  strokeCount: number;
}
```

### 4.3 CachedModel（模型缓存）

```ts
interface CachedModel {
  id: string;
  userId: string;
  name: string;
  glbBlob: Blob;
  sizeBytes: number;
  triangleCount: number;
  cachedAt: number;
  lastAccessedAt: number;
}
```

---

## 5. 接口契约（API）

```ts
// 用户管理
class UserManager {
  list(): User[];
  getCurrent(): User;
  setCurrent(id: string): Promise<void>;
  create(displayName?: string): Promise<User>;
  rename(id: string, newName: string): Promise<void>;
  delete(id: string): Promise<void>;  // 删用户+删库+删prefs
  getQuotaUsage(): Promise<{ used: number; quota: number }>;
}

// 偏好
class PrefsStore {
  load(userId: string): Promise<UserPrefs>;
  save(userId: string, prefs: UserPrefs): Promise<void>;
  reset(userId: string): Promise<void>;  // 恢复默认
  export(userId: string): Promise<Blob>; // 导出 JSON
  import(userId: string, blob: Blob): Promise<void>;
}

// 模型缓存
class ModelCache {
  get(userId: string, modelId: string): Promise<Blob | null>;
  put(userId: string, modelId: string, blob: Blob, meta: object): Promise<void>;
  list(userId: string): Promise<CachedModel[]>;
  delete(userId: string, modelId: string): Promise<void>;
  clear(userId: string): Promise<void>;  // 清空该用户所有模型
  getUsage(userId: string): Promise<number>; // bytes
}

// 作品
class ArtworkStore {
  save(userId: string, artwork: Artwork): Promise<string>;
  list(userId: string): Promise<Artwork[]>;
  get(userId: string, id: string): Promise<Artwork | null>;
  delete(userId: string, id: string): Promise<void>;
}
```

---

## 6. 配额管理（解决痛点 #8）

### 6.1 配额预算

| 平台 | 配额上限（实际可用） | 我们的预算 |
|---|---|---|
| iOS Safari | ~500 MB - 1 GB | 单用户 ≤ 200 MB |
| Android Chrome | ~60 MB - 6 GB（取决于设备） | 单用户 ≤ 200 MB |
| Desktop Chrome | ~60% 磁盘 | 单用户 ≤ 500 MB |

### 6.2 配额监控

```js
// 估算（iOS Safari 没有 navigator.storage.estimate 的可靠支持）
async function getQuotaUsage(userId) {
  if (navigator.storage && navigator.storage.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    return { used: usage, quota };
  }
  // 降级：手动 sum
  return { used: -1, quota: -1 };  // 未知
}
```

### 6.3 配额 UI（用户菜单里）

```
┌──────────────────────────────┐
│ 存储空间                       │
│ 已用 156 MB / 200 MB          │
│ ████████████████░░░░  78%    │
│ [清理模型缓存] [导出我的数据]   │
└──────────────────────────────┘
```

### 6.4 配额满处理

| 情况 | 处理 |
|---|---|
| 写入前预估会超 | 弹"空间不足，请清理或导出"对话框 |
| 写入时报 QuotaExceededError | toast"存储已满"+ 自动跳转到"清理缓存"页 |
| iOS 7 天未访问 | 文案提示"建议定期导出作品到相册" |

---

## 7. 备份与恢复（解决痛点 #5、#6、#9）

### 7.1 导出（v1.0 必须）

```
用户菜单 → "导出我的全部数据"
  ↓
打包成 zip：
  ├── user.json              # User + UserPrefs
  ├── models/{modelId}.glb   # 该用户所有模型
  ├── artworks/{id}.png      # 该用户所有作品
  └── README.txt             # 导入说明
  ↓
触发浏览器下载：sketch-export-{userName}-{date}.zip
```

### 7.2 导入（v1.0）

```
用户菜单 → "导入数据"
  ↓
选择 .zip 文件
  ↓
校验 + 解压 + 写入 IndexedDB
  ↓
提示"导入成功 N 个模型，M 个作品"
```

### 7.3 云同步（v1.1+）

v1.1 计划：
- 用户用手机号/微信登录 → 生成云端 userId
- 本地 userId 与云端绑定
- 后端用 Supabase：
  - `users` 表（id, phone, display_name, created_at）
  - `prefs` 表（user_id, prefs_json, updated_at）
  - `artworks` 表（id, user_id, model_id, png_url, created_at）
  - Storage bucket：模型 GLB + 作品 PNG

---

## 8. Schema 版本管理（解决痛点 #10）

### 8.1 版本字段

每个持久化对象都带 `schemaVersion: number`。

### 8.2 迁移策略

```js
const MIGRATIONS = {
  // 从 v0 到 v1：把 view.sensitivity 从 0-100 改成 0-1
  '0->1': (oldData) => {
    return {
      ...oldData,
      schemaVersion: 1,
      view: {
        ...oldData.view,
        sensitivity: oldData.view.sensitivity / 100,
      },
    };
  },
};

function migrate(data) {
  let v = data.schemaVersion || 0;
  while (v < CURRENT_VERSION) {
    const key = `${v}->${v + 1}`;
    if (MIGRATIONS[key]) data = MIGRATIONS[key](data);
    v++;
  }
  data.schemaVersion = CURRENT_VERSION;
  return data;
}
```

加载任何持久化数据时都跑 `migrate()`。

---

## 9. UX 设计（解决痛点 #1、#2、#3、#4）

### 9.1 首次启动流程

```
App 启动
  ↓
localStorage 有 sketch.users 吗？
  ├─ 无 ──→ 创建默认用户"用户1"（设备主人）
  │        ↓
  │        显示欢迎气泡："欢迎！点击这里重命名 / 添加更多用户"
  │
  └─ 有 ──→ 读取 currentUserId
             ├─ 有效 ──→ 直接进入主界面
             └─ 无效 ──→ 显示用户选择器
```

### 9.2 用户选择器（冷启动 / 切换时）

```
┌──────────────────────────────────────────────────┐
│                                                  │
│             选择你的身份                          │
│             ────────────                          │
│                                                  │
│    ┌────┐  张三                最后活跃 2h 前     │
│    │ 张 │  [选择]                                    │
│    └────┘                                         │
│                                                  │
│    ┌────┐  李四                最后活跃 昨天       │
│    │ 李 │  [选择]                                    │
│    └────┘                                         │
│                                                  │
│    ┌────┐                                         │
│    │ +  │  新建用户                                 │
│    └────┘                                         │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 9.3 用户菜单（顶栏头像点击）

```
┌──────────────────────────┐
│ ┌──┐ 张三                  │
│ │张 │ [重命名]              │
│ └──┘ 102 MB · 设备主人     │
├──────────────────────────┤
│ 切换用户                    │
│  张三（当前）                │
│  李四                       │
│  + 新建用户                 │
├──────────────────────────┤
│ 数据管理                    │
│  📊 存储空间                │
│  📤 导出我的数据             │
│  📥 导入数据                │
│  🗑  删除此用户             │
└──────────────────────────┘
```

### 9.4 切换用户流程

```
点击"李四"
  ↓
toast"正在切换到 李四..."
  ↓
保存当前用户未保存的修改（如果有）
  ↓
更新 currentUserId + 加载李四的 Prefs
  ↓
3D 视图：保留当前视角？还是恢复默认？
  ├─ 默认：恢复 → 跳动画 400ms
  └─ 可选：保留（更符合"快切"）
  ↓
画板：清空（每个用户自己的画）
  ↓
toast"已切换到 李四 ✓"
```

### 9.5 删除用户流程

```
点击"删除此用户"
  ↓
确认对话框：
  ┌─────────────────────────────────┐
  │ 确认删除"李四"？                  │
  │                                  │
  │ 这将永久删除：                    │
  │   • 你的所有偏好设置              │
  │   • 已下载的 X 个模型             │
  │   • 保存的 Y 个作品               │
  │                                  │
  │ 此操作不可撤销。                  │
  │                                  │
  │  □ 我已导出我的数据               │
  │                                  │
  │           [取消]  [确认删除]       │
  └─────────────────────────────────┘
  ↓
确认后：
  1. 导出提醒（如果勾了框，跳过）
  2. 删除 localStorage.userPrefs.{userId}
  3. 删除 IndexedDB.sketch-ref-v1--{userId}（直接 indexedDB.deleteDatabase）
  4. 从 sketch.users 移除
  5. 如果删的是 owner，禁止；提示"先把其他人设为设备主人"
```

---

## 10. 边界与降级（解决痛点 #7、#8）

### 10.1 localStorage 被禁用

| 情况 | 表现 | 处理 |
|---|---|---|
| 隐私模式 | localStorage 写入会抛错 | 弹窗"请退出隐私模式使用本 App" |
| Safari 跨站拦截 | 第三方 iframe 内不可用 | 我们是顶层 PWA，不受影响 |
| 配额满 | setItem 抛 QuotaExceededError | 极少（< 5 KB），真满了提示清理 |

### 10.2 IndexedDB 配额满

```js
try {
  await idb.put(record);
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    showDialog({
      title: '存储空间已满',
      body: '请删除一些不用的模型缓存，或导出你的作品后清理。',
      actions: [
        { label: '清理模型缓存', action: clearOldModels },
        { label: '导出我的数据', action: exportUserData },
      ],
    });
  }
}
```

### 10.3 iOS Safari 数据被清

- **现象**：用户 7 天没打开 App，iOS 可能清掉 IDB 数据；
- **预防**：
  - 启动时检查 IndexedDB 是否可用，不可用则提示重新下载；
  - 重要操作（导出 PNG）走 `<a download>` 而不只是缓存；
  - 文案："建议每周打开 App 一次，或定期导出作品到相册"；
- **不能彻底解决**：这是 iOS 的策略，我们只能教育用户。

### 10.4 切换用户时未保存数据

- 当前用户画板上有未导出的画 → 切用户前弹"你的画还没保存，导出吗？"；
- 这是当前用户最痛的需求，所以切换流程必须显眼。

---

## 11. 隐私与合规（解决痛点 #11）

### 11.1 中国《个人信息保护法》合规

| 要求 | 我们的做法 |
|---|---|
| 知情同意 | 首次启动展示简明隐私说明 |
| 最小必要 | v1.0 不收集任何个人信息 |
| 删除权 | 提供"删除此用户"功能 |
| 数据可携 | 提供"导出我的数据"功能 |
| 单独同意 | 上传云端前单独弹窗确认（v1.1） |

### 11.2 数据归属

- v1.0：所有数据归用户所有，存在用户设备上；
- v1.1：上传云端后，数据归用户所有，服务商只有"按用户指令存储"的义务；
- 隐私政策要在 App 内可访问（在"关于"页）。

### 11.3 不收集

- 不收集设备 ID（除了用户自己生成的 UUID）
- 不收集 IP（v1.0 全前端）
- 不收集使用行为
- 不接入任何分析 SDK

---

## 12. 实施清单（开发任务拆分）

### Phase A：基础（与现有 SPEC 并行）

| ID | 任务 | 工时 |
|---|---|---|
| A-07 | `UserManager` 模块（含 localStorage 包装） | 1 天 |
| A-08 | `PrefsStore` 模块（含 schema migration） | 1 天 |
| A-09 | `ModelCache` 模块（按用户 IDB） | 1.5 天 |
| A-10 | `ArtworkStore` 模块 | 0.5 天 |

### Phase B：UI

| ID | 任务 | 工时 |
|---|---|---|
| B-21 | 用户选择器（首次启动 + 冷启动） | 1.5 天 |
| B-22 | 用户菜单（顶栏头像） | 1 天 |
| B-23 | 切换用户流程（含未保存提示） | 1 天 |
| B-24 | 删除用户确认对话框 | 0.5 天 |
| B-25 | 配额显示 + 清理缓存 UI | 1 天 |

### Phase C：备份

| ID | 任务 | 工时 |
|---|---|---|
| C-02 | 导出 zip（用 JSZip CDN） | 1.5 天 |
| C-03 | 导入 zip | 1 天 |
| C-04 | 数据迁移测试 | 1 天 |

### 合计

> **7 + 4 + 3 = 14 个新任务，约 14 个工作日（2.8 周）**

**对原 10 周计划的影响**：在 Phase A 验证阶段插入 2 周"数据基础"工作，把总周期从 10 周 → **12-13 周**。

---

## 13. 风险与对策（针对数据）

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| iOS Safari 清掉 IDB 后用户丢作品 | 中 | 高 | 教育用户定期导出；Phase C 强制每周提醒 |
| 切换用户时数据竞争 | 低 | 中 | 用 IDB 事务保证原子性 |
| 配额满没正确处理 | 中 | 中 | 严格测试边界 |
| Schema 迁移写错 | 低 | 高 | 写迁移前后双写的过渡期（v1 写完同时读 v0 兜底） |
| 多 tab 同时打开 App 数据不一致 | 中 | 中 | 用 BroadcastChannel 同步 currentUserId |

---

## 14. 一句话总结

> **v1.0 做"设备本地的匿名多用户 + 可导出 + 可删除"，v1.1 加账号和云同步。这样艺考生共享 iPad 不会互相干扰，自己画的作品也不会丢。**
