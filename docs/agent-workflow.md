# 开发与交付流程

## 当前项目开发授权

2026-11-22明确按与直接Codex相同的项目规则执行RWB开发，不增加文档-only或PR-only身份门。Native项目必须一次登记真实源码、工作树、规则/checks和项目受管命令；后续常规开发不逐任务重新授权。发布/自动合并仍由RWB原GitSafety、真实独评、必需CI、最新基线与分支保护决定；生产部署、数据库迁移和业务数据删除按具体任务授权，不从开发登记推定。

普通原根调用额度为20，旧计数和恢复原件保留。只有源码、回归、独评和Git交付通过后才进行受管运行源切换；App、宿主transport和登录恢复source pin必须一致。已结清原根的显式续接与长期项目登记见[运行手册](operations.md#20次预算及已完成原根续接)。

## 默认推进方式

实现→直接检查效果→交付，不采用防御式推进。小改只做相关检查并复用有效证据；没有真实问题不增加通用保护、审批、回执、恢复重演或新框架。错误直接更正，失败短记录足够，本任务无用途的可重建临时产物正常清理，不为保存错误副本阻断接续。真实业务权限、业务原件、其他任务及必要CI／分支保护仍按实际需求处理。

常规小改使用独立短期分支和PR，不默认新建Harness账本或额外验收项目。下列受管工具用于任务确实需要的状态跟踪、复杂交付或真实中断恢复，不是每次修改／清理的附加前置门。

## 按需使用现有受管入口

需要受管账本时使用仓库内的`project-runtime.mjs`，不另建框架；已有任务沿原身份接续，不靠新任务清零历史。下面是显式选择该工具时的示例，不要求普通小改机械执行全套：

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

1. 读取已有文件和相关约束，直接在短期分支实现；依赖或平台确实需要时才用Docker。
2. 运行与本次改动直接相关的效果检查，失败就修复，已有有效结果不重复跑；同步必要文档。
3. 按原PR和必要CI／独评／分支保护交付。需要受管候选时使用已有`prepare`；源变化只复核受影响部分，不因新提交机械重跑全部检查。

## PR、CI 与自动合并

本项目覆盖框架的直接推送默认：首次基线之后必须 PR。源分支为 `codex/`，目标从远端默认分支解析。必需状态为 `governance`、`offline-regression`、`independent-review`，还需讨论解决。独立代理必须读取精确 head 的代码和证据，发现全部处理后，发布该 head 的 independent-review 提交状态并关联真实评审回执；开发会话不得自签此状态。修订使旧 head 的状态失效。

发布前必须实查分支保护。用户已于 2026-11-04 将仓库改为 public，随后真实启用严格 CI、管理员约束、PR 入口和讨论解决，关闭强推与删除。先前私有套餐 403 是历史阻塞，不再作为当前阻塞。

受管控制器的 GitHub PR fallback 通过 `scripts/existing-pr-runner.mjs` 复用已有 PR，避免为同任务创建第二份。先将原 PR 源分支快进到已验证的 prepared integration commit，等待该 head 的 CI 和独立评审状态。适配器每次核对实际 PR、仓库、基线与精确 head，只接受受管 create/auto-merge 操作，合并加 `--match-head-commit`。受管控制器仍负责真实分支保护拒绝、PR 发布、远端 CI 与回执；不改写框架，不直接修改 receipt。管理调用器必须记录脱敏执行结果与错误。

独立评审状态由项目管理身份上传独立代理的真实评审结果，它不是另一 GitHub 账号的 APPROVED review。原生批准数为 0，服务器通过必需 independent-review 状态强制要求该结果；不能将作者自己的 COMMENT 冒充独立批准。后续引入第二位 GitHub 评审人时再提高批准数。

`node scripts/project-runtime.mjs delivery --status` 核对 PR 地址、候选 SHA 和目标分支，兼容 `CheckRun.conclusion` 与 `StatusContext.state`，并将原始检查保存在受管回执。PR 合并、有合并 SHA 且三个必需状态都成功后才记为通过。失败检查记为失败，缺失、未完成或未知检查继续等待。查询失败或身份不匹配时保留原回执并报告错误。

CI成功不冒称业务验收。源码交付按真实PR合并、相关检查和必要评审记录完成；资源清理延期单列，不否定已完成的源码交付。`enforce --require-delivery`只在任务确实要求完整生命周期且适用时使用，不为小改或临时产物强制增加一轮大验收、备份和账本工程。

## 收尾与中断恢复

保留必要的任务／提交／结果摘要和待办。本任务已无用途的临时或失败产物正常清理，不默认保留完整失败树、逐文件hash或重复副本；错误状态直接更正，不伪改真实失败。业务原件、其他工作树、未归并工作及当前恢复或排障确有需要的材料继续保护，不无差别prune或清未知锁。

固定模块沿用 Git common directory 的 `leon-engineering/harness` 和 `leon-engineering/deliveries` 存储，以及原主机资源账本。已有任务以原 project、task ID 和 session ID 续接。旧 `.ai/harness` 可先用 `storage --preview` 检查，再按已有迁移合同处理。Codex 全局 Hooks 退役后，通过上述显式入口创建任务和记录结果，待补清资源通过受管交付或 `lifecycle event` 的原恢复事件处理。入口自身的脱敏日志写入 `SUPER_AGENT_LOG_ROOT` 或 `logs/project-runtime.jsonl`。

RWB代办使用RWB自身入口及规则；长期开发登记允许时，可在真实独评、必需CI与分支保护通过后调用原`delivery --status`自动合并及受管收尾。本人本次已授权的历史有效改动，按[持续迭代](agent-iteration.md)核对原任务/分支/PR及依赖批次；只有可信Native项目为该原任务登记的DevOps `host.rwb_release`操作可以消费合并/部署例外，不全局提高RWB默认上限。共享发布窗口先取得原持有者的安全交接，RWB自身验证、独评、CI、恢复及验收条件仍全部适用。真实任务操作另见[验收手册](acceptance-runbook.md)。

## 组合交付对账与收尾

当子任务尚为 started，而其原提交已由另一个受管任务的组合 PR 保留并合入，使用项目 scripts/reconcile-merged-delivery.mjs 只读预览；不要直接改 receipt。参数固定项目、子/父 task、完整 feature SHA、PR number、完整 PR head 和 merge SHA，以及原 WorkDisk delivery 根。脚本不安装产品依赖或调用模型，也不接管任何运行实例。

应用前保留精确源码评审、真实 PR/CI/保护及源归属证据，并确认本任务授权。dry-run 的 receiptSha256 必须通过 --expect-receipt-sha256 原样绑定，--apply 是显式写入门；没有该开关不写状态或创建路径。占用尚未自然释放时仅等待，不使用 TTL 猜空闲，不重启 Docker 或强删。真实对账只创建子任务自己的 integration alias、不可覆盖的 intent 证据、ci_passed 回执和审计事件；父回执保持不变。父验证通过记录作为来源引用，不谎称重新执行了其测试。

发生部分 Git 写入、回执漂移或未知结果时保留 intent、原回执和已创建资源，禁止自动重试、另起名字或消除锁。先对照同一 operation 的真实 Git/回执现场；未核清不能再次 apply。完成对账后仍由固定 project-runtime.mjs delivery --status/--cleanup 及 enforce --require-delivery 执行真实门禁。回收前重查源和 integration alias 的进程、容器引用及未知文件；对账本身不删除工作树、分支或远端资源。

在已获本人明确授权区分只读VM缓存的任务中，可以加 --allow-readonly-vm-cache。该选项只排除已核实的系统Virtualization进程、每个源FD均为只读、且无容器源引用的缓存；不得据进程名称、等待时长或容器停止推定安全。dry-run与真实adoption记录保留实际PID及分类。后续仍执行普通Git/controller cleanup，不使用force或重启Docker。未获此授权时继续原自然释放条件。
