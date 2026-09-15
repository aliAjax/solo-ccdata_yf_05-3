# DepAudit · 传递依赖关系审计台

把单层依赖清单升级为**传递依赖关系审计台**：从 lockfile 构建 name@version 包节点图，
记录普通/开发/可选三类依赖边，检测重复边、自引用、环路、缺失父节点/缺失目标，
把每个根包的传递路径展开到叶子，对路径上的许可证义务做 AND/OR 汇总并给出冲突来源链；
支持按根包/深度/义务类型筛选、锁定路径单独复核，全部状态刷新后恢复。

## 架构

```
src/
  lib/
    graph.ts     图引擎：lockfile v3 解析（含嵌套 node_modules 解析）、三类边、
                 Tarjan 强连通环检测、重复/自引用/缺失父/缺失目标、根→叶路径展开、
                 共享节点占位截断（子路径不重复计数）
    license.ts   SPDX AND/OR/WITH 表达式解析与 DNF 选证、许可证义务目录、
                 闭源/开源分发策略下的义务聚合与冲突溯源（来源链）
    store.tsx    状态层：数据集/筛选/展开/选中/锁定复核持久化；
                 分析结果只由「数据集 + 筛选」纯函数推导，展开折叠不影响任何统计
    ui.ts        标签与配色
  components/    Sidebar / FilterBar / StatsHeader / PathTree /
                 IssuesPanel / ObligationsPanel / NodeDetail / ReviewDrawer
  data/datasets.json  两个数据集（由脚本从真实数据生成）
scripts/
  generateData.mjs  抓取 npm registry 元数据，生成真实生态示例数据集
  validate.mjs      引擎层真实数据断言（53 项）
  e2e.mjs           Playwright 端到端断言（46 项）
```

## 数据集

- **当前工作区锁文件**：本项目真实 `package-lock.json`（vite/rolldown 工具链，69 个包，
  含 MIT / Apache-2.0 / MPL-2.0 / ISC / BSD-3-Clause 与平台 optional 二进制）。
- **真实生态示例**：版本、许可证、依赖范围全部取自 npm registry 真实发布记录，覆盖
  - 环路：真实存在的 `es6-weak-map → es6-iterator → es6-symbol → es5-ext → d` 循环簇；
  - 多版本：`debug@2.6.9/4.3.4`、`ms@2.0.0/2.1.3`（嵌套 node_modules）、`type@1/2`、`statuses@1.4/1.5`；
  - 深路径：`rimraf → glob → minimatch → brace-expansion → balanced-match/concat-map`（深度 4）；
  - 共享节点：`debug@4`、`readable-stream`、`inherits`、`wrappy` 被多簇共享，二次出现只渲染占位；
  - OR/AND 许可证：JSONStream `(MIT OR Apache-2.0)`、rc 三选一、jszip `(MIT OR GPL-3.0-or-later)`、
    pako `(MIT AND Zlib)`；ffmpeg-static `GPL-3.0-or-later` 闭源硬冲突；parse-cache-control 无 license；
  - 异常：真实平台 optional 包缺失、真实 devDependencies 未安装，外加两处 `auditInject`
    显式演示自引用与完全重复边（真实脏数据形态）。

## 开发

```bash
npm run dev        # 本地开发
npm run build      # tsc -b && vite build
npm run validate   # 引擎层真实数据断言
npm run e2e        # 一键端到端（先构建，再自动准备浏览器环境、启动预览并验证）
```

端到端命令自包含：

- `playwright`/`esbuild` 已在 devDependencies，`npm install` 后即可用；
- 浏览器缺失时自动执行 `npx playwright install chromium`；
- 干净容器缺少 Chromium 系统库（libnss3/libgtk 等）且没有 root 时，
  `scripts/e2e-env.mjs` 会用 `apt-get`（空 dpkg status + 临时缓存，不写系统目录）
  下载完整运行库闭包并解包到 `node_modules/.cache/pw-env/sysroot`，再以 `LD_LIBRARY_PATH`
  启动；顺带解包 Noto CJK 字体供截图。该缓存下次运行直接复用，也可用 `E2E_PORT` 指定端口。

## 关键语义

- **不重复计数**：唯一包集合只统计首次展开；共享节点再次相遇渲染为「共享占位」并截断子路径，
  因此义务/冲突汇总不会把同一包重复计入。
- **AND / OR**：路径上各包义务 AND 叠加；同一包的 OR 表达式展开为多个选证组合，
  仅在所有组合下都出现的义务记为「必然」，否则记「视选证而定」；OR 中存在宽松选项时冲突标记为「可规避」。
- **冲突溯源**：每个冲突给出冲突节点与完整来源链（项目根 → … → 节点），链上节点可点击定位。
- **展开折叠是纯 UI**：树的可见性不参与右侧义务/冲突/统计计算，刷新或折叠结果不变。
