# @deepseek-ai/dsh-client-ui-qzh-log-analysis

English | [中文](README.zh.md)

Loading the QZH plugin selects the QZH workbench by default. The switcher and session browser separate QZH and General DSH by preset while both continue to reuse DSH's session and message framework.

QZH 日志分析 Web preset 的浏览器入口。Blank QZH sessions use a dedicated full-width `conversation.hero.empty` entry; the complete import workbench no longer occupies `conversation.input.dock`. After submission, the normal DSH conversation layout returns with a read-only analysis status, evidence summary, and report in the right-side `conversation.details.qzh` panel, while `conversation.composer.qzh` remains available for plain-text follow-up questions. Logs are parsed locally in the browser; the reviewed summary is submitted through `ctx.remote.qzhLogAnalysis` with `sessionId + caseId`. QZH sessions use the fixed standard model and hide model selection in the browser.

The right-side panel keeps polling the Host case until the report completes or fails. The submitted session remains in its original workspace and is named `QZH 日志分析` when it has no user-defined title. Imported files infer component labels from QZH filenames, parent directories, or file stems, so generic archive layouts do not collapse every file into `unknown`.

## Model Experience

None, as this package owns a browser presentation surface and local evidence preview; it does not register a model-facing tool or prompt section.

#### KV Cache effect

No direct effect. The package does not change model requests.

## Known Limitations and Deferred Work

- **The current session is reused** — analysis continues the QZH session and the report is a normal assistant message in that transcript; no `qzh-analysis-*` session is created.
- **Host integration is summary-only** — the browser never uploads a complete log file or QZH checkout. The Host stores the selected summary and exposes read-only source methods.
- **No implicit outbound request** — importing files only updates browser state. The Host call requires both an imported log and the explicit outbound-consent checkbox.
- **Three-stage entry** — the first viewport focuses on import; recognized logs then show the exact file, cluster, and excerpt payload; confirmation starts analysis in the current session.
