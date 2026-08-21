# Agent Note: QZH session Agent integration

Status: implemented

English | [中文](2026-08-21-qzh-session-agent.zh.md)

## Problem

QZH log analysis must use the DSH session and workspace model without exposing ordinary write tools or creating a second analysis conversation. The original implementation placed the evidence workbench in the composer dock, left analysis state stale after the blank Hero unmounted, and displayed generic imported paths as `unknown`.

## Decision

QZH is a built-in `qzh` agent preset, not a root-level navigation mode. The browser contributes a blank-state import Hero through `conversation.hero.empty`, a right-column evidence panel through `conversation.details.qzh`, and a compact status action through `conversation.session.header.actions`; these entries share one persisted JSON-safe store and render only when the session summary records `agentPreset: qzh`. The right panel polls the Host case while analysis is active and shows the terminal report or failure.

The shell exposes a workbench switcher in the expanded sidebar, defaulting to QZH. QZH and ordinary DSH sessions are filtered into separate views, and new sessions inherit the selected workbench's preset (`qzh` or `standard`). Switching workbenches reuses an existing matching session when one is available and otherwise clears the selection without mixing session lists.

The Host case API is explicitly keyed by `sessionId + caseId`. Case ownership is checked on every read, evidence update, code lookup, and analysis start. Analysis uses the live Agent already attached to `sessionId` and appends a follow-up to that transcript, so the report remains an ordinary assistant message in the current session.

The submitted session remains in its original workspace and receives the title `QZH 日志分析` when it has no user-defined title. Generic archive paths infer a component label from their parent directory or file stem. The model selector is hidden for QZH sessions in both the `/model` command and composer slot. The Host rejects `session.selectModel` for a QZH session as a second enforcement point. QZH source tools remain read-only and resolve the effective preset from the session event history, not only the creation header.

## Alternatives considered

- **Keep a separate QZH page or analysis session** — this would split evidence and follow-up messages from the user's current DSH session and workspace.
- **Keep the evidence panel in the composer dock** — this recreates the vertical layout collision between the conversation composer and the analysis workbench.
- **Trust only the browser preset label** — this would allow stale or forged client state to bypass the Host's read-only and model restrictions.

## Consequences

QZH remains part of the ordinary session list and message stream while its evidence/status content uses the native details geometry. The workbench switcher keeps QZH and ordinary DSH rows separate without changing the underlying workspace/session persistence model. Narrow viewports close the details column through the existing layout concession. Existing cases created before the label inference change retain their stored evidence values, while the browser applies a display fallback for old `unknown` file components.

## Verification

Focused TypeScript builds passed for the QZH Host and client, layout, sidebar, and workspace packages. Focused Vitest suites passed for layout (59), sidebar (26), workspace (122), QZH (8), and runtime workspace/session behavior (343) tests. The complete client and Host GUI suite passed (276 files, 3770 tests, 1 skipped). The workspace and QZH client bundles were rebuilt. Translation-pair checks and `git diff --check` passed. Browser checks confirmed the workbench menu switches between QZH and ordinary DSH, each list is filtered, QZH blank state hides Workspace Write/model/command controls, QZH sessions retain the details/追问 layout, and the page has no horizontal overflow at 1280px and 375px emulated widths. The package-manager wrapper still attempts a large optional dependency install before `pnpm run test:gui`; the equivalent local Vitest command was used after that wrapper hit Node OOM.
