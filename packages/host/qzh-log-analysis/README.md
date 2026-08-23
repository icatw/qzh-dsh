# @deepseek-ai/dsh-host-qzh-log-analysis

English | [中文](README.zh.md)

Host-side QZH case Remote API, read-only Git mirror, and current-session analysis integration for the DSH Web application. The package reuses the DSH Typert Gateway, Agent Loop, LLM seam, tool registry, and `ctx.subprocess`; it does not expose a general shell or a writable workspace to the browser.

## Model Experience

Indirectly, through the DSH Agent Loop, which consumes this package's QZH tools and investigation guidance. The model-facing tools are `qzh_list_evidence` (the full evidence file list with per-file first-line samples and error clusters — the Agent inspects the real field layout before locating a root cause), `qzh_get_current_case` (the current case view), and the read-only mirror tools `qzh_search_code` / `qzh_read_code`. When a case has uploaded its full log archive, the tools `qzh_list_logs` (extracted evidence tree), `qzh_search_logs` (bounded fixed-string search returning `path:line`), and `qzh_read_log_range` (bounded line-range reads) let the Agent read complete logs on demand; without an archive they degrade to the submitted summary. The investigation methodology tells the Agent to trust the actual archive structure over any fixed layout, treat the browser-provided component labels as initial guesses only, and cite evidence by the real relative paths (and line numbers) in the evidence package.

#### KV Cache effect

The report and tool calls are recorded in the DSH Session. The QZH package only adds the case evidence and its read-only tools.

## Known Limitations and Deferred Work

- **Durable cases** — cases are persisted through the `ctx.storage` kv backend (default `json`, configurable via `storageBackend`) in the `qzh_cases` unit and restored on first access after a restart; when the storage service or backend is unavailable the service degrades to in-memory cases with a one-time warning. Report feedback is persisted with the case. `evidenceBackend` (defaulting to `storageBackend`) names the backend holding the per-case evidence blobs, so a public deployment can keep KV local (`json`) and put evidence on `s3`.
- **Full-log archives** — `uploadEvidenceArchive` stores the original zip and its extracted tree as binary objects on the `evidenceBackend` backend's `blob` facet (default `json`, configurable; use `s3` for an S3-compatible object store), keyed `<caseId>/archive-<category>.zip` and `<caseId>/files/<category>/<relpath>`. Extraction validates every entry path, rejects non-file/symlink entries, bounds archive/file/file-count sizes, and publishes the archive blob last as the durability marker; a second upload for the same field side is refused. `qzh_list_logs` / `qzh_search_logs` / `qzh_read_log_range` read only through the service (ownership + key-containment checked) and redact every returned excerpt. Summaries remain the durable fallback when no archive was uploaded.
- **Mirror configuration required** — the Web profile loads this package only when `QZH_MIRROR_ROOT` is set. It points at a server-side Git object store (a checkout or bare repository whose tags/commits `git show`/`git grep` can reach; no working tree is used). For a public deployment this is a persistent clone refreshed with `git fetch --tags`, never a per-machine checkout.
- **Read-only source surface** — search and bounded reads verify containment and never expose repository writes or arbitrary command execution.
- **Evidence is re-sanitized** — the Host normalizes archive-relative paths, bounds metadata, and masks common authorization, cookie, token, password, secret, and private-key patterns before retaining the summary; per-file first-line layout samples are redacted and capped at 512 characters. Every file and cluster carries a `category` (`server`/`terminal`), defaulting any non-`terminal` value to `server`.
- **Report feedback** — `setFeedback(sessionId, caseId, kind, comment?)` records a `like`/`dislike` verdict with an optional note after validating case ownership and the kind; feedback is persisted with the case.
- **Current-session analysis** — `startAnalysis(sessionId, caseId)` accepts only the case's live Agent and uses `Agent.followup()` to append the analysis request to that QZH transcript; model-facing tools resolve the latest case from the session and the Host does not create a separate analysis session.
- **Model lock** — model selection for the `qzh` preset is rejected at the API layer; model routing and DeepSeek/OpenAI-compatible configuration remain owned by the DSH Host.
