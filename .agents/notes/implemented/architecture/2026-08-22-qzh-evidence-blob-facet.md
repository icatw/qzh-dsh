# Agent Note: Evidence archives move to a storage `blob` facet

Status: implemented

English | [中文](2026-08-22-qzh-evidence-blob-facet.zh.md)

## Problem

QZH evidence persistence was hardcoded to a local directory: `uploadEvidenceArchive` unzipped into `<evidenceRoot>/<caseId>/files/<category>/` and stored the original zip beside it, with `listEvidenceTree` / `searchEvidence` / `readEvidenceRange` reading straight off the filesystem via `node:fs`. That couples the host to one machine's disk: a public, multi-replica, or containerized deployment loses evidence on reschedule and cannot share it across replicas. The code mirror had already been detached from a checkout (`git grep` / `git show` against a ref); evidence was the last thing still pinned to a local directory.

## Decision

The storage hub gains a second data-shape facet alongside `kv`: `BlobFacet` (`packages/storage/storage/src/backend.ts`) with `put` / `get` / `getRange` / `stat` / `list` / `delete` over relative, path-shaped keys (`a/b/c`, no leading `/`, no `.`/`..`, no empty segment, no backslash or NUL). `StorageBackend` carries `blob?: BlobFacet`; a backend serves the facets it can, and resolution fails loud when a requested facet is absent. The `json` backend implements `blob` as one file per key under `<root>/blobs/` (`packages/storage/storage-json/src/blob.ts`), so the local-directory medium becomes an object store with the same contract a future S3-compatible backend would implement.

QZH evidence migrates onto it: files are `blob.put(<caseId>/files/<category>/<relpath>)`, the archive is `blob.put(<caseId>/archive-<category>.zip)` written last as the publish marker, and the case record flips only after every blob landed. `listEvidenceTree` / `searchEvidence` use `blob.list(<caseId>/files/)`, `readEvidenceRange` and `downloadEvidenceArchive` use `blob.get` (with a `stat` size cap), and first-line samples use `blob.getRange`. The `evidenceRoot` config field is removed; `storageBackend` now names the backend that holds both the `qzh_cases` KV unit and the evidence blobs.

## Alternatives considered

- **Keep the local directory and add a storage abstraction later** — rejected: the directory path is exactly the coupling a public deployment must not bake in, and the abstraction is cheap now that the code mirror is already ref-only.
- **Reuse `kv` for evidence** — rejected: archives and log files are binary blobs up to tens of MB; folding them into a JSON-snapshot KV unit would defeat the backend's whole-file rewrite model.
- **A dedicated evidence-service interface instead of a storage facet** — rejected: evidence is just bytes with path-shaped keys; a general `blob` facet serves it and any future consumer without a QZH-specific seam.

## Consequences

Evidence now rides the same `storageBackend` route as cases, so a single backend choice relocates both. Mid-upload failures leave orphaned file blobs that are invisible until the archive blob and the case record agree, so a retry is idempotent. Containment moved from `realpath`/`isWithin` on a directory to `validateBlobKey` in the facet: keys cannot escape the medium by construction. The local `~/.dsh/qzh-evidence/` directory is obsolete; new evidence lands under the storage backend's `blobs/` subtree.
