# @deepseek-ai/dsh-client-ui-qzh-log-analysis

English | [中文](README.zh.md)

QZH 日志分析 Web 工作台的浏览器插件入口。它提供设置导航中的分析工作台、本地 `/data/logs` 布局识别、普通文件和 ZIP 导入、时间解析与异常聚类，并在用户勾选确认后通过 `ctx.remote.qzhLogAnalysis` 提交经过选择的证据摘要。

## Model Experience

None, as this package owns a browser presentation surface and local evidence preview; it does not register a model-facing tool or prompt section.

#### KV Cache effect

No direct effect. The package does not change model requests.

## Known Limitations and Deferred Work

- **Host integration is summary-only** — the browser never uploads a complete log file or QZH checkout. The Host stores the selected summary, exposes read-only source methods, and starts a DSH Agent analysis only after explicit consent.
- **No implicit outbound request** — importing files only updates browser state. The Host call requires both an imported log and the explicit outbound-consent checkbox.
