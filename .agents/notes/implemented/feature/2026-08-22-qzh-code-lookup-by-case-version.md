# Agent Note: QZH code lookups pin the case product version as a git ref

Status: implemented

English | [中文](2026-08-22-qzh-code-lookup-by-case-version.zh.md)

## Problem

QZH code analysis read the mirror's checked-out working tree: `searchCode` ran ripgrep over the checkout and `readCode` read files from disk, with `currentCommit` reporting `rev-parse HEAD`. Every session analyzed whatever version happened to be checked out, so a log from an older or newer release was measured against the wrong source. Switching the checkout to serve another version was impossible: the mirror is a single 1.8 GB repository shared by dozens of Codex/Claude worktrees, and `git checkout` on the main worktree would corrupt every concurrent user's working tree.

## Decision

Code lookups no longer touch the working tree. Each case pins the source revision through its `productVersion` field, which names a git tag (or any ref) in the mirror:

- `searchCode` runs `git grep -n --fixed-strings <query> <commit>` against the committed tree.
- `readCode` runs `git show <commit>:<path>` and slices lines from the committed blob.
- `resolveRef(root, record)` resolves `productVersion` with `git rev-parse --verify '<version>^{commit}'`; without a version it falls back to the checkout HEAD (the previous behavior).
- The resolved commit is returned in every result, so reports cite the exact revision analyzed.

The rev prefix that `git grep <rev>` adds to each match line (`<rev>:path:line:text`) is stripped before parsing. `readCode`'s size cap now measures the collected stdout text instead of a stat. `repositoryRoot` now compares against `realpath` of the mirror root, fixing a false "outside the configured mirror root" rejection when the configured path goes through a symlink (e.g. `/var` → `/private/var` on macOS).

## Alternatives considered

- **Fetch from GitLab per case with a token** — rejected: the repository is 1.8 GB, the DSH sandbox has no outbound network, a token would leak into session/subprocess env, and two GitLab origins exist with no single authority. A local mirror is the only source with every tag reachable.
- **Add worktrees per version** — rejected: `git grep`/`git show` read the object store directly with no working-tree state, so no worktree bookkeeping, no checkout, and no interference with the dozens of existing worktrees.

## Consequences

Concurrent sessions can analyze different versions simultaneously with no code conflict: each lookup is a read against the shared object store, which git guarantees safe for concurrent readers. `git fetch --tags` on the mirror (appending objects, atomically updating refs) is the only write, and readers never observe a torn ref. The version→commit mapping is the mirror's tags themselves; no external manifest is required. Terminal repositories are not yet wired; the same mechanism applies when they join the mirror.
