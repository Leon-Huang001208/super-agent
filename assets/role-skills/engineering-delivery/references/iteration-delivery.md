# Iteration Delivery

Classify work before invoking the controller:

- Read-only fast path: inspect directly and do not create a worktree.
- Narrow local edit: only when it is local, reversible, conflict-free, and has no public API/schema, dependency, CI, database, security, desktop, or cross-platform impact. Run focused local verification, record the Harness result without delivery flags, and do not publish or invent a remote receipt.
- Medium/high-risk isolated implementation: use an isolated worktree, but do not publish unless the task reaches the full-delivery tier.
- Explicitly authorized full delivery: after verifying the project permits the controller’s publish route, use the managed controller at `$HOME/.agents/leon-engineering/runtime/iteration-delivery.mjs` and the full lifecycle `start` → implement/commit → `prepare` → merged-result verification → `publish` → status/CI → `cleanup`.

Only the full-delivery tier starts Harness with `--delivery-required` and finishes with `harness-enforce.mjs --require-delivery`. Explicit publication or impact to public contracts, schema, dependencies, CI, databases, security, desktop/cross-platform behavior, or concurrent work requires this tier. When uncertain, upgrade the tier.

Resolve the default branch from `origin/HEAD`; never assume `main` or `master`. Require explicit current-task authorization for the remote action and honor the project’s publish route. The legacy controller can try a direct push before falling back to a PR; use it only when that behavior is explicitly authorized. For a PR-only route use the project’s PR flow. Merge, auto-merge, revert, and cleanup each require their applicable authorization and verification.

Do not publish an explicit `no-push`, local-only, draft, research, review, or read-only task. Project instructions and platform gates remain authoritative. Secrets, new dependencies, releases, migrations, and other separately controlled actions still require their own authorization.

If the remote default branch advances before publication, call `prepare` again. The controller preserves the stale integration commit in ancestry, rebuilds from the new remote base, and requires merged-result verification again. If a merge conflicts, resolve and commit it in the preserved integration worktree, then call `prepare` again before verification and publication.

若审核发生在 `prepare` 之后、发布之前，并且功能分支新增了修复提交，使用 `--prepare --replace-prepared` 取代旧 prepared revision，不要先发布旧结果。控制器只在 receipt 仍为 `prepared`、功能与集成 worktree 均干净、功能 HEAD 已变化、远端默认分支仍等于原基线、旧集成提交未进入远端、且没有 CI run、PR 或发布元数据时允许替换。所有检查完成前不移动 receipt 或 worktree；成功后把旧 branch/worktree/commit 以 `status: "superseded"` 写入 `integrationHistory`，非强制移除旧集成 worktree，并要求对新 revision 重新验证。任一条件失败都保留旧 prepared 状态。

CI failures may receive at most three evidence-based repair commits through `publish --repair`. After the third failure, use `rollback` only when the remote default tip is still exclusively owned by this delivery and the reverted result has passed verification. Otherwise preserve the branch and worktree and report the blocker.

Run `cleanup` only after CI is `passed` or explicitly `not_configured`. Cleanup refuses dirty worktrees, confirms the integration commit is in the remote default branch, removes managed worktrees, and deletes local and remote task branches. Never force-push, force-remove a dirty worktree, or force-delete an unmerged branch.

The full-delivery hard gate reads the real receipt and verifies the live remote default branch, CI, local branch, and worktree state; Harness itself does not run Git.

启用事件驱动资源清理后（源码权威文档`docs/resource-lifecycle.md`），临时产物在写入完成时登记到本任务，交付与部署分别退休。缓存共用宿主20GiB预算；成功原始日志只留有界摘要。清理欠账不等于cleaned，不为清理再复制永久备份。存量先核对并逐类批准；特殊修复备份继续保护。没有定时任务，也不把合并成功当成部署成功。
