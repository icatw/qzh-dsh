# @deepseek-ai/dsh-host-qzh-log-analysis

[English](README.md) | 中文

DSH Web 的 Host 侧 QZH 案例 Remote API、只读 Git mirror 和当前会话分析接入包。它复用 DSH Typert Gateway、Agent Loop、LLM seam、工具注册和 `ctx.subprocess`，不会向浏览器暴露通用 Shell 或可写工作区。

## 模型体验

通过 DSH Agent Loop 间接呈现；Agent Loop 消费本包注册的 QZH 工具和排查方法论。面向模型的工具包括：`qzh_list_evidence`（列出证据包内完整文件清单、每个文件的首行样例与异常聚类，先摸清现场日志布局再定位）、`qzh_get_current_case`（当前案例视图）、`qzh_search_code` 与 `qzh_read_code`（只读源码 mirror）。排查方法论要求 Agent 以实际目录结构为准、不假设固定日志布局，浏览器提供的组件标签仅作为初始推断，报告引用必须使用证据包内的真实相对路径。

#### KV Cache 影响

分析报告和工具调用进入 DSH Session，复用 DSH 的上下文与缓存生命周期；QZH 插件只追加当前案例证据和只读工具。

## 已知限制与暂缓事项

- **案例暂存于内存**：第一版只在 Host 进程内保存案例元数据，持久化案例库和报告存储后续实现。
- **必须配置 mirror**：只有设置 `QZH_MIRROR_ROOT` 时 Web profile 才加载本包；可配置包含 `server/` 的目录，也可直接配置该 QZH Git checkout（当前为 `https://git.in.chaitin.net/cyberserval/qzh`）。
- **只读源码面**：搜索和有限读取都会校验路径包含关系，不提供源码写入或任意命令执行。
- **证据会二次脱敏**：Host 会规范化压缩包内相对路径、限制元数据大小，并在保存摘要前遮盖常见 Authorization、Cookie、Token、密码、Secret 和私钥模式；每个文件的首行布局样例同样会脱敏并限制在 512 字符内。每个文件和聚类都带 `category`（`server`/`terminal`），非 `terminal` 一律归为 `server`。
- **报告反馈**：`setFeedback(sessionId, caseId, kind, comment?)` 记录 `like`/`dislike` 与可选备注，校验案例归属和 kind 后写回案例；反馈暂存于内存案例。
- **当前会话分析**：`startAnalysis(sessionId, caseId)` 只接受案例所属的 live Agent，并通过 `Agent.followup()` 把分析请求追加到当前 QZH 会话；面向模型的工具会从当前 session 解析最近案例，Host 不创建独立分析会话。
- **模型锁定**：`qzh` preset 的模型切换由 API 层拒绝，模型路由和 DeepSeek/OpenAI-compatible 配置继续由 DSH Host 统一管理。
