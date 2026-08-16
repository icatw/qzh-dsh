# Agent Note: Right-click opens sidebar row menus at the pointer

Status: implemented

English | [中文](2026-08-16-sidebar-row-context-menu.zh.md)

## Problem

The workspace browser's row actions (Rename/Fork/Archive for Sessions; Rename/Delete for Workspaces) were reachable only through the hover-revealed ellipsis trigger in the row's action slot. Right-click is the standard desktop gesture for row-level operations, and the desktop shell targets mouse-driven users; the existing menus already carried every safe action, so the gap was purely an entry point.

## Decision

Non-blank Session rows and real Workspace rows handle `onContextMenu`: they prevent the native menu, open the row's existing `Menu`, and anchor it at the pointer through the `Menu` primitive's `getAnchorRect` (portal placement, so the list appears at the cursor and the primitive's viewport clamping keeps it on-screen). Blank New Session rows and the ungrouped bucket have no menu and register no handler.

The pointer anchor is cleared on close and on selection, so the ellipsis trigger keeps its anchored-at-trigger behavior and a later right-click re-anchors correctly. Opening the menu never opens or switches the session: right-click does not fire the row's `onClick`.

## Alternatives considered

**Desktop-only DOM delegation** — rejected. A client-shell listener that locates the row and synthesizes a click on the ellipsis button would place the menu at the ellipsis rather than the pointer and couples the shell to row DOM details. The browser itself owns the row actions and the dialogs behind them.

**New menu entries in the same change** — deferred. P0 mirrors the ellipsis actions exactly so the two triggers stay behaviorally identical; new actions (delete session, pin, export) remain separate product decisions.

## Consequences

Right-click surfaces exactly the actions the ellipsis menu offers, positioned at the pointer. Hover cards remain suppressed while a menu is open, unchanged. Both triggers share one menu state, so they cannot open two menus on one row.

## Verification

`rows.client.spec.tsx` covers: session-row right-click (menu placed at the pointer coordinates, session not opened, Fork dispatch, Escape close followed by a re-anchor), workspace-row right-click dispatching Delete, and the no-menu cases (blank New Session row, ungrouped bucket).
