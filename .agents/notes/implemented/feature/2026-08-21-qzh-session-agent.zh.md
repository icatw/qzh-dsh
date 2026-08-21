# Agent Note: QZH 会话 Agent 集成

Status: implemented

[English](2026-08-21-qzh-session-agent.md) | 中文

## 问题

QZH 日志分析需要复用 DSH 会话和工作区模型，不能暴露普通写入能力，也不能创建第二个分析会话。原实现把证据工作台放在 composer dock；空白 Hero 卸载后分析状态会停留在旧快照；通用导入路径还会统一显示为 `unknown`。

## 决定

QZH 是内置 `qzh` Agent preset，而不是根级导航模式。浏览器通过 `conversation.hero.empty` 提供空白态导入 Hero，通过 `conversation.details.qzh` 提供右侧证据面板，并通过 `conversation.session.header.actions` 提供紧凑状态操作；这些入口共享一个持久化 JSON-safe store，只有会话摘要记录 `agentPreset: qzh` 时才渲染。分析进行中时右栏持续轮询 Host 案例，并显示最终报告或失败状态。

壳层在展开后的左侧边栏提供工作台切换，默认进入 QZH。QZH 与普通 DSH 会话分别过滤展示，新建会话继承当前工作台的 preset（`qzh` 或 `standard`）。切换工作台时优先复用已有的匹配会话；没有匹配会话时清空当前选择，但不会混排两类会话。

Host 案例 API 明确按 `sessionId + caseId` 绑定。每次读取、证据更新、代码查询和分析启动都会检查案例归属。分析使用已挂载在 `sessionId` 上的 live Agent，向当前 transcript 追加 follow-up，因此报告仍是当前会话中的普通 assistant 消息。

提交后的会话继续留在原 workspace；没有用户自定义标题时命名为 `QZH 日志分析`。通用压缩包路径按父目录或文件名推断组件标签。QZH 会话在 `/model` 命令和 composer slot 中隐藏模型选择器；Host 也拒绝 QZH 会话的 `session.selectModel`。QZH 源码工具保持只读，并按会话事件历史解析实际 preset，而不是只读取创建时 header。

## 曾考虑的替代方案

- **独立 QZH 页面或分析会话**：会把证据和追问从当前 DSH 会话与工作区拆开。
- **继续使用 composer dock**：会重现对话 composer 与分析工作台之间的纵向布局冲突。
- **只相信浏览器 preset 标签**：过期或伪造的客户端状态可能绕过 Host 的只读和模型限制。

## 影响

QZH 仍位于普通会话列表和消息流中，证据/状态内容使用原生详情栏几何布局。工作台切换只改变列表视图，不改变底层 workspace/session 持久化模型，因此 QZH 与普通 DSH 行不会混排。窄视口沿用现有布局让步逻辑关闭详情栏。改动前创建的案例仍保留已存储的证据值；浏览器会对旧的 `unknown` 文件组件应用展示回退标签。

## 验证

QZH Host、layout、sidebar、workspace 与客户端定向 TypeScript 检查通过；layout（59）、sidebar（26）、workspace（122）、QZH（8）以及 runtime workspace/session（343）定向 Vitest 通过；完整 client 与 Host GUI 测试通过（276 个文件、3770 个测试、跳过 1 个）。workspace 与 QZH client bundle 已重建。翻译配对检查和 `git diff --check` 通过。浏览器验证确认工作台菜单可在 QZH 与普通 DSH 间切换、两类列表分别过滤、QZH 空白态隐藏 Workspace Write/模型/命令控制、QZH 会话保留详情/追问布局，并在 1280px 和 375px 模拟宽度下均无横向溢出。pnpm 包装命令在 `pnpm run test:gui` 前仍会尝试安装大型可选依赖并触发 Node OOM，因此在该包装阶段失败后使用等价的本地 Vitest 命令完成了测试。
