# Agent Note: Client bundle 重建可能使用陈旧的 tsc 产物

状态：已实现

[English](2026-08-22-client-bundle-stale-tsc-entry.md) | 中文

## 问题

QZH 开发过程中重建 client bundle 曾静默回退已发布的功能。完整 client-face 构建（`npm run build:lib:client` = `tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client`）在 tsdown 阶段编译通过，但浏览器加载的 bundle 丢失了服务端/终端上传分区、报告反馈控件和 `setFeedback` 远程调用。反馈按钮随后在运行时静默失败，报 `setFeedback is not a function`，因为打包进 `@deepseek-ai/dsh-api-remotes` 的远程方法表早于该方法。

## 决策

当 tsdown 不带 `DSH_BUILD_FACE` 运行时，client 插件 bundle 从 `src/client/index.ts` 编译——每个包的 `bundle` 脚本、包内裸 `tsdown` 以及 `pnpm run dev:web` 的 watcher 都走源码路径。在 `tsdown --env.DSH_BUILD_FACE client` 下，入口切换到 `lib/types/client/index.js`，即 client-face 的 `tsc` 产物（`packages/client/tsdown.client.ts`）。该产物只与最近一次成功的 client 聚合编译一样新。当聚合编译报错时（观察到 `ui-conversation`/`runtime` 及同类包中既有的 `SessionStore` 契约错误），client-face 的 tsdown 会静默地用陈旧产物重建每个 bundle 并回退最近的 client 改动——没有报错、没有警告。

安全的 client 迭代循环是逐个包执行 `pnpm --filter @deepseek-ai/dsh-client-<pkg> bundle`（源码入口）或 `pnpm run dev:web`（源码 watcher + 服务器 `client-hmr` 的 stat-poll 无重启热更新页面）。完整的 client face 只在聚合类型检查通过时运行。该流程记录在 `packages/client/AGENTS.md` 的 "Rebuilding client bundles" 一节。

## 备选方案

- **先归因聚合编译失败并修复 `tsc -b`** —— 本次改动拒绝：`SessionStore` 契约漂移是独立的既有缺陷，有自己的修复窗口；它不能阻塞按功能重建 bundle。
- **让 client face 在陈旧产物时回退到源码** —— 推迟：修改 `packages/client/tsdown.client.ts` 的入口语义是独立的构建工具改动，需要单独评审；流程 note 记录正确的调用方式即可。

## 后果

client 迭代不再静默回退功能：源码入口是逐包重建和 dev watcher 的默认入口，服务端 bundle 可用内容哈希对照本地 `lib/client.js` 验证。陈旧产物陷阱在聚合 `tsc` 修复前仍然存在；在此之前任何运行裸 client face 的人都必须随后重新运行逐包源码构建。
