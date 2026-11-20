# 开发地图

| 子系统 | 本仓库入口 | 维护与验证 |
|---|---|---|
| 可编辑角色指令 | `bridge/role-instruction-store.mjs`、`docker/role-instruction-hook.mjs`、`scripts/migrate-role-instructions.mjs` | 原生Managed目录、保存与登记同步、旧内容保留、失败恢复；`role-instruction-*.test.mjs`覆盖迁移、保存和实际安装源码装配。运行前仍需本人窗口内的实际迁移与认证网页读回。 |
| 原生角色调用门 | `docker/role-codex-gate.mjs`、`docker/bin/codex` | 精确Native运行许可、单次claim、原订阅与Docker隔离全工具执行。旧hello/Chief入口继续独立；工具逐项结果见本轮设计。 |
| 角色阶段收尾 | `bridge/role-native-settlement.mjs` | Native事务绑定原输入与run，保存最终回复后交回本人待接手，防止缺失disposition的自动修复；真实合同待验收。 |
| Research / PM 必需材料 | `bridge/role-materials.mjs`、`bridge/role-preparation.mjs`、`bridge/native-role-adapter.mjs` | 部署清单、摘要、引用和目录链预检；项目及角色私有知识按版本读取。已接原生执行器；Research真实来源报告已产生，PM和工具全项仍待验收。见[本轮设计与现场核查](plans/research-pm-m1.md)。 |
| 容器与存储 | `compose.yaml`、`docker/Dockerfile.runtime`、`scripts/sa` | 专用 APFS、只读根、固定镜像、日志和缺盘拒绝；Docker 回归 |
| 镜像复用与退役 | `scripts/runtime-image.mjs`、`scripts/runtime-image-closeout.mjs`、`scripts/runtime-image-closeout-docker.mjs` | `image-build` 按完整 ID、内容指纹和用途标签复用，`image-audit` 只读清点。`image-closeout` 保护被容器、启动配置和用途标签引用的镜像，允许按 ID 核对退役的无标签登记项。离线夹具覆盖标签移除、漂移、轮换和归档验证，见 `tests/runtime-image.test.mjs`、`tests/runtime-image-closeout.test.mjs`、`tests/runtime-image-closeout-docker.test.mjs`。 |
| 依赖与候选 | `docker/package*.json`、`evaluation/candidate.json` | 固定版本与完整性；候选校验不等于安装或业务验收 |
| 订阅 hello | `docker/bin/codex`、`docker/codex-hello-gate.mjs` | 单次许可、只读、无回退、进程终止与审计；不能充当业务执行器 |
| 网关与初始化 | `docker/gateway.mjs`、`docker/bootstrap*.mjs`、`docker/server-entry.mjs` | 精确 Origin、秘密不回显、启动校验及错误传播 |
| 预检与日志 | `scripts/paperclip-preflight.mjs`、`scripts/redact-logs.mjs` | 容器预检和脱敏；容器 statfs 不是宿主磁盘准入 |
| 文档与 CI | `scripts/check-docs.mjs`、`.github/workflows/ci.yml` | 文档结构、同步映射、免更新审查、离线回归 |
| 受管 PR 复用 | `scripts/existing-pr-runner.mjs` | 精确候选、同仓库同基线、拒绝其他动作和 SHA 条件合并；真实保护、CI 与评审状态仍必需 |
| 项目工程运行时 | `scripts/project-runtime.mjs`、`scripts/vendor/leon-engineering/` | 固定 0.19.4 模块与来源校验，显式 Harness 和交付入口，旧回执续接；`tests/project-runtime.test.mjs` 和 `tests/management/project-runtime-git.mjs` |

本轮候选要求已改为 `gpt-6.1-sol` / `low`，预检拒绝旧 xhigh 配置；`acceptance` 仍为 NOT_RUN。此更改不修改运行实例的 Agent 配置或 hello 历史，也不代表业务模型调用已发生。

`role-instruction-paths.mjs`把Managed入口与company、Agent、role绑定，复用Native已登记的本run材料副本及baseline；按当前或历史manifest匹配当次摘要。调用门和宿主传输使用完整路径及内容摘要，不再用同名文件的basename定位。网页后续保存不修改已经固定的Native副本。旧UUID许可的原路径合同继续保留。

## Chief 网页续接策略

`bridge/chief-web-pilot.mjs` 是 #261 的限定操作策略。入口接收服务器已认证的本人会话和命令。调用方提供持久事务接口，在原 Paperclip 任务锁下读取绑定、版本、消息和历史操作，并原子记录意图与控制门。该接口只保留关联与回执，任务状态以 Paperclip 为准。

