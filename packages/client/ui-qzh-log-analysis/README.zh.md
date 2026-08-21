# @deepseek-ai/dsh-client-ui-qzh-log-analysis

[English](README.md) | 中文

DSH Web 中的 QZH 日志分析工作台入口。它提供设置导航中的分析工作台、本地 `/data/logs` 布局识别、普通文件和 ZIP 导入、时间解析与异常聚类，并在用户勾选确认后通过 `ctx.remote.qzhLogAnalysis` 提交证据摘要。

## 模型体验

无。本包只负责浏览器呈现和本地证据预览，不注册面向模型的工具或提示词段落。

#### KV Cache 影响

无直接影响。本包不改变模型请求。

## 已知限制与暂缓事项

- **Host 集成仅提交摘要**：浏览器不会上传完整日志文件或 QZH checkout；Host 保存用户确认的摘要、提供只读源码方法，并且只有在明确确认后才启动 DSH Agent 分析。
- **不会隐式外发**：导入文件只更新浏览器状态；必须同时存在已导入日志和明确勾选的外发确认，才会发起 Host 请求。
