# 文档总览 · 美术艺考生临摹 App

> 这是产品的全流程文档。**严格按"产品流程"和"工程流程"两条主线推进**。
> 每一份文档都对应当前你提的 6 步流程中的某一步。

## 文档清单

| # | 文件 | 对应流程步骤 | 字数 | 状态 |
|---|---|---|---|---|
| 01 | [requirements-analysis](./01-requirements-analysis.md) | 需求分析 | ~200 行 | ✅ 初稿 |
| 02 | [feasibility-analysis](./02-feasibility-analysis.md) | **1. 技术可行性分析** | ~280 行 | ✅ 初稿 |
| 03 | [architecture-analysis](./03-architecture-analysis.md) | **3. AI 架构分析** | ~250 行 | ✅ 初稿 |
| 04 | [mvp-feature-list](./04-mvp-feature-list.md) | **2. MVP 功能清单** | ~180 行 | ✅ 初稿 |
| 05 | [spec](./05-spec.md) | **5. SPEC + 任务拆分 + 迭代计划** | ~330 行 | ✅ 初稿 |
| 06 | [verification-plan](./06-verification-plan.md) | **6. 验证计划** | ~250 行 | ✅ 初稿 |

## 阅读顺序

```
01 需求分析           ← 一切起点
        ↓
02 技术可行性分析      ← 工程判断（能不能做、有什么风险）
        ↓
03 架构分析           ← 工程设计（怎么拆、选什么栈）
        ↓
04 MVP 功能清单       ← 产品范围（做什么、不做什么）
        ↓
05 SPEC              ← 详细技术规格 + WBS + 10 周迭代计划
        ↓
06 验证计划           ← 怎么知道做对了
```

## 与你 6 步流程的对应

| 你的步骤 | 对应文档 | 现状 |
|---|---|---|
| 1. 技术可行性分析 | 02-feasibility-analysis.md | ✅ 已生成 |
| 2. 摘 MVP 功能，用代码验证关键技术 | 04-mvp-feature-list.md + 当前 `index.html` 原型 | ✅ 文档化 + 已跑通 3D 部分；**画板待验证** |
| 3. 用 AI 做架构分析 | 03-architecture-analysis.md | ✅ 已生成 |
| 4. 最简单代码跑技术难点 | `index.html` + `scripts/meshify.py` | ✅ 已跑通 |
| 5. SPEC，逐步实现功能 | 05-spec.md（含 10 周 WBS） | ✅ 已生成 |
| 6. 逐步验证 | 06-verification-plan.md | ✅ 已生成 |

## 下一步建议

按 [05-spec.md](./05-spec.md) §4 Phase A 执行：

| 任务 | 预计 | 谁 |
|---|---|---|
| **A-01** Apple Pencil 压感 demo | 2 天 | 你 + 我 |
| **A-02** S Pen demo | 2 天 | 你 + 我 |
| **A-03** PWA manifest + SW | 1 天 | 我 |
| **A-04** IndexedDB 50 MB 模型 | 1 天 | 我 |
| **A-05** 跑 meshify.py 生成 5 个 GLB | 1 天 | 你（需要 Meshy API Key） |
| **A-06** 撤销 200 步不卡顿 | 2 天 | 我 |

跑完 Phase A 后，进 Phase B 周 1-2（画板 + 同框对比）开发。

