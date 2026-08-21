# Agent Note: QZH evidence belongs in the native details column

Status: implemented

English | [中文](2026-08-21-qzh-details-panel.zh.md)

## Problem

The QZH evidence and analysis status were registered below the conversation composer. That made the blank-state import surface and the active conversation compete for vertical space, while the DSH details column remained unused for QZH evidence.

## Decision

The conversation shell declares `conversation.details.qzh` as a session-scoped child of the built-in `details` entry. QZH registers its evidence panel there and keeps `conversation.composer.qzh` exclusively for the read-only follow-up composer. The panel polls the Host case while it is analyzing, so the right column reflects the terminal report state even after the blank Hero unmounts. The QZH session header opens the native details column when a submitted case is active; ordinary sessions keep the existing tool-details behavior. On narrow viewports, the existing layout concession closes the details column so it cannot cover the follow-up composer.

## Alternatives considered

- **Keep the evidence rail in `conversation.composer.qzh.dock`** — this preserves the vertical collision that motivated the change and makes the QZH workbench look like a second composer.
- **Replace the top-level `details` slot from QZH** — this would take ownership away from the conversation shell and remove the existing tool-details seat for every session.
- **Create a separate QZH page or overlay** — this would split evidence from the current session and discard the native DSH session navigation and details geometry.

## Consequences

The right column now has one DSH-owned shell with QZH evidence as an additive child, so existing tool details remain available when a tool call is selected. QZH evidence can be taller than the viewport but scrolls inside the details body. The header action is an opener rather than a second navigation surface. The submitted case keeps the current workspace session and assigns `QZH 日志分析` when no user title exists, so the analysis remains visible in the normal workspace tree. The details column is intentionally auto-collapsed below the existing layout breakpoint; users can reopen it from the QZH action on a wide viewport.

## Testing

The slot contract, details host, QZH registration, and automatic opener are covered by focused TypeScript and Vitest checks. Browser verification covers the active QZH session at the desktop viewport and a 375px viewport with no horizontal overflow.
