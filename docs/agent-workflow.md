# 开发与交付流程

## 受管任务入口

工程管理统一使用仓库内的 `scripts/project-runtime.mjs`。入口先验证固定文件，再调用对应的 Harness、交付或资源命令。已有宿主 Node、Git、gh 用于管理，不安装宿主产品包。每个新任务使用新的不透明 session 键，延续同一任务时恢复原键：

```sh
node scripts/project-runtime.mjs verify
node scripts/project-runtime.mjs session --start --new-task \
  --project "$PWD" --host codex --session-id '<新的不透明键>' \
  --task-id '<任务ID>' --goal '<结果>' --acceptance '<可观察验收>' --delivery-required
node scripts/project-runtime.mjs delivery --start \
  --project "$PWD" --task-id '<任务ID>' --slug '<任务短名>'
```

先查实际项目入口、原工作区状态及 origin/HEAD。受管入口创建隔离工作区；不切换或覆盖已有并发工作。只读任务不建 worktree，用户明确仅本地的小改不自动发布。

`session`、`delivery`、`record`、`run`、`enforce`、`storage` 和 `lifecycle` 转发对应原命令的参数。`record` 对应 `harness-project.mjs`，记录实际验证结果时使用 `--record-outcome`。示例及参数可用各命令的 `--help` 查看，`lifecycle` 接收原 `status`、`preview`、`event` 等动作。`run` 只执行 Agent Map 已登记的 verifier。

固定模块来自 leon-engineering `0.19.4`，源提交为 `3913ddb9ac612760fb95bf8d8f7102f948c32d0f`，完整文件校验在 `scripts/vendor/leon-engineering/manifest.json`。入口核对精确文件集合及 SHA-256，拒绝可优先加载的未校验资源内核。校验依赖仓库文件，可以在没有全局 Leon runtime 和源码的 checkout 使用。版本更新走项目评审和回归。

## 实现、检查与评审

1. 读取改动及所属文档，声明权限、平台和验收。产品依赖与测试在 Docker；修改前不省略已有文件读取。
2. 在隔离分支实现，保留脱敏日志、错误码、恢复行为和目标测试。维护 [文档同步映射](documentation-governance.md)。
3. 实际运行相关回归和文档检查，记录时间、退出码和候选；macOS 宿主 / Docker 证据和 Linux CI 分开。
4. 独立评审会话读取精确 diff、规则和验证证据；不得由开发会话自签通过。修复后重新评审受影响内容。
5. 受管 `prepare` 生成合并候选；再验证该候选。默认分支前进或修复产生新提交时重新 prepare，不发布旧结果。

## PR、CI 与自动合并

本项目覆盖框架的直接推送默认：首次基线之后必须 PR。源分支为 `codex/`，目标从远端默认分支解析。必需状态为 `governance`、`offline-regression`、`independent-review`，还需讨论解决。独立代理必须读取精确 head 的代码和证据，发现全部处理后，发布该 head 的 independent-review 提交状态并关联真实评审回执；开发会话不得自签此状态。修订使旧 head 的状态失效。

发布前必须实查分支保护。用户已于 2026-11-04 将仓库改为 public，随后真实启用严格 CI、管理员约束、PR 入口和讨论解决，关闭强推与删除。先前私有套餐 403 是历史阻塞，不再作为当前阻塞。

受管控制器的 GitHub PR fallback 通过 `scripts/existing-pr-runner.mjs` 复用已有 PR，避免为同任务创建第二份。先将原 PR 源分支快进到已验证的 prepared integration commit，等待该 head 的 CI 和独立评审状态。适配器每次核对实际 PR、仓库、基线与精确 head，只接受受管 create/auto-merge 操作，合并加 `--match-head-commit`。受管控制器仍负责真实分支保护拒绝、PR 发布、远端 CI 与回执；不改写框架，不直接修改 receipt。管理调用器必须记录脱敏执行结果与错误。

独立评审状态由项目管理身份上传独立代理的真实评审结果，它不是另一 GitHub 账号的 APPROVED review。原生批准数为 0，服务器通过必需 independent-review 状态强制要求该结果；不能将作者自己的 COMMENT 冒充独立批准。后续引入第二位 GitHub 评审人时再提高批准数。

CI 成功不等于业务验收。合并后验证远端默认分支包含候选，按原始实测证据记录 Harness；完整交付必须通过 `node scripts/project-runtime.mjs enforce --project "$PWD" --task-id '<任务ID>' --require-delivery`，PR-only 受阻状态不能登记 completed/passed。

## 收尾与中断恢复

保留任务 ID、精确提交、受管 receipt、验证摘要和待办。只清理本任务已归并、干净、无进程占用的短期资源。未知 ignored 文件、未归并提交、其他 worktree、业务数据和恢复证据继续保护。资源欠账单独报告；不定时扫描清理，不做 prune，不清未知锁。

固定模块沿用 Git common directory 的 `leon-engineering/harness` 和 `leon-engineering/deliveries` 存储，以及原主机资源账本。已有任务以原 project、task ID 和 session ID 续接。旧 `.ai/harness` 可先用 `storage --preview` 检查，再按已有迁移合同处理。Codex 全局 Hooks 退役后，通过上述显式入口创建任务和记录结果，待补清资源通过受管交付或 `lifecycle event` 的原恢复事件处理。入口自身的脱敏日志写入 `SUPER_AGENT_LOG_ROOT` 或 `logs/project-runtime.jsonl`。

RWB 代办使用 RWB 自身入口及规则，最高交付 PR；不得调用可能合并的 `delivery --status`。真实任务操作另见 [验收手册](acceptance-runbook.md)。
