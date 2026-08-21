# @deepseek-ai/dsh-host-qzh-log-analysis

English | [中文](README.zh.md)

Host-side QZH case Remote API, read-only Git mirror, and current-session analysis integration for the DSH Web application. The package reuses the DSH Typert Gateway, Agent Loop, LLM seam, tool registry, and `ctx.subprocess`; it does not expose a general shell or a writable workspace to the browser.

## Model Experience

Indirectly, through the DSH Agent Loop, which consumes this package's QZH tools and investigation guidance.

#### KV Cache effect

The report and tool calls are recorded in the DSH Session. The QZH package only adds the case evidence and its read-only tools.

## Known Limitations and Deferred Work

- **In-memory cases** — the first slice keeps case metadata in the Host process; durable case storage and report persistence are deferred.
- **Mirror configuration required** — the Web profile loads this package only when `QZH_MIRROR_ROOT` is set. It may point to a directory containing `server/` or directly to the QZH Git checkout for `https://git.in.chaitin.net/cyberserval/qzh`.
- **Read-only source surface** — search and bounded reads verify containment and never expose repository writes or arbitrary command execution.
- **Evidence is re-sanitized** — the Host normalizes archive-relative paths, bounds metadata, and masks common authorization, cookie, token, password, secret, and private-key patterns before retaining the summary.
- **Current-session analysis** — `startAnalysis(sessionId, caseId)` accepts only the case's live Agent and uses `Agent.followup()` to append the analysis request to that QZH transcript; model-facing tools resolve the latest case from the session and the Host does not create a separate analysis session.
- **Model lock** — model selection for the `qzh` preset is rejected at the API layer; model routing and DeepSeek/OpenAI-compatible configuration remain owned by the DSH Host.