`bridge/chief-web-native-store.mjs` 对接原 Native repository 的任务行锁与 activity ledger，持久化操作意图和暂停门。离线用例验证策略、事务回滚与重建后的回执。`bridge/chief-web-routes.mjs` 提供默认关闭的原生路由安装器，借助 Paperclip 的已认证用户、公司成员和会话代际校验状态与控制请求。显式启动选项可通过 `docker/chief-web-app-hook.mjs` 在固定发布包的同源保护后挂载路由，`bridge/chief-web-paperclip.mjs` 使用同一个应用数据库和固定版本依赖装配 Native 适配和操作策略。`plugins/chief-web-pilot` 使用原生对话的任务详情插槽展示状态与控制。`bridge/chief-web-paperclip-repository.mjs` 使用固定版本的 issue service 锁定原任务与当前对话代际，再读取回合证据和写入操作意图。`bridge/chief-web-supplement-evidence.mjs` 核对本人消息、已结束的 Chief 回合和物理调用回执。`bridge/chief-web-settlement.mjs` 接收固定版本的原生回合收尾和后续核对，按同一消息登记含原始摘要、回合、唤醒及调用标识的补充意图。`bridge/chief-web-intent-consumer.mjs` 由既有控制器调用，在受管认领后执行补充或更新原 PR，并以原操作核对未知结果。`bridge/chief-web-intent-authority.mjs` 在 Native 行锁下持久认领与核对回执。真实启动所需的既有执行准入、发布绑定、插件启用和会话验收仍需接线及验证。

## 已验证的运行检查入口

真实 RWB 网页入口由 `bridge/chief-web-real-intake.mjs` 和 `bridge/chief-web-real-engine.mjs` 接入。私有操作交接只由 `scripts/chief-web-real-runner.mjs` 的本次受控运行消费。主应用与模型容器使用同一镜像指纹，订阅会话只在本次模型容器中可用。

`bridge/chief-web-runtime-bootstrap.mjs` 按固定 Paperclip 服务指纹装配 #261 入口，并读取私有绑定、调用证据和本次执行投影。`bridge/chief-web-recovery.mjs` 管理确认后的认领、发布、CI 回写和租约收尾。端口适配器必须提供原生任务记录、目标项目 Git 安全能力和权威回执。

`compose.chief-web-evaluation.yaml`、`bridge/chief-web-evaluation.mjs` 和 Chief 插件共同提供隔离网页演练。Docker 回归覆盖登记事务、权限、对话代际、候选匹配和未知结果恢复。使用 Chrome 和真实 PostgreSQL 的证据另行记录。

现有评估管理脚本依赖外置卷，不能用于无专用卷的干净 CI：

```sh
./scripts/sa status
./scripts/sa test
./scripts/sa preflight
```

`status` 只说明容器；`test` 是离线回归；`preflight` 是候选环境观察。它们不证明业务闭环。不要从此 checkout 执行 `up/stop`，除非先确认它确实拥有当前运行配置。

干净 checkout 的无产品安装检查使用现有固定 Node 镜像，输出写入忽略的 logs：

```sh
mkdir -p logs
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m \
  -v "$PWD:/workspace:ro" -v "$PWD/logs:/logs" -w /workspace \
  -e SUPER_AGENT_LOG_ROOT=/logs \
  node@sha256:a52166d89cfcc66ea62d10535ca712d161cece5d77ff4cfa758866b6b75ccb3f \
  node --test tests/*.test.mjs
```

文档静态检查将最后一行替换为 `node scripts/check-docs.mjs`。带变更映射的检查使用 [治理流程](documentation-governance.md)；Docker 无须挂载 `.git`，由宿主先生成路径和评审输入。

项目工程运行时的基础镜像合同覆盖全局安装缺席、校验失败前拒绝执行、旧 Harness 会话续接、资源内核路径保护及 GitHub 混合检查类型。真实 Git 管理验收另运行 `node --test tests/management/project-runtime-git.mjs`，覆盖原交付回执、远端候选失效、CI 失败、资源阻塞及 `delivery --status` 的回执更新。该命令在已有且固定镜像 ID 的 Node+Git 工程容器运行，挂载仅限本次 checkout 和日志，网络关闭，根文件系统只读，临时目录使用允许执行本地 `gh` 夹具的 `--tmpfs /tmp:rw,exec,size=64m`。基础 Node digest 未包含 Git，所以原有 CI 离线测试入口继续执行基础合同。管理验收命令与镜像 ID 记录在本次交付证据中。

## 运行集成边界

当前工作区的基线不包含后来统一集成目录中的 bridge、业务执行许可、宿主准入及恢复模块。该目录是独立候选且存在未提交改动，不能复制覆盖或视为已合入。其能力应在取得一致、已提交候选后逐项核对合同、测试和运行证据，再接入本体系。参见 [当日状态](governance-status-20261104.md)。

## 专职网络角色与Apps接线

