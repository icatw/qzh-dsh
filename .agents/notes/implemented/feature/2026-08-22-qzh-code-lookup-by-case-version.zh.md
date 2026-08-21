# Agent Note: QZH 代码检索按案例版本（git ref）固定分析对象

状态：已实现

[English](2026-08-22-qzh-code-lookup-by-case-version.md) | 中文

## 问题

QZH 代码分析读取的是 mirror 已 checkout 的工作区：`searchCode` 在 checkout 上跑 ripgrep，`readCode` 从磁盘读文件，`currentCommit` 报告 `rev-parse HEAD`。每个会话都分析"当前 checkout 的版本"，来自更旧或更新版本的日志被拿去与错误的源码对照。而通过切换 checkout 来服务其他版本不可行：mirror 是单个 1.8 GB 仓库，被几十个 Codex/Claude worktree 共享，在主 worktree 上执行 `git checkout` 会破坏所有并发使用者的工作树。

## 决策

代码检索不再触碰工作树。每个案例通过其 `productVersion` 字段固定源码版本，该字段在 mirror 中命名一个 git tag（或任意 ref）：

- `searchCode` 对提交树执行 `git grep -n --fixed-strings <query> <commit>`。
- `readCode` 执行 `git show <commit>:<path>`，从提交 blob 中切片行。
- `resolveRef(root, record)` 用 `git rev-parse --verify '<version>^{commit}'` 解析 `productVersion`；未提供版本时回退到 checkout HEAD（原行为）。
- 每个结果都返回解析后的 commit，报告引用的是被分析的确切版本。

`git grep <rev>` 给每个匹配行加的 rev 前缀（`<rev>:path:line:text`）在解析前被剥离。`readCode` 的大小上限改为测量收集到的 stdout 文本而非 stat。`repositoryRoot` 现在与 mirror root 的 `realpath` 结果比较，修复了配置路径经过符号链接（如 macOS 的 `/var` → `/private/var`）时误报"超出配置的 mirror root"的问题。

## 备选方案

- **每个案例用 token 从 GitLab 拉取** —— 拒绝：仓库 1.8 GB，DSH 沙箱无出网能力，token 会泄漏进会话/subprocess 环境，且存在两个 GitLab 源、无单一权威。本地 mirror 是唯一可达所有 tag 的来源。
- **按版本增加 worktree** —— 拒绝：`git grep`/`git show` 直接读对象库、无工作树状态，因此无需 worktree 记账、无需 checkout，也不会干扰既有的几十个 worktree。

## 后果

并发会话可以同时分析不同版本且无代码冲突：每次检索都是对共享对象库的一次读，git 保证并发读安全。`git fetch --tags`（追加对象、原子更新 refs）是唯一的写操作，读者永远不会观察到撕裂的 ref。版本→commit 映射就是 mirror 自身的 tag，无需外部 manifest。终端仓库尚未接入；它们加入 mirror 后同一机制适用。
