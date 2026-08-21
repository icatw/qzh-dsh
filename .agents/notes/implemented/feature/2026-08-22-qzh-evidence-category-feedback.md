# Agent Note: QZH multi-side evidence and report feedback

Status: implemented

English | [中文](2026-08-22-qzh-evidence-category-feedback.zh.md)

## Problem

The QZH workbench imported every log into one undifferentiated list. Field engineers always collect two distinct sides — server logs (`qzh_web_agent`, `qzh_log_center`) and terminal logs from the managed endpoint (`qzh_agent`, `qzh_agent_flush`) — and the report must keep the two sides apart when correlating a cross-machine timeline. There was also no way to record whether a diagnosis actually helped, so quality could not be measured or fed back to the analysis loop.

## Decision

Imported evidence carries a `category` (`server` | `terminal`) set by which import zone the engineer used, not inferred from the filename. The browser's blank-state Hero now renders two upload zones (server / terminal), each with its own directory picker, ZIP picker, and drop target; every `ImportedLogEntry` and `ParsedLogEvent` carries the category, and `clusterLogErrors` includes category in the cluster key so the same error text on the two sides stays separate. The evidence summary submits the category per file and per cluster, the Host re-sanitizes it through `ensureCategory` (any non-`terminal` value collapses to `server`), and the evidence tables render a side badge.

A completed case accepts one user verdict through a new `setFeedback(sessionId, caseId, kind, comment?)` Remote: `like` or `dislike` with an optional note. The Host validates case ownership and the kind, trims and bounds the comment, and re-submitting without a comment clears the previous note. The feedback lives on the in-memory case view (durable case storage is still deferred) and the report card renders a helpful / not-helpful control once `completed`.

## Alternatives considered

- **Infer category from the filename** — rejected: filenames are the browser's best-effort labels, and a mislabeled archive would silently assign the wrong side; the upload zone is the engineer's explicit intent.
- **One combined upload with a side toggle per file** — rejected: two zones match the field workflow and make the outbound consent review unambiguous.
- **Feedback as free-text only** — rejected: a structured `like`/`dislike` is aggregatable for quality metrics; the optional note captures the reason without forcing it.

## Consequences

Cross-machine analysis can distinguish server from terminal evidence end to end, and the two sides never merge in error clustering. Report quality becomes measurable through the verdict, at the cost of a slightly larger evidence payload and one more case field. Cases are now durable: every mutation is written through the `ctx.storage` kv backend (`qzh_cases` unit, default `json` backend, `storageBackend` configurable) and restored on first access after a restart, degrading to in-memory operation with a one-time warning when storage is unavailable. Feedback is persisted with the case; an aggregate quality dashboard and notification events remain future work.

## Related

Builds on `2026-08-22-qzh-evidence-layout.md` (layout rules, per-file samples, `qzh_list_evidence`); the workbench and details-panel integration is `2026-08-21-qzh-details-panel.md`. The durable case store is the first step toward shared case search and role-based visibility.