`bridge/network-role.mjs`定义网络职责、主题和只读动作白名单；`tests/network-role.test.mjs`覆盖跨域、写入请求及知识隔离。role-materials/role-preparation允许network-engineer，Native运行前校验可信operation的networkScope。原验收脚本按对应profile.projectId创建上下文，避免新网络项目误绑定Research项目。

Apps使用Codex专用opaque连接变量经同一broker访问原账号MCP，避免把真实token交给任务。MCP初始化/目录与本轮两个安全只读测试动作分别受限并留脱敏回执，实际能力以本轮真实结果为准；参见[Research/PM验收](plans/research-pm-m1.md)及[网络职责](network-engineer.md)。

## 任务数量政策与显示名

本人2026-11-19取消每日10个新任务的数量硬上限。`AdmissionMeter.reserveTask`与Chief只读预准入均不再按日计数拒绝；同一原SQLite继续记录上海日期及任务身份，全局单执行租约、未知结果核对、每任务六个角色外层调用槽及每run64次responses保持。`evaluation/candidate.json`以null明确表示无每日任务数上限，预检拒绝旧数字限制，不能仅修改界面文字。离线测试顺序登记26项同日任务并核对原账本、互斥、释放证据和去重。真实实例生效还须绑定同一已验收源码。

`bridge/role-labels.mjs`仅统一显示名；Native名称更新复用原ID。岗位拆分与新增执行器必须另外确认，不能从命名映射推断已实施。

`bridge/team-roles.mjs`是11角色职责与层级清单，Native preparation、材料和最终CLI gate共用稳定角色键，避免清单已增加而最终执行门仍拒绝。`tests/team-roles.test.mjs`检查唯一ID、完整英文显示名、架构下属前后端、质量独立汇报及无额外高管岗位。System Resource Engineer单独只读scope，数据库业务/运行/物理资源职责分开。实际Native创建、启用、分派及通知须独立留证。

## Chief Native控制器

`bridge/team-native-runtime.mjs`将本人Native输入、结构化Chief计划、角色派发、收回、独立质检及通知接到现有Native服务。`team-plan.mjs`校验根预算、DAG和质量依赖；`role-control-store.mjs`仅保存控制映射/意图/回执。`task-input.mjs`统一title及description输入版本。父子调用共用`role-call-budget.mjs`根预算。

`native-role-adapter.mjs`在实际QA派发的可信提示中明确JSON契约：verdict仅为`PASS`或`NEEDS_WORK`，`findings`/`notRun`始终是数组，`reviewedArtifacts`逐项匹配可信执行绑定。范围和限制保留在独立字段；未执行验收继续记入`notRun`，必需证据缺失不能转成PASS。上游报告仍作为证据数据传递，不提升为指令。`tests/native-role-adapter.test.mjs`捕获真实`nativeExecute`最终prompt，验证QA协议、精确产物绑定及非QA不受影响；严格collector、材料、权限、预算和调度均未修改。源码回归不代表旧运行报告已修复或真实业务通过。

`team-plan.mjs`的可信Chief协议明确最终飞书发信由run结束后的控制器受管outbox负责；模型仅写summary，并将发信阶段标为等待控制器回执。模型不能自行宣称已发送，也不为这一步发现飞书插件、索取凭据或另发消息；尚无回执不能推断连接缺失或发送失败。其他已授权Apps/Plugins照常用于其指定任务。上述回归同样捕获实际Chief summary派发提示；发送器、通知回执及运行配置不在本次提示修复范围。

`team-result-notification.mjs`复用已有飞书SDK和本人绑定，持久化结果outbox；发送成功不重复调用，未知结果停止等待核对。`scripts/role-transport-resident.mjs`是既有宿主Node的Docker管理传输与只读宿主快照，模型及产品协调逻辑仍在Docker。只读Snapshot不授予系统修改权，使用WorkDisk/原数据卷前核对固定UUID。新宿主开机服务不在本轮配置。

`team-configure.mjs`明确新角色paused纯登记，保护原ID/配置/材料；`team-bootstrap.mjs`串行复用原Native lifecycle，保留真实探针与无新探针的区别。296项当前离线回归已通过；Native11配置及8新探针通过，新的Chief联合闭环尚未作为通过记录。

## Chief 飞书入口

`bridge/chief-feishu-intake.mjs`校验SDK来源的本人单聊、固定应用/租户及消息摘要；`chief-feishu-native.mjs`将登记、发送和唤醒认领保存到Native事务/activity ledger。`chief-feishu-service.mjs`复用已固定的1.76.0 SDK与原连接工厂，默认关闭，唯一主进程监听；不新增依赖、调度器或任务库。测试覆盖身份负例、源消息冲突、并发去重、合理等待、陈旧输入及未知结果不能重发。真实连接、本人发送、Chief分派和通知必须另验。

