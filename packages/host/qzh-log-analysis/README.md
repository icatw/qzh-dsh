# @deepseek-ai/dsh-host-qzh-log-analysis

English | [中文](README.zh.md)

Host-side QZH case Remote API, read-only Git mirror, and current-session analysis integration for the DSH Web application. The package reuses the DSH Typert Gateway, Agent Loop, LLM seam, tool registry, and `ctx.subprocess`; it does not expose a general shell or a writable workspace to the browser.

## Model Experience

Indirectly, through the DSH Agent Loop, which consumes this package's QZH tools and investigation guidance. The model-facing tools are `qzh_list_evidence` (the full evidence file list with per-file first-line samples and error clusters — the Agent inspects the real field layout before locating a root cause), `qzh_get_current_case` (the current case view), and the read-only mirror tools `qzh_search_code` / `qzh_read_code`. The investigation methodology tells the Agent to trust the actual archive structure over any fixed layout, treat the browser-provided component labels as initial guesses only, and cite evidence by the real relative paths in the evidence package.

#### KV Cache effect

The report and tool calls are recorded in the DSH Session. The QZH package only adds the case evidence and its read-only tools.

## Known Limitations and Deferred Work

- **In-memory cases** — the first slice keeps case metadata in the Host process; durable case storage and report persistence are deferred.
- **Mirror configuration required** — the Web profile loads this package only when `QZH_MIRROR_ROOT` is set. It may point to a directory containing `server/` or directly to the QZH Git checkout for `https://git.in.chaitin.net/cyberserval/qzh`.
- **Read-only source surface** — search and bounded reads verify containment and never expose repository writes or arbitrary command execution.
- **Evidence is re-sanitized** — the Host normalizes archive-relative paths, bounds metadata, and masks common authorization, cookie, token, password, secret, and private-key patterns before retaining the summary; per-file first-line layout samples are redacted and capped at 512 characters. Every file and cluster carries a `category` (`server`/`terminal`), defaulting any non-`terminal` value to `server`.
- **Report feedback** — `setFeedback(sessionId, caseId, kind, comment?)` records a `like`/`dislike` verdict with an optional note after validating case ownership and the kind; feedback is retained on the in-memory case.
- **Current-session analysis** — `startAnalysis(sessionId, caseId)` accepts only the case's live Agent and uses `Agent.followup()` to append the analysis request to that QZH transcript; model-facing tools resolve the latest case from the session and the Host does not create a separate analysis session.
- **Model lock** — model selection for the `qzh` preset is rejected at the API layer; model routing and DeepSeek/OpenAI-compatible configuration remain owned by the DSH Host.
