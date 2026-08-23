# Agent Note: QZH 日志分析模式变为去目录化的 SaaS 界面

状态：已实现

[English](2026-08-23-qzh-directory-free-saas-surface.md) | 中文

## 问题

QZH 日志分析工作台仍携带 DSH 的本地目录概念：侧边栏把会话按工作区（文件夹）分组、提供添加工作区选择器与视图选项（分组方式）菜单，QZH 会话可能出现在某个目录账户下。产品方向是 ChatGPT/豆包式的 SaaS 对话：日志分析接收上传的压缩包，绝不使用本地工作目录，因此目录界面是噪音。通用 DSH 模式保留目录模型（这属于后续、独立的决策）。

## 决策

`WorkspaceBrowser` 从 workbench 派生 `effectiveGroupBy`：`qzh` 模式下强制单列会话列表（不受持久化 `groupBy` 偏好影响），并隐藏分组方式菜单与添加工作区选择器。持久化偏好仍归通用模式所有。`ConversationRoot` 无需改动：它的 `qzhBlank`/`qzh` 分支本就渲染 QZH 日志导入 hero 且不含工作区芯片，因此 qzh 会话（以及 qzh 冷启动自动选中的空白会话）已经去目录化；只有侧边栏还带着目录界面。

## 备选方案

- **保留工作区分组并新增 QZH 专属组** —— 拒绝：目录账户正是要移除的概念而非改名的对象；"未分组"/"QZH" 桶仍读起来像文件夹模型。
- **按 workbench 特判 store 的 `groupBy`** —— 拒绝：该偏好是通用模式的状态；派生本地 `effectiveGroupBy` 保持 store 不动，通用模式的持久化选择不受影响。
- **对话主视觉区也移除目录界面** —— 不需要：`ConversationRoot` 对 qzh 会话本就渲染 QZH 日志导入 hero（并隐藏工作区芯片），只有侧边栏还带着目录界面。

## 后果

`qzh` 模式下侧边栏是纯单列会话历史（"会话"标题、无工作区分组、无添加/分组入口），对话主视觉区是日志导入界面。`groupBy` store 偏好对通用模式保持不变。QZH 会话自 startSession 改动起就已不绑工作区；本次补全了可见界面。
