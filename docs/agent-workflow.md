# 开发与交付流程

## 受管任务入口

复用已安装的 leon-engineering。已有宿主 Node、Git、gh 用于管理，不安装宿主产品包。每个新任务使用新的不透明 session 键，延续同一任务时恢复原键：

```sh
node "$HOME/.agents/leon-engineering/runtime/harness-runtime.mjs" --verify
node "$HOME/.agents/leon-engineering/runtime/harness-session.mjs" --start --new-task \
  --project "$PWD" --host codex --session-id '<新的不透明键>' \
  --task-id '<任务ID>' --goal '<结果>' --acceptance '<可观察验收>' --delivery-required
node "$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs" --start \
  --project "$PWD" --task-id '<任务ID>' --slug '<任务短名>'
```

先查实际项目入口、原工作区状态及 origin/HEAD。受管入口创建隔离工作区；不切换或覆盖已有并发工作。只读任务不建 worktree，用户明确仅本地的小改不自动发布。

## 实现、检查与评审

1. 读取改动及所属文档，声明权限、平台和验收。产品依赖与测试在 Docker；修改前不省略已有文件读取。
2. 在隔离分支实现，保留脱敏日志、错误码、恢复行为和目标测试。维护 [文档同步映射](documentation-governance.md)。
3. 实际运行相关回归和文档检查，记录时间、退出码和候选；macOS 宿主 / Docker 证据和 Linux CI 分开。
4. 独立评审会话读取精确 diff、规则和验证证据；不得由开发会话自签通过。修复后重新评审受影响内容。
5. 受管 `prepare` 生成合并候选；再验证该候选。默认分支前进或修复产生新提交时重新 prepare，不发布旧结果。

## PR、CI 与自动合并

本项目覆盖框架的直接推送默认：首次基线之后必须 PR。源分支为 `codex/`，目标从远端默认分支解析。必需检查为 `governance`、`offline-regression`，还需独立评审及讨论解决。

发布前必须实查分支保护。当前 GitHub 私有仓库保护返回套餐限制，**不得运行会直推的 `publish` 或自动合并**。可推送任务分支、建立 PR、运行 CI，交付状态保留阻断。保护恢复后再核对控制器是否支持 PR 路由；若没有该能力，保持阻断，不修改框架或伪造 receipt 来绕过。

CI 成功不等于业务验收。合并后验证远端默认分支包含候选，按原始实测证据记录 Harness；完整交付必须通过 `harness-enforce.mjs --require-delivery`，PR-only 受阻状态不能登记 completed/passed。

## 收尾与中断恢复

保留任务 ID、精确提交、受管 receipt、验证摘要和待办。只清理本任务已归并、干净、无进程占用的短期资源。未知 ignored 文件、未归并提交、其他 worktree、业务数据和恢复证据继续保护。资源欠账单独报告；不定时扫描清理，不做 prune，不清未知锁。

RWB 代办使用 RWB 自身入口及规则，最高交付 PR；不得调用可能合并的 `delivery --status`。真实任务操作另见 [验收手册](acceptance-runbook.md)。
