# Agent Note: Log parser treats column headers mentioning a level word as events

Status: implemented

English | [中文](2026-08-22-qzh-parser-header-level-false-positive.zh.md)

## Problem

The QZH log parser classified any line containing a level word as an error or warning event, regardless of where the word appeared. `severityOf` ran `\b(ERROR|WARN|...)\b` over the whole line (`packages/client/ui-qzh-log-analysis/src/log-parser.ts`), so a column header such as `summary.txt`'s `service status total debug info warn error first_time ...` produced a phantom `server:summary:error` cluster. In one real analysis the false cluster appeared alongside the genuine `gorm slow query` warning, so the evidence summary showed "2 类异常" where only one real warning existed, and the agent had to explain the artifact in its report.

## Decision

A level word only counts when the line is anchored: with a parsed timestamp the word may appear anywhere; without one it must start the line (tolerating a leading bracketed tag). `severityOf(line, hasTimestamp)` now gates the error/warn branches on `hasTimestamp || LEVEL_AT_START.test(upper)`, where `LEVEL_AT_START` matches `ERROR|CRITICAL|EXCEPTION|TRACEBACK|WARN|WARNING` at the start. `parseLogText` parses the timestamp once and passes it in. Untimestamped lines that merely mention a level word mid-line (headers, field lists) stay `unknown` and are dropped by the existing filter, while genuine `ERROR: ...` / `WARN ...` lines without timestamps still produce events.

## Alternatives considered

- **Filter header-looking lines separately** — rejected: header detection is a second heuristic layered on severity; anchoring the level word is the single rule and covers headers, field lists, and prose that mentions "error".
- **Require a timestamp for any event** — rejected: genuine Python-style logs (`ERROR: boom`) carry no timestamp and must still surface.

## Consequences

Evidence summaries no longer invent error clusters from table headers; the cluster set matches what a reader sees in the log lines. Parsing behavior for timestamped lines is unchanged, and untimestamped lines that genuinely start with a level word still parse. Covered by three new cases in `log-parser.client.spec.ts` (header ignored, untimestamped start-of-line level kept, timestamped mid-line level kept).
