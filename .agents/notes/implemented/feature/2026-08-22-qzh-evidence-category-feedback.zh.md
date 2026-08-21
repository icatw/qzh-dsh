# Agent Note: QZH 多端证据与报告反馈

Status: implemented

[English](2026-08-22-qzh-evidence-category-feedback.md) | 中文

## 问题

QZH 工作台把导入的日志放进一个不区分的列表。现场人员收集的始终是两端不同的日志——服务端日志（`qzh_web_agent`、`qzh_log_center`）和被管终端的终端日志（`qzh_agent`、`qzh_agent_flush`）——报告在关联跨机时间线时必须把两端分开。同时缺少记录诊断是否真正有用的手段，无法度量质量或反哺分析流程。

## 决定

导入证据带 `category`（`server` | `terminal`），由工程师使用的导入区决定，而不是从文件名推断。浏览器空白态 Hero 现在渲染两个上传区（服务端 / 终端），各自有目录选择、ZIP 选择和拖拽区；每个 `ImportedLogEntry` 和 `ParsedLogEvent` 都携带 category，`clusterLogErrors` 把 category 纳入聚类 key，使两端相同的错误文本保持独立。证据摘要按文件和聚类分别提交 category，Host 通过 `ensureCategory` 二次校验（任何非 `terminal` 值归为 `server`），证据表格渲染两端徽标。

已完成的案例通过新的 `setFeedback(sessionId, caseId, kind, comment?)` Remote 接受一次用户裁决：`like` 或 `dislike`，可附备注。Host 校验案例归属和 kind，裁剪并限制备注长度；不带备注重新提交会清空旧备注。反馈存在内存案例视图上（持久化案例仍暂缓），报告卡片在 `completed` 后渲染“有效 / 踩”控件。

## 备选方案

- **从文件名推断 category**——否决：文件名只是浏览器的尽力标签，错标的压缩包会静默归错端；上传区才是工程师的明确意图。
- **单一上传区 + 每个文件单独切换端别**——否决：两个上传区匹配现场工作流，也让外发确认审查更清晰。
- **反馈只用自由文本**——否决：结构化的 `like`/`dislike` 便于质量聚合；可选备注在不强制的情况下保留原因。

## 后果

跨机分析能从端到端区分服务端与终端证据，两端不会在错误聚类中混并。报告质量通过裁决变得可度量，代价是证据载荷略大、案例多一个字段。案例现在可持久化：每次变更都通过 `ctx.storage` 的 kv 后端（`qzh_cases` 单元，默认 `json` 后端，`storageBackend` 可配置）写入，重启后首次访问时恢复；storage 不可用时降级为内存运行并警告一次。反馈随案例持久化；聚合质量看板和通知事件仍是后续工作。

## 相关

基于 `2026-08-22-qzh-evidence-layout.md`（布局规则、逐文件样例、`qzh_list_evidence`）；工作台与详情栏集成见 `2026-08-21-qzh-details-panel.md`。持久化案例库是走向共享案例检索和角色可见性的第一步。
