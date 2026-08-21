# @deepseek-ai/dsh-host-qzh-log-analysis

English | [中文](README.zh.md)

Host-side QZH case Remote API, read-only Git mirror, and analysis-Agent integration for the DSH Web application. The package reuses the DSH Typert Gateway, Agent Loop, LLM seam, tool registry, and `ctx.subprocess`; it does not expose a general shell or a writable workspace to the browser.

## Model Experience

Indirectly, through the DSH Agent Loop, which consumes this package's QZH tools and investigation guidance.

#### KV Cache effect

The report and tool calls are recorded in the DSH Session. The QZH package only adds the case evidence and its read-only tools.

## Known Limitations and Deferred Work

- **In-memory cases** — the first slice keeps case metadata in the Host process; durable case storage and report persistence are deferred.
- **Mirror configuration required** — the Web profile loads this package only when `QZH_MIRROR_ROOT` is set. The root must contain `server/`, `terminal/`, and (when legacy comparison is needed) `legacy/` Git checkouts.
- **Read-only source surface** — search and bounded reads verify containment and never expose repository writes or arbitrary command execution.
- **Evidence is re-sanitized** — the Host normalizes `/data/logs` paths, bounds metadata, and masks common authorization, cookie, token, password, secret, and private-key patterns before retaining the summary.
- **Analysis tools are restricted** — the analysis Agent uses an agent-scoped `ctx.tools.restrict({ allow: [...] })` mask and cannot inherit the general shell, editor, or Git write tools.
- **LLM configuration reuses dsh** — the defaults are `deepseek-official` / `deepseek-v4-flash`; Host configuration can select any registered OpenAI-compatible provider. If no provider is configured, the case retains the failure reason.
