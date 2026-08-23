# @deepseek-ai/dsh-storage-s3

English | [中文](README.zh.md)

S3-compatible backend for the [storage hub](../storage/README.md): binary objects on the `blob` facet are stored as S3 objects under a configured prefix, registered as backend `s3`. It serves `blob` only — a whole-snapshot JSON KV unit does not fit object-store write semantics, so pair this backend with a local `kv` backend (e.g. `json`) when a consumer needs both facets.

## Model Experience

No direct effect. The backend performs no IO visible to the model; it is the medium QZH evidence blobs (and any future blob consumer) land on when `storageBackend`/`evidenceBackend` names `s3`.

## Known Limitations and Deferred Work

- **`blob` only** — the `kv` facet is deliberately omitted. Object stores offer atomic whole-object replacement, not the read-modify-write a JSON unit snapshot wants; a caller that needs both points `kv` at a local backend and `blob` at `s3` (QZH exposes `storageBackend` for KV and `evidenceBackend` for blobs).
- **Static credentials or ambient chain** — credentials come from the standard AWS chain (env, shared config, IAM role) unless `accessKeyId`/`secretAccessKey` are set explicitly. There is no per-request credential rotation beyond what the SDK provider supplies.
- **No multipart/retry tuning** — large evidence blobs use the SDK's default `PutObject` path; multipart upload and retry policy are not configured per backend.
