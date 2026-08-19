# Agent Note: dsh plugin prints the pnpm allowBuilds edit on blocked-build-scripts failures

Status: implemented

English | [中文](2026-08-19-cli-plugin-allowbuilds-guidance.zh.md)

## Problem

`dsh plugin add` of a registry plugin whose dependency chain includes native modules (for example `dsh-better-sidebar`, which depends on `node-pty`) fails on pnpm ≥11: `strictDepBuilds` blocks the dependency's build scripts by default, pnpm exits with `ERR_PNPM_IGNORED_BUILDS`, and its only hint is the interactive `pnpm approve-builds`, which a scripted profile install cannot run. Before failing, pnpm writes `allowBuilds: { <name>: set this to true or false }` into the profile's `pnpm-workspace.yaml` — a placeholder that only a literal boolean satisfies, so re-running without editing fails identically. The CLI's previous guidance was gated on a git-hosted spec, so registry plugins received only `dsh: pnpm failed in profile directory <dir>`.

## Decision

On a failed install, the CLI reads the profile's `pnpm-workspace.yaml` and, when it contains pnpm's placeholder entries, prints the exact edit: set each listed name to `true` under `allowBuilds`, then re-run. The git-hosted-spec message remains as a fallback for git prepare-script blocks.

## Alternatives considered

**Scan pnpm's captured output for the error marker.** The `ERR_PNPM_IGNORED_BUILDS` text is emitted on stdout, so detection would require buffering pnpm's output and losing the live progress the forwarder currently inherits; the placeholder pnpm itself writes into `pnpm-workspace.yaml` carries the same signal without touching the streams.

**Auto-approve the blocked scripts.** Silently running dependency build scripts defeats pnpm's security default and surprises users.

**Run `pnpm approve-builds` non-interactively.** pnpm ≥11 cannot prompt without a TTY; it only re-writes the placeholder.

## Consequences

Registry plugins with native dependencies now fail with an actionable message that names the exact file and values, matching what pnpm itself recorded. The hint derives from the file pnpm wrote, so it stays accurate across pnpm versions that keep the placeholder format. Output streaming is unchanged: pnpm still writes directly to the terminal.
