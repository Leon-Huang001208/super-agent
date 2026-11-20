# 开发地图

## 真实任务驱动的迭代

`bridge/task-call-policy.mjs`统一原根默认6/可信复杂任务12次上限，`scripts/task-call-budget.mjs`只在关闭派发且排空后登记已授权的原任务复杂档；不改写任何旧预算文件。物理调用、Chief提示、续接、Native失败重试与普通QA返修共用同一上限。`tests/task-call-policy.test.mjs`与原budget/retry/context测试验证累计计数、伪造上限拒绝和原记录保持。

`bridge/team-qa-repair.mjs`和`team-native-runtime.mjs`把普通成功QA的NEEDS_WORK回交原执行子任务，最多两轮；每轮使用新operation/run/session和独有输出，原开发、QA及失败历史不覆写。采集绑定当前dispatch操作，旧QA不进入新reviewedArtifacts。预算不足、需要多项衍生重建或修复负责人不明确时保留可恢复阻断，不冒充Native失败重试。相关驱动与边界见`tests/team-qa-repair.test.mjs`。

`bridge/rwb-release.mjs`只供专门登记的DevOps原任务消费`host.rwb_release`操作，复用RWB的GitSafety和resident；普通项目delivery上限保持。host-call原队列按登记操作去重，未知结果不重放。`tests/rwb-release.test.mjs`、host capability/queue/context回归只证明接口合同，真实合并部署仍须当前写窗口和RWB实际回执。

`scripts/publish-role-profiles.mjs`使用Native Owner/CAS保存；旧生成基线不匹配时保留本人自定义内容，不能用新模板直接覆盖。生成器与六阶段能力说明见[持续迭代](agent-iteration.md)，Native发布、新run加载及业务验收分别记录。

Native HTTPS、每 run 证书/信任、TLS ready 与 MCP CA 传播的合同及测试见[HTTPS 恢复专题](plans/native-https-recovery.md)。Chief 首计划第二次 Native retry 同时维护队列选择、严格物理失败证明、旧锁归档、M2 settled 观察及可信剩余预算提示；只改传输或只让队列消费均不构成完整修复。Mac 宿主检查与 Linux 离线 CI 分别留证。

## Document Specialist

角色键/职业说明/能力/公司技能矩阵新增`document-specialist`；`document-runtime`为原生子进程定位已有文档Python/LibreOffice，并使用本run字体配置，原11岗不注入。回归覆盖12岗完整名册、9项技能及PDF来源、Doc→QA和原控制预算/交接格式、Native材料/知识/调用门，以及工具发现和运行私有缓存。安装脚本与正式接入仍依主窗口窗口，不把源码定义当Native已就绪。

本岗格式职责同时涵盖常见文本/数据交换、Markdown/reST/HTML文档与LaTeX/BibTeX，规则和代表格式见[文档岗合同](plans/document-specialist.md)。范围扩展只更新Doc职业说明与能力正文及生成模板，9项公司技能、工具权限和运行环境保持；语法/schema、内容语义、实际编译/渲染分开验证，代码/配置行为仍交对应技术负责人。相关现有检查为`team-roles`、`document-specialist-role`及`role-capabilities`测试与文档同步映射检查。

## Mac原生执行和公司Skill

`docker/role-ai-binding-hook.mjs`修复固定Native路由的未变订阅误判；`server-entry.loadServer`与ChiefWeb在同一装配点加载/验证/注销，`role-preload`不预先导入路由。回归覆盖JSONB键顺序、真实provider/method/connection变化、源漂移、组合模块缓存及实际安装源字节合同。Dockerfile与受管镜像输入清单同步分发新helper。

`readCompanyRoleLibrary`组合Native轻量list与本次来源的detail，保持审查优先级和真实API字段一致。回归使用省略metadata的列表payload，验证已审查版本选择及详情身份漂移拒绝。

真实本地包导入的版本创建及恢复由`sync-company-role-skills`使用Native版本API完成，测试覆盖currentVersion缺失与重入不增版本。审查过的目录别名（如Vercel React入口名不同）在岗位分配与运行条件过滤中一致处理；来源并存时不删除其他条目。

本轮将执行策略贯穿preparation、Native adapter、CLI gate及宿主transport，broker/MCP使用宿主真实路径和loopback端点。公司库分配与最终CODEX_HOME物化使用同一选择，职责摘要、Managed bundle与权限同步。相关测试覆盖原生和旧Docker模式、完整Skill包、来源去重、依赖、参数、取消与恢复；见[本轮合同](plans/native-skills-20261120.md)。配置预检、真实订阅调用、Docker项目检查及运行切换各自留证。