## 单根QA补核例外

本人仅批准LEO-23根7956bcfe的第七次调用用于原QA补核。`role-call-budget.mjs`在原全局调用锁内匹配受保护授权的owner/company/root/既有child/QA Agent/operation/phase/证据manifest及有效期；仅原目录已有六条时放行一次。第八次、其他角色/目的/Root、换ID或省略父映射均拒绝；未知结果保留原锁。其他根仍六次，不修改Chief计划预算。

补包只按签定manifest和逐文件摘要复制到该run专属目录，UID1000只读挂载`/qa-evidence`，不挂整个控制状态或会话内容。原QA NEEDS_WORK、Chief汇总和原通知不覆盖；补核只关闭指定证据缺口。已验证的环境/隔离探针不重跑。Native构件、最终收存及新版本通知各自记录，不能把权限例外当业务通过。

## Paperclip 私有 HTTPS 网关候选

`docker/gateway.mjs` 的 HTTP 和 WebSocket Upgrade 共用 Host 白名单与转发头重建。精确 `mac-mini-1.tail947973.ts.net:8443` 映射 HTTPS；`localhost`、`127.0.0.1`、`[::1]` 及有效端口映射 HTTP。未知、重复、歧义 Host 返回 421，不访问固定后端；客户端 `Forwarded`、`X-Forwarded-*`、`X-Real-IP` 与代理认证头不被信任。回归 `tests/gateway.test.mjs` 通过真实 HTTP/Upgrade 后端核对协议、认证头保留、拒绝和净化行为。

`SUPER_AGENT_GATEWAY_HEADER_PROBE_NONCE` 默认不设置。配置必须为 32 位小写十六进制随机值；仅精确 `GET /__sa_header_probe_<nonce>` 消费一次，每个网关进程最多记录一条 JSON，且仅含收到的 `host`、`x-forwarded-host`、`x-forwarded-proto`（去控制字符、每项最多 256 字符）。探针不转发后端、不返回头值，非 GET 为 405，已消费为 410，Upgrade 为 400。重启会重置内存次数，取证后必须删除该环境变量；候选不能把探针日志当成已上线证据。

Host 策略依赖 Docker 将网关继续只发布到宿主 loopback。它不授予用户身份，也不绕过 Paperclip 的 authenticated/private、登录及 Origin 校验。Public URL、认证 base URL、精确 trusted origins、转发实测、旧本机会话与 HTTPS Secure Cookie、错误 Origin 和真实实时连接由运行配置负责人在排空后统一验证；离线测试通过不代表这些已完成。

## 已合组合 PR 的交付回执对账

项目管理入口 scripts/reconcile-merged-delivery.mjs 默认只读 dry-run。它用于未发布、无历史集成或回收状态的 started 子任务，其原提交已完整保留于同仓父任务的已合 PR。它核对父/子回执归属、原基线→子提交→PR head→merge→实时默认分支的祖先链、精确 PR 身份、实时三个必需状态和服务端分支保护，不创建替代 PR、不推送或改写 vendor/runtime。Docker 夹具在 tests/reconcile-merged-delivery.test.mjs。

源 dirty、未知 ignored、未知锁/结果、任意进程或运行/停止容器对源及其祖先/子路径的引用都拒绝 apply。仅当真实检查完备且无占用，显式 --apply --expect-receipt-sha256 绑定dry-run摘要，才在原 integration/task 锁内重新核对；验证 WorkDisk UUID、APFS 与规范路径，无 symlink 中间目录。创建的 integration alias 只属于子任务，不认领父任务工作树；对账最多记录 ci_passed 及完整 adoption 证据，绝不记录 cleaned 或免除原 cleanup/enforce。见[工作流](agent-workflow.md#组合交付对账与收尾)。

占用核对按 Docker mount 类型验证：bind 必须有有效绝对 Source，沿现存祖先还原缺失末段；tmpfs 以明确类型判定；volume 仅在 inspect 证明为标准 VM 内 local volume 且无驱动选项时排除宿主 bind 引用。未知结构、未知卷选项或来源无法还原均拒绝，不能把未知当空闲。远端原 feature 分支如存在必须仍绑定原 SHA；新的 integration alias 在远端必须不存在。

本人于2026-11-20明确允许“区分只读缓存后正常回收”。已有对账入口增加显式 --allow-readonly-vm-cache：通过lsof逐FD访问模式和ps真实可执行文件识别macOS Virtualization的全只读源缓存，仅在无容器引用时允许普通受管流程。输出与adoption证据保留非零openPids，并单列readOnlyVmCachePids、activePids；不声称句柄自然归零。默认不忽略缓存；其他进程、读写/未知FD或容器引用仍等待。不重启Docker、不强删。
