# @deepseek-ai/dsh-client-ui-qzh-log-analysis

[English](README.md) | 中文

加载 QZH 插件后默认进入 QZH 工作台；左上角切换器和会话列表按 preset 隔离 QZH 与通用 DSH，但两者仍复用同一套 DSH session 和消息框架。

DSH Web 中的 QZH 内置 Agent preset 浏览器入口。空白 QZH 会话通过 `conversation.hero.empty` 使用专用全宽导入入口，完整工作台不会占用 `conversation.input.dock`；提交后回到 DSH 原生会话布局，通过 `conversation.details.qzh` 在右侧详情栏展示只读分析状态、证据摘要和报告，并通过 `conversation.composer.qzh` 提供无附件、无命令、无模型切换的文字追问。日志在浏览器本地解析；用户确认的摘要通过 `ctx.remote.qzhLogAnalysis` 按 `sessionId + caseId` 提交。QZH 会话固定标准模型，前端隐藏模型选择器。

分析状态由右侧面板继续按案例状态轮询 Host，直到报告完成或失败；提交后的当前会话会保留在原 workspace，并在没有用户自定义标题时命名为“QZH 日志分析”。导入文件会按 QZH 文件名、目录名或文件名推断组件标签，无法匹配固定 QZH 文件名时也不会统一显示为 `unknown`。

## 模型体验

无。本包只负责浏览器呈现和本地证据预览，不注册面向模型的工具或提示词段落。

#### KV Cache 影响

无直接影响。本包不改变模型请求。

## 已知限制与暂缓事项

- **复用当前会话**：分析请求继续当前 QZH session，报告作为普通 assistant 消息写入同一会话，不创建独立分析 session。
- **Host 集成仅提交摘要**：浏览器不会上传完整日志文件或 QZH checkout；Host 保存用户确认的摘要并提供只读源码方法。
- **不会隐式外发**：导入文件只更新浏览器状态；必须同时存在已导入日志和明确勾选的外发确认，才会发起 Host 请求。
- **三阶段入口**：首屏只显示导入；识别日志后展示实际将发送的文件、聚类和错误样例；确认后自动启动当前会话分析。
