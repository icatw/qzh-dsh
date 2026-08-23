# Agent Note: QZH log-analysis mode becomes a directory-free SaaS surface

Status: implemented

English | [中文](2026-08-23-qzh-directory-free-saas-surface.zh.md)

## Problem

The QZH log-analysis workbench still carried DSH's local-directory concepts: the sidebar grouped sessions under workspaces (folders), offered an add-workspace picker and a view-options (group-by) menu, and a QZH session could appear under a directory account. The product direction is a ChatGPT/Doubao-style SaaS conversation: log analysis takes uploaded archives, never a local working directory, so the directory surface is noise. The General DSH mode keeps the directory model (a later, separate decision).

## Decision

`WorkspaceBrowser` derives an `effectiveGroupBy` from the workbench: in `qzh` mode it forces the flat session list regardless of the persisted `groupBy` preference, and hides the group-by menu and the add-workspace picker. The persisted preference stays owned by the General mode. No change was needed in `ConversationRoot`: its `qzhBlank`/`qzh` branches already render the QZH log-import hero without the workspace chip, so a qzh session (and the qzh cold-start auto-selected blank) is already directory-free; only the sidebar carried the directory surface.

## Alternatives considered

- **Keep the workspace grouping and add a QZH-specific group** — rejected: a directory account is the concept to remove, not to rename; an "Ungrouped"/"QZH" bucket still reads as a folder model.
- **Special-case the store `groupBy` per workbench** — rejected: the preference is General-mode state; deriving a local `effectiveGroupBy` keeps the store untouched and the General mode's persisted choice intact.
- **Remove the directory surface at the conversation hero too** — not needed: `ConversationRoot` already renders the QZH log-import hero (and hides the workspace chip) for qzh sessions, so only the sidebar carried the directory surface.

## Consequences

In `qzh` mode the sidebar is a plain flat session history ("会话" heading, no workspace groups, no add/group affordances) and the conversation hero is the log-import surface. The `groupBy` store preference is untouched for General mode. QZH sessions were already workspace-less since the startSession change; this completes the visible surface.
