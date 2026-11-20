# 开发地图

| 子系统 | 本仓库入口 | 维护与验证 |
|---|---|---|
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

`team-result-notification.mjs`复用已有飞书SDK和本人绑定，持久化结果outbox；发送成功不重复调用，未知结果停止等待核对。`scripts/role-transport-resident.mjs`是既有宿主Node的Docker管理传输与只读宿主快照，模型及产品协调逻辑仍在Docker。只读Snapshot不授予系统修改权，使用WorkDisk/原数据卷前核对固定UUID。新宿主开机服务不在本轮配置。

`team-configure.mjs`明确新角色paused纯登记，保护原ID/配置/材料；`team-bootstrap.mjs`串行复用原Native lifecycle，保留真实探针与无新探针的区别。296项当前离线回归已通过；Native11配置及8新探针通过，新的Chief联合闭环尚未作为通过记录。

## Chief 飞书入口

`bridge/chief-feishu-intake.mjs`校验SDK来源的本人单聊、固定应用/租户及消息摘要；`chief-feishu-native.mjs`将登记、发送和唤醒认领保存到Native事务/activity ledger。`chief-feishu-service.mjs`复用已固定的1.76.0 SDK与原连接工厂，默认关闭，唯一主进程监听；不新增依赖、调度器或任务库。测试覆盖身份负例、源消息冲突、并发去重、合理等待、陈旧输入及未知结果不能重发。真实连接、本人发送、Chief分派和通知必须另验。
