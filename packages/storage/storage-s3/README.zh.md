# @deepseek-ai/dsh-storage-s3

[English](README.md) | 中文

[存储中心](../storage/README.md)的 S3 兼容后端：`blob` 分面上的二进制对象以 S3 对象形式存储在配置前缀下，注册为后端 `s3`。它只服务 `blob`——整快照 JSON KV 单元不符合对象存储的写语义，因此需要两个分面的消费者应将 `kv` 指向本地后端（如 `json`），将 `blob` 指向 `s3`。

## 模型体验

无直接影响。后端不执行模型可见的 IO；当 `storageBackend`/`evidenceBackend` 指向 `s3` 时，它是 QZH 证据 blob（以及未来任何 blob 消费者）落盘的介质。

## 已知限制与暂缓事项

- **仅 `blob`** —— 有意省略 `kv` 分面。对象存储提供原子整对象替换，而非 JSON 单元快照所需的读-改-写；需要两个分面的调用方把 `kv` 指向本地后端、`blob` 指向 `s3`（QZH 暴露 `storageBackend` 用于 KV、`evidenceBackend` 用于 blob）。
- **静态凭证或环境链** —— 凭证来自标准 AWS 链（环境变量、共享配置、IAM 角色），除非显式设置 `accessKeyId`/`secretAccessKey`。除 SDK provider 提供的外，没有按请求的凭证轮换。
- **无分片/重试调优** —— 大证据 blob 走 SDK 默认的 `PutObject` 路径；分片上传与重试策略未按后端配置。
