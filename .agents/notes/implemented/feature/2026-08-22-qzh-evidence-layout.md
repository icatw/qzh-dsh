# Agent Note: QZH evidence layout inference

Status: implemented

English | [中文](2026-08-22-qzh-evidence-layout.zh.md)

## Problem

The QZH Web workbench hardcoded its log-layout assumptions. The desktop prototype filtered archive members by a literal `/data/logs` prefix, and the Web scanner mapped QZH service names to components through inline conditionals. Field log archives change structure — new services, renamed directories, nested bundles — so the browser either dropped files, mislabeled components, or collapsed every unknown into a generic label. The component label then propagated unchanged into the evidence package, the error clusters, and the Agent context, so the report's evidence chain was only as good as the browser's guess, and the Agent had no way to inspect the real archive structure.

## Decision

Layout recognition is a two-layer system: the browser produces best-effort, data-driven labels; the Host Agent holds the final interpretation.

The browser (`packages/client/ui-qzh-log-analysis/src/log-layout.ts`) now maps components through a data table `QZH_COMPONENT_RULES` (longest matching filename fragment wins, so `qzh_agent_flush` never collapses into `qzh_agent`); adding a service is one row, not a scanner change. Files that match no rule keep the path-derived fallback label and are never dropped by a fixed directory prefix. Stream classification prefers the filename (`*-error.log` and peers) and, when the name carries no signal, falls back to a content check (`looksLikeErrorStream`): a majority of the first non-empty lines carrying error markers classifies the file as an error stream, while an ordinary log with occasional ERROR lines stays `log`. Every imported entry carries a bounded first-line sample (up to four non-empty lines, 1 KiB) that the consent preview shows and the evidence summary submits.

The Host (`packages/host/qzh-log-analysis`) re-sanitizes each per-file sample (redaction plus a 512-character bound) and registers a new read-only model-facing tool `qzh_list_evidence`, which returns the complete evidence file list with real relative paths, per-file samples, and the error clusters. The QZH methodology prompt (Host section, analysis prompt, and the `qzh` preset persona) now instructs the Agent to list the evidence first, trust the actual archive structure over any assumed layout, treat the browser `component` as an initial guess only, and cite logs by the real relative paths in the evidence package.

## Alternatives considered

- **Keep a fixed `/data/logs` layout contract** — rejected: field archives are not guaranteed to follow it, and dropping unmatched files silently loses evidence.
- **Let the browser classify everything from content** — rejected: the browser has no Agent judgment, and content-based stream classification without a dominance check would reclassify ordinary logs as error streams and flood the parser.
- **Agent-only exploration without browser labels** — rejected: the browser still needs labels for the local consent preview and cluster grouping; the Agent's `qzh_list_evidence` re-derives structure from real paths and samples.

## Consequences

Field archives with new or renamed services keep useful labels and never lose files to a directory assumption. The Agent's evidence view is no longer bounded by the browser's inference, so the report cites the actual layout. The evidence package grows by a bounded first-line sample per file, which the outbound-consent preview makes visible before submission; the Host re-redacts and caps the samples as a second enforcement point. The desktop prototype's hardcoded `/data/logs` scanner is not part of the Web product path and was left unchanged.

## Related

Extends the evidence-flow decisions in `2026-08-21-qzh-session-agent.md`; the workbench and details-panel integration is covered by `2026-08-21-qzh-details-panel.md`.
