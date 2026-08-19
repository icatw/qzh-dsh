# Agent Note: dsh plugin 在被阻止构建脚本的安装失败时打印 pnpm allowBuilds 的修改指引

Status: implemented

[English](2026-08-19-cli-plugin-allowbuilds-guidance.md) | 中文

## 问题

`dsh plugin add` 安装依赖链包含原生模块的 registry 插件（例如依赖 `node-pty` 的 `dsh-better-sidebar`）时，在 pnpm ≥11 下会失败：`strictDepBuilds` 默认阻止依赖的构建脚本，pnpm 以 `ERR_PNPM_IGNORED_BUILDS` 退出，且其唯一提示是可交互的 `pnpm approve-builds`，而脚本化的 profile 安装无法运行它。失败前 pnpm 会在 profile 的 `pnpm-workspace.yaml` 写入 `allowBuilds: { <name>: set this to true or false }`——这个占位值只有字面量布尔才满足，因此不改动直接重跑会以同样方式失败。CLI 此前的指引只针对 git 托管 spec，registry 插件只会看到 `dsh: pnpm failed in profile directory <dir>`。

## 决策

安装失败时，CLI 读取 profile 的 `pnpm-workspace.yaml`，若其中包含 pnpm 的占位条目，则打印精确的修改指引：把列出的每个名称在 `allowBuilds` 下设为 `true`，然后重跑。针对 git 托管 spec 的提示仍保留，作为 git prepare 脚本被阻止时的兜底。

## 考虑过的替代方案

**扫描捕获到的 pnpm 输出中的错误标记。** `ERR_PNPM_IGNORED_BUILDS` 文本输出在 stdout 上，检测它需要缓冲 pnpm 的输出，从而丢失当前转发器继承的实时进度；pnpm 自己写入 `pnpm-workspace.yaml` 的占位符携带相同信号，且无需改动输出流。

**自动放行被阻止的脚本。** 静默执行依赖构建脚本会破坏 pnpm 的安全默认，并让用户感到意外。

**以非交互方式运行 `pnpm approve-builds`。** pnpm ≥11 在没有 TTY 时无法交互；它只会重写占位符。

## 后果

依赖链包含原生模块的 registry 插件现在会以可操作的提示失败，明确指出文件名与应填的值，与 pnpm 自己记录的内容一致。提示来源于 pnpm 写入的文件，因此在保持占位符格式的 pnpm 版本间保持准确。输出流不变：pnpm 仍直接写往终端。