| 子系统 | 本仓库入口 | 维护与验证 |
|---|---|---|
| M2 项目与本人命令 | `bridge/context-projects.mjs`、`bridge/chief-context-commands.mjs`、`bridge/chief-context-native.mjs` | catalog 绑定 Native project/可选 workspace ID；原 activity 持久化项目/任务选择、补充、暂停、继续与 linked followup。`context-projects`、`chief-context-commands`、`chief-context-native` 同名测试核对契约。 |
| 本人原消息受控补收 | `bridge/chief-official-message-recovery.mjs`、`scripts/chief-feishu-recover.mjs`、M2 service/repository | 官方 GET 验证原 Owner、既有 SDK 单聊、正文 SHA 与原 ID，只恢复 new goal；默认 preview，不造 SDK 事件或直接 wake。`chief-official-message-recovery`、`chief-feishu-recover-cli` 及既有 context 测试覆盖身份拒绝、跨来源并发、ACK 未知与去重。 |
| M2 记忆与协调 | `bridge/project-knowledge-store.mjs`、`bridge/team-context.mjs`、`bridge/team-native-runtime.mjs` | owner-confirmed 当前版本按项目共享/角色私有先隔离后检索；新 session 不带旧任务 history；六次同根额度、原操作对账和分代产物保留。对应 `project-knowledge-store`、`team-context` 测试。 |
| M2 材料与配置 | `bridge/role-material-snapshot.mjs`、`bridge/native-role-runtime.mjs`、`scripts/role-container-transport.mjs`、`scripts/context-configure.mjs` | 专用只读 snapshot，manifest/permit/项目/workspace 同域；配置默认 preview、显式 apply，保留旧 RWB primary/回调。`native-role-runtime-context`、`role-container-materials`、`context-configure` 及既有 gate/adapter/preparation 测试；合同见[跨项目专题](cross-project-context.md)。 |
| 通用岗位与能力 | `team-roles.mjs`、`role-capabilities.mjs`、`role-skill-bundles.mjs`、`assets/role-profiles/`、`assets/role-skills/` | 12职业定义（现役11岗，Document Specialist待协调接入）、默认/补充能力、可复核完整Skill包；入口字节摘要与files聚合摘要分别命名并对实物校验。项目规则按实际提供的文件读取，能力按技术栈/服务选择，安装或缓存存在不能当调用通过。 |
| 跨项目接单 | `role-project-context.mjs`、Native角色及Chief现有入口 | 使用Native workspace.metadata扩展，任务项目决定知识/工作区/交付；官方schema/service合同fixture覆盖真实原始DB和API投影。 |
| 宿主执行与MCP | `role-host-capabilities.mjs`、`role-host-mcp.mjs`、`role-host-call-queue.mjs`、`docker/role-host-mcp-server.mjs`、`scripts/role-host-mcp-config.mjs` | 现有传输内执行Git/check/已授权动作及选定stdio MCP；仅本run实际host工具逐项批准，服务器默认prompt。固定CLI合同读回真实审批配置；取消清理自有进程组，失败保留有限脱敏诊断。 |
| 岗位材料发布 | `scripts/publish-role-profiles.mjs` | 暂停新派发后走Native认证HTTP CAS保存AGENTS/CAPABILITIES，原历史及登记同步链保留；不重建Agent。 |
| 项目交付适配 | `scripts/role-project-delivery.mjs` | 项目已有入口优先；显式选择managed-project时复用固定manager/Harness。prepare后QA检查精确integration候选，发布复用同一PR且不自动合并。`tests/management/role-project-delivery-git.mjs`用本地bare remote验证真实Git行为。 |
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

业务验收沿用固定 `gpt-6.1-sol` / `low`，预检拒绝旧 xhigh 配置。M2 首轮本地 Docker 全量为 515/515（`logs/m2-full-first.log`，加入配置工具前），不表示最终总数、Mini 激活或真实业务通过；后续精确候选须另留回执。

`role-instruction-paths.mjs`把Managed入口与company、Agent、role绑定，复用Native已登记的本run材料副本及baseline；按当前或历史manifest匹配当次摘要。调用门和宿主传输使用完整路径及内容摘要，不再用同名文件的basename定位。网页后续保存不修改已经固定的Native副本。旧UUID许可的原路径合同继续保留。

## Chief 网页续接策略

`chief-bootstrap-retry.mjs`独立处理首个Root Chief plan在Gate claim/provider之前失败的既有Native首次retry。`native-role-runtime`先尝试按真实Native关系绑定retry，再执行普通初次Chief准入；`role-native-retry-consumer`只把唯一匹配的queued原run交回Native消费者。目标回归覆盖无roleOperationId的真实原始context、旧预算保留、owner/input/lease/permit及物理否定证据、queued选择与不创建额外run。原work子任务的transport/flow恢复合同仍由`role-native-retry.mjs`负责。Gate回归另覆盖Native合法bypass顺序与权限扩展拒绝；实机首次计划及后续M2业务仍须另验。

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

`bridge/network-role.mjs`定义网络职责、主题和动作范围；修改动作仍须Native许可绑定已授权登记ID，任意命令名不构成授权。`tests/network-role.test.mjs`覆盖范围及知识隔离；host测试覆盖实际执行权限。Native运行前校验可信operation的networkScope。原验收脚本按对应profile.projectId创建上下文，新任务则按当前Native项目解析。

