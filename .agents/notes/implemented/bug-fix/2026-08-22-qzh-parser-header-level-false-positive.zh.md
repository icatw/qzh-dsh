# Agent Note: 日志解析器把含级别词的表头误判为事件

状态：已实现

[English](2026-08-22-qzh-parser-header-level-false-positive.md) | 中文

## 问题

QZH 日志解析器把任何包含级别词的行都归类为 error 或 warn 事件，不区分级别词出现在行内哪个位置。`severityOf` 对整行执行 `\b(ERROR|WARN|...)\b` 匹配（`packages/client/ui-qzh-log-analysis/src/log-parser.ts`），因此像 `summary.txt` 的表头 `service status total debug info warn error first_time ...` 会产生幽灵聚类 `server:summary:error`。一次真实分析中，这个假聚类与真实的 `gorm slow query` 警告同时出现，证据摘要显示"2 类异常"而实际只有一条真实警告，agent 不得不在报告中解释这一产物。

## 决策

级别词只有在行被锚定时才算数：解析出时间戳时，级别词可以出现在任意位置；没有时间戳时，级别词必须位于行首（允许前置方括号标签）。`severityOf(line, hasTimestamp)` 现在把 error/warn 分支的门控设为 `hasTimestamp || LEVEL_AT_START.test(upper)`，其中 `LEVEL_AT_START` 匹配行首的 `ERROR|CRITICAL|EXCEPTION|TRACEBACK|WARN|WARNING`。`parseLogText` 只解析一次时间戳并传入。没有时间戳、仅在行中提及级别词的行（表头、字段列表）保持 `unknown` 并被既有过滤丢弃，而真正无时间戳的 `ERROR: ...` / `WARN ...` 行仍会产生事件。

## 备选方案

- **单独过滤表头样式的行** —— 拒绝：表头检测是叠加在级别判断之上的第二层启发式；锚定级别词是单一规则，能同时覆盖表头、字段列表和提及 "error" 的普通文本。
- **要求任何事件都必须有时间戳** —— 拒绝：真正的 Python 风格日志（`ERROR: boom`）没有时间戳，必须继续呈现。

## 后果

证据摘要不再因表头而虚构 error 聚类；聚类集合与读者在日志行中看到的内容一致。带时间戳的解析行为不变，无时间戳但确实以级别词开头的行仍然解析。由 `log-parser.client.spec.ts` 中的三个新用例覆盖（表头被忽略、无时间戳行首级别保留、带时间戳行中级别保留）。
