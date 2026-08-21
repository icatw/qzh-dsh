# Agent Note: QZH session Agent integration

Status: implemented

## Decision

QZH is a built-in `qzh` agent preset, not a root-level navigation mode. The browser contributes a session-scoped evidence card through `conversation.input.dock` and a compact status action through `conversation.session.header.actions`; both entries share one persisted JSON-safe store and render only when the session summary records `agentPreset: qzh`.

The Host case API is explicitly keyed by `sessionId + caseId`. Case ownership is checked on every read, evidence update, code lookup, and analysis start. Analysis uses the live Agent already attached to `sessionId` and appends a follow-up to that transcript, so the report remains an ordinary assistant message in the current session.

The model selector is hidden for QZH sessions in both the `/model` command and composer slot. The Host rejects `session.selectModel` for a QZH session as a second enforcement point. QZH source tools remain read-only and reject calls from non-QZH Agent sessions.

## Verification

Focused TypeScript builds passed for the QZH Host, QZH client, model-selection client, sidebar, and Host API proxy. Focused Vitest suites passed for QZH client/Host behavior and model-selection browser behavior. The generated QZH client bundle was rebuilt and no longer contains the old sidebar/overlay registrations or the Node `fflate` entry that caused the module-table failure.