Apps使用Codex专用opaque连接变量经同一broker访问原账号MCP，避免把真实token交给任务。MCP初始化/目录与本轮两个安全只读测试动作分别受限并留脱敏回执，实际能力以本轮真实结果为准；参见[Research/PM验收](plans/research-pm-m1.md)及[网络职责](network-engineer.md)。

## 任务数量政策与显示名

本人2026-11-19取消每日10个新任务的数量硬上限。`AdmissionMeter.reserveTask`与Chief只读预准入均不再按日计数拒绝；同一原SQLite继续记录上海日期及任务身份，全局单执行租约、未知结果核对、每任务六个角色外层调用槽及每run64次responses保持。`evaluation/candidate.json`以null明确表示无每日任务数上限，预检拒绝旧数字限制，不能仅修改界面文字。离线测试顺序登记26项同日任务并核对原账本、互斥、释放证据和去重。真实实例生效还须绑定同一已验收源码。

`bridge/role-labels.mjs`仅统一显示名；Native名称更新复用原ID。岗位拆分与新增执行器必须另外确认，不能从命名映射推断已实施。

`bridge/team-roles.mjs`是11角色职责与层级清单，Native preparation、材料和最终CLI gate共用稳定角色键，避免清单已增加而最终执行门仍拒绝。`tests/team-roles.test.mjs`检查唯一ID、完整英文显示名、架构下属前后端、质量独立汇报及无额外高管岗位。System Resource Engineer使用独立resourceScope，数据库业务/运行/物理资源职责分开。实际Native创建、启用、分派及通知须独立留证。

## Chief Native控制器

`bridge/team-native-runtime.mjs`将本人Native输入、结构化Chief计划、角色派发、收回、独立质检及通知接到现有Native服务。`team-plan.mjs`校验根预算、DAG和质量依赖；`role-control-store.mjs`仅保存控制映射/意图/回执。`task-input.mjs`统一title及description输入版本。父子调用共用`role-call-budget.mjs`根预算。

PR30的Native内置retry只绑定已存在的后继run。M2绑定先按原operation/Native task派生局部项目，精确选择同输入/同代际dispatch所属flow；旧flow和其他代际保留。原项目artifact与meter使用该局部绑定，Native control的暂停/pending/输入/计划确认仍在原根事务核对，provider启动守卫继续生效；不增加wake、root或重置六次预算。`tests/role-native-retry.test.mjs`覆盖RWB专用workspace、全局默认个人项目不变、旧portable flow及暂停/版本负例，真实重试另行留证。

PR32复用Native唯一queued消费者。若M2本人已暂停/补充或预算用尽，现有后继run仅在原scope、输入和完整physical failure证据通过后settle-only：只读归档、持久幂等回执、精确释放父调用锁，并返回bootstrap NoProvider；不创建operation、不推进flow、不调用模型或新增预算。Native终态与原archive共同证明已结清后，既有phase释放复用`observeContextCallEvidence`及Native租约核对；unknown不释放。`chief-context-native`串联回归验证pause/add→queued消费→NoProvider证据→本人continue同根应用输入；Docker夹具不等于Mini实测。

`native-role-adapter.mjs`在实际QA派发的可信提示中明确JSON契约：verdict仅为`PASS`或`NEEDS_WORK`，`findings`/`notRun`始终是数组，`reviewedArtifacts`逐项匹配可信执行绑定。范围和限制保留在独立字段；未执行验收继续记入`notRun`，必需证据缺失不能转成PASS。上游报告仍作为证据数据传递，不提升为指令。`tests/native-role-adapter.test.mjs`捕获真实`nativeExecute`最终prompt，验证QA协议、精确产物绑定及非QA不受影响；严格collector、材料、权限、预算和调度均未修改。源码回归不代表旧运行报告已修复或真实业务通过。

`team-plan.mjs`的可信Chief协议明确最终飞书发信由run结束后的控制器受管outbox负责；模型仅写summary，并将发信阶段标为等待控制器回执。模型不能自行宣称已发送，也不为这一步发现飞书插件、索取凭据或另发消息；尚无回执不能推断连接缺失或发送失败。其他已授权Apps/Plugins照常用于其指定任务。上述回归同样捕获实际Chief summary派发提示；发送器、通知回执及运行配置不在本次提示修复范围。

`team-result-notification.mjs`复用已有飞书SDK和本人绑定，持久化结果outbox；发送成功不重复调用，未知结果停止等待核对。`scripts/role-transport-resident.mjs`是既有宿主Node的Docker管理传输与只读宿主快照，模型及产品协调逻辑仍在Docker。只读Snapshot不授予系统修改权，使用WorkDisk/原数据卷前核对固定UUID。新宿主开机服务不在本轮配置。

`team-configure.mjs`明确新角色paused纯登记，保护原ID/配置/材料；`team-bootstrap.mjs`串行复用原Native lifecycle，保留真实探针与无新探针的区别。原 M1 阶段的296项离线回归、Native11配置及8新探针是各自时点证据；不能替代 M2 精确候选或多项目真实业务验收。M2 复用原角色，不重跑一次性 team-configure 重建身份。

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
