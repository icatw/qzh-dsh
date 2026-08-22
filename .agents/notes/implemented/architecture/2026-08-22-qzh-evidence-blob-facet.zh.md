# Agent Note: 证据归档迁移到 storage `blob` facet

状态：已实现

[English](2026-08-22-qzh-evidence-blob-facet.md) | 中文

## 问题

QZH 证据持久化硬编码为本地目录：`uploadEvidenceArchive` 解压到 `<evidenceRoot>/<caseId>/files/<category>/`，原始 zip 存旁边，`listEvidenceTree` / `searchEvidence` / `readEvidenceRange` 直接经 `node:fs` 读文件系统。这把宿主绑定到单机磁盘：公网、多副本或容器化部署在重调度时会丢失证据，且无法跨副本共享。代码镜像此前已脱离 checkout（`git grep` / `git show` 按 ref 访问）；证据是最后一个仍钉在本地目录的东西。

## 决策

storage hub 在 `kv` 之外新增第二个数据形态 facet：`BlobFacet`（`packages/storage/storage/src/backend.ts`），提供 `put` / `get` / `getRange` / `stat` / `list` / `delete`，作用于相对、路径形状的 key（`a/b/c`，无前导 `/`，无 `.`/`..`，无空段，无反斜杠或 NUL）。`StorageBackend` 携带 `blob?: BlobFacet`；backend 实现其能服务的 facet，请求缺失 facet 时失败即告警。`json` backend 把 `blob` 实现为 `<root>/blobs/` 下每个 key 一个文件（`packages/storage/storage-json/src/blob.ts`），于是本地目录介质成为对象存储，与未来 S3 兼容 backend 实现同一契约。

QZH 证据迁移到其上：文件为 `blob.put(<caseId>/files/<category>/<relpath>)`，归档为 `blob.put(<caseId>/archive-<category>.zip)` 最后写入作为发布标记，案例记录在所有 blob 落地后才翻转。`listEvidenceTree` / `searchEvidence` 用 `blob.list(<caseId>/files/)`，`readEvidenceRange` 和 `downloadEvidenceArchive` 用 `blob.get`（带 `stat` 大小上限），首行样例用 `blob.getRange`。`evidenceRoot` 配置字段移除；`storageBackend` 现在命名同时持有 `qzh_cases` KV 单元与证据 blob 的 backend。

## 备选方案

- **保留本地目录，之后再抽象** —— 拒绝：目录路径正是公网部署不能固化的耦合，且代码镜像已按 ref 只读，抽象成本现在很低。
- **复用 `kv` 存证据** —— 拒绝：归档与日志是可达数十 MB 的二进制 blob，塞进 JSON 快照 KV 单元会违背该 backend 的整文件重写模型。
- **专用证据服务接口而非 storage facet** —— 拒绝：证据就是带路径形状 key 的字节；通用 `blob` facet 可服务它以及任何未来消费者，无需 QZH 专用缝。

## 后果

证据现在与案例走同一条 `storageBackend` 路由，一次 backend 选择即可同时迁移两者。上传中途失败会留下孤儿文件 blob，它们在归档 blob 与案例记录一致前不可见，因此重试幂等。围栏从目录的 `realpath`/`isWithin` 移到 facet 的 `validateBlobKey`：key 从构造上就无法逃逸介质。本地 `~/.dsh/qzh-evidence/` 目录废弃；新证据落在 storage backend 的 `blobs/` 子树下。
