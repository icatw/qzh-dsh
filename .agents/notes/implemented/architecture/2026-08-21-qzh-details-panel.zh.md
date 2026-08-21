# Agent Note: QZH 证据进入原生详情栏

Status: implemented

[English](2026-08-21-qzh-details-panel.md) | 中文

## 问题

QZH 证据和分析状态此前注册在对话 composer 下方，使空白态导入入口与活跃会话争抢纵向空间，而 DSH 详情栏没有承载 QZH 证据。

## 决定

会话壳在内置 `details` entry 下声明 session 作用域的 `conversation.details.qzh` 子槽。QZH 将证据面板注册到该子槽，并让 `conversation.composer.qzh` 专门承载只读追问输入。案例处于分析中时，面板持续轮询 Host，因此空白 Hero 卸载后右栏仍能更新到最终报告状态。当前 QZH 会话存在已提交案例时，由会话 header 操作打开原生详情栏；普通会话继续使用既有工具详情行为。窄视口沿用现有布局让步逻辑关闭详情栏，因此不会遮挡追问输入。

## 曾考虑的替代方案

- **继续把证据条放在 `conversation.composer.qzh.dock`**：会保留触发本次改动的纵向布局冲突，并使 QZH 工作台看起来像第二个 composer。
- **由 QZH 替换顶层 `details` slot**：这会让 QZH 接管会话壳，并移除所有会话原有的工具详情席位。
- **创建独立 QZH 页面或 overlay**：这会把证据从当前会话拆出去，失去 DSH 原生会话导航和详情栏几何布局。

## 影响

右栏现在由 DSH 统一壳层承载，QZH 证据作为增量子槽接入；选择工具调用时，既有工具详情仍可用。QZH 证据超过视口高度时在详情 body 内滚动。header 操作现在是打开入口，而不是第二套导航。提交案例会继续使用当前 workspace 会话；如果用户没有自定义标题，系统将其命名为“QZH 日志分析”，因此它会出现在普通工作区树中。低于现有布局断点时详情栏会自动收起；宽屏上可通过 QZH 操作重新打开。

## 验证

slot 合约、详情宿主、QZH 注册和自动打开入口均有定向 TypeScript 与 Vitest 检查。浏览器验证覆盖桌面活动 QZH 会话及 375px 视口，并确认没有横向溢出。
