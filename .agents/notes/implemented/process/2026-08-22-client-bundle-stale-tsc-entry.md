# Agent Note: Client bundle rebuilds may use stale tsc emit

Status: implemented

English | [中文](2026-08-22-client-bundle-stale-tsc-entry.zh.md)

## Problem

Rebuilding client bundles during QZH work silently reverted shipped features. A full client-face run (`npm run build:lib:client` = `tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client`) compiled cleanly at the tsdown stage but the served browser bundle lost the server/terminal upload zones, the report feedback control, and the `setFeedback` remote call. The feedback buttons then failed at runtime with a silent `setFeedback is not a function`, because the remote method table bundled into `@deepseek-ai/dsh-api-remotes` predated the method.

## Decision

Client plugin bundles compile from `src/client/index.ts` when tsdown runs without `DSH_BUILD_FACE` — the per-package `bundle` script, a bare `tsdown` inside the package, and `pnpm run dev:web`'s watcher all take this source path. Under `tsdown --env.DSH_BUILD_FACE client` the entry switches to `lib/types/client/index.js`, the client-face `tsc` emit (`packages/client/tsdown.client.ts`). That emit is only as fresh as the last successful client aggregate compile. When the aggregate is red (observed: pre-existing `SessionStore` contract errors in `ui-conversation`/`runtime` and peers), the client-face tsdown silently rebuilds every bundle from the stale emit and reverts recent client changes — no error, no warning.

The safe client iteration loop is per-package `pnpm --filter @deepseek-ai/dsh-client-<pkg> bundle` (source entry) or `pnpm run dev:web` (source watcher + the server's `client-hmr` stat-poll reloads the page without a restart). The full client face runs only when the aggregate typechecks. The process is recorded in `packages/client/AGENTS.md` under "Rebuilding client bundles".

## Alternatives considered

- **Blame the aggregate break and fix `tsc -b` first** — rejected for this change: the `SessionStore` contract drift is a separate pre-existing defect with its own fix window; it must not block per-feature bundle rebuilds.
- **Have the client face fall back to source on stale emit** — deferred: changing `packages/client/tsdown.client.ts` entry semantics is a build-tooling change with its own review; the process note records the correct invocation instead.

## Consequences

Client iteration no longer silently reverts features: the source entry is the default for per-package rebuilds and the dev watcher, and the served bundle is verifiable by content hash against the local `lib/client.js`. The stale-emit trap remains until the aggregate `tsc` break is fixed; anyone running the bare client face before then must re-run the per-package source build afterward.
