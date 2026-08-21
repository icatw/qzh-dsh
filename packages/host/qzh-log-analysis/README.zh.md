# @deepseek-ai/dsh-host-qzh-log-analysis

[English](README.md) | 中文

DSH Web 的 Host 侧 QZH 案例 Remote API、只读 Git mirror 和分析 Agent 接入包。它复用 DSH Typert Gateway、Agent Loop、LLM seam、工具注册和 `ctx.subprocess`，不会向浏览器暴露通用 Shell 或可写工作区。

## 模型体验

通过 DSH Agent Loop 间接呈现；Agent Loop 消费本包注册的 QZH 工具和排查方法论。

#### KV Cache 影响

分析报告和工具调用进入 DSH Session，复用 DSH 的上下文与缓存生命周期；QZH 插件只追加当前案例证据和只读工具。

## 已知限制与暂缓事项

- **案例暂存于内存**：第一版只在 Host 进程内保存案例元数据，持久化案例库和报告存储后续实现。
- **必须配置 mirror**：只有设置 `QZH_MIRROR_ROOT` 时 Web profile 才加载本包；目录下必须有 `server/`、`terminal/`，需要 legacy 对照时再提供 `legacy/` Git checkout。
- **只读源码面**：搜索和有限读取都会校验路径包含关系，不提供源码写入或任意命令执行。
- **证据会二次脱敏**：Host 会规范化 `/data/logs` 路径、限制元数据大小，并在保存摘要前遮盖常见 Authorization、Cookie、Token、密码、Secret 和私钥模式。
- **分析工具受限**：分析 Agent 通过 agent-scoped `ctx.tools.restrict({ allow: [...] })` 只看到三个 QZH 只读工具，不继承通用 Shell、编辑器或 Git 写操作。
- **LLM 配置复用 DSH**：默认使用 `deepseek-official` / `deepseek-v4-flash`，可通过 Host 配置切换到已注册的 OpenAI-compatible provider；未配置 Provider 时案例会保留失败原因。
