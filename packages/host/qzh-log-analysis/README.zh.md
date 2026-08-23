# @deepseek-ai/dsh-host-qzh-log-analysis

[English](README.md) | 中文

DSH Web 的 Host 侧 QZH 案例 Remote API、只读 Git mirror 和当前会话分析接入包。它复用 DSH Typert Gateway、Agent Loop、LLM seam、工具注册和 `ctx.subprocess`，不会向浏览器暴露通用 Shell 或可写工作区。

## 模型体验

通过 DSH Agent Loop 间接呈现；Agent Loop 消费本包注册的 QZH 工具和排查方法论。面向模型的工具包括：`qzh_list_evidence`（列出证据包内完整文件清单、每个文件的首行样例与异常聚类，先摸清现场日志布局再定位）、`qzh_get_current_case`（当前案例视图）、`qzh_search_code` 与 `qzh_read_code`（只读源码 mirror）。排查方法论要求 Agent 以实际目录结构为准、不假设固定日志布局，浏览器提供的组件标签仅作为初始推断，报告引用必须使用证据包内的真实相对路径。

#### KV Cache 影响

分析报告和工具调用进入 DSH Session，复用 DSH 的上下文与缓存生命周期；QZH 插件只追加当前案例证据和只读工具。

## 已知限制与暂缓事项

- **案例持久化**：案例通过 `ctx.storage` 的 kv 后端（默认 `json`，`storageBackend` 可配置）持久化到 `qzh_cases` 单元，启动后首次访问时自动恢复；storage 服务或后端不可用时降级为纯内存案例并警告一次。报告反馈同样随案例持久化。`evidenceBackend`（默认同 `storageBackend`）命名持有各案例证据 blob 的后端，因此公网部署可让 KV 留在本地（`json`）、证据落到 `s3`。
- **完整日志归档**：`uploadEvidenceArchive` 把原始 zip 与解压树以二进制对象存到 `evidenceBackend` 后端的 `blob` 分面（默认 `json`，可用 `s3` 指向 S3 兼容对象存储），key 为 `<caseId>/archive-<category>.zip` 与 `<caseId>/files/<category>/<relpath>`。解压会校验每个条目路径、拒绝非文件/符号链接、限制归档/文件/文件数大小，并以归档 blob 最后写入作为持久化标记；同一端别的二次上传被拒绝。`qzh_list_logs` / `qzh_search_logs` / `qzh_read_log_range` 只通过服务读取（校验归属与 key 围栏）并对每段摘录脱敏。未上传归档时，摘要仍是持久化回退。
- **必须配置 mirror**：只有设置 `QZH_MIRROR_ROOT` 时 Web profile 才加载本包；它指向服务端 Git 对象库（checkout 或裸仓库，其 tag/commit 能被 `git show`/`git grep` 命中，不使用工作树）。公网部署时这是持久 clone 并用 `git fetch --tags` 刷新，绝非单机 checkout。
- **只读源码面**：搜索和有限读取都会校验路径包含关系，不提供源码写入或任意命令执行。
- **证据会二次脱敏**：Host 会规范化压缩包内相对路径、限制元数据大小，并在保存摘要前遮盖常见 Authorization、Cookie、Token、密码、Secret 和私钥模式；每个文件的首行布局样例同样会脱敏并限制在 512 字符内。每个文件和聚类都带 `category`（`server`/`terminal`），非 `terminal` 一律归为 `server`。
- **报告反馈**：`setFeedback(sessionId, caseId, kind, comment?)` 记录 `like`/`dislike` 与可选备注，校验案例归属和 kind 后写回案例；反馈暂存于内存案例。
- **当前会话分析**：`startAnalysis(sessionId, caseId)` 只接受案例所属的 live Agent，并通过 `Agent.followup()` 把分析请求追加到当前 QZH 会话；面向模型的工具会从当前 session 解析最近案例，Host 不创建独立分析会话。
- **模型锁定**：`qzh` preset 的模型切换由 API 层拒绝，模型路由和 DeepSeek/OpenAI-compatible 配置继续由 DSH Host 统一管理。
