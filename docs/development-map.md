# 开发地图

`team-roles`和`role-capabilities`同步生成岗位SOP及AGENTS／CAP资产：共通规则是不采用防御式推进、小改相关检查、直接纠错和按实际用途清理；Architect补强官方版本选型判断与可执行规格交接，沿现有Skill去重，不新增同功能包。生成一致性和相关角色测试足够检查这次文字／生成变化，不重跑无关全仓。

Native保存按当前版本更新后续run，保留Doc／QA人工内容；角色方法、实际Skill分配、工具已连接和业务实测分别说明，不为验收另造模型探针。

成果通知标题读取真实Native根任务`title`，短编号作为辅助；标题缺失时明确未提供，不拿UUID或报告中猜测的主题填补。阶段区分质量阻断、成果收存及真实非空QA通过；文档岗位的产物复核不升级成源码或部署完成。不增加模型调用、完成百分比或进度状态机，原任务及技术记录不改。

`team-user-summary.mjs`提供同次Chief总结提示、三字段用户摘要解析和基于现有flow的展示阶段。`team-native-runtime`保留原完整MD、摘要、评论及归档，只向通知传独立用户摘要和可信阶段；`team-result-notification`只生成短纯文本，不透传技术MD或靠删长串拼出报告。普通业务数字和合法链接可出现在用户摘要中。LIMIT、额度不足、返修负责人未明和依赖重建沿真实决策解释；未知或缺摘要明确待核对。日期来自原outbox创建时点，技术summary/sha与投递键不变。摘要、sender及QA邻接测试覆盖展示和原有权限、sent去重、unknown不重放；Docker离线结果与实机新通知分别记录。

## 任务级多 Runtime 隔离候选

候选入口和验收分层见[专题合同](plans/task-runtime-routing.md)。`bridge/role-runtime-profiles.mjs`固定Codex会员、DeepSeek/MiniMax分别配OpenCode/Claude Code共五个实现档位；默认13岗全Codex map仅是初始/current-binding快照。`bridge/task-runtime-policy.mjs`负责可信任务选型，`bridge/task-runtime-routing.mjs`负责task开始/已知成功且闭合执行后的handoff绑定和live重验；都不改变权限、会话或预算。

13岗源码新增[Full Stack Engineer](plans/full-stack-engineer.md)：`role-labels`/`team-roles`末尾追加key并保留原12顺序和元数据；`role-capabilities`与公司Skill分配给出完整开发/测试资料及权限上限；`team-plan`对全栈代码强制独立QA并禁止组合发布/网络/资源能力。`full-stack-engineer-role`及roster/bootstrap/skills回归分别核严格13名册、旧12拒绝、资料与负例。初始化/bootstrap已按ROLE_KEYS动态计数，不能当12→13迁移器；Native迁移另由受控候选入口同批保存原12对象、绑定新源码与新岗位，不改生产旧12pinned source或既有五次成功证据。

`role-preparation`、`native-role-adapter`和`native-role-runtime`将所选档位接到原Native身份、材料、知识、fresh session、预算及settlement。`scripts/role-opencode-config.mjs`只生成本run OpenCode配置；`docker/role-opencode-gate.mjs`验证固定CLI和permit；`role-isolated-transport`、`role-host-transport`及`role-api-routing`/provider broker保留控制侧真实Key、opaque客户端key、官方路径和64次请求上限。Codex会员链独立保留，不把API主选实现为失败fallback。

正常API任务没有会员委托时，只配置已连接的Host MCP，不因角色默认Cloud目录阻止启动；远端Cloud Apps仍不可调用，有委托与Codex路径保持原样。Native启动读取registry复用控制存储既有4 MiB限制，秘密与permit的1 MiB限制不变，不能通过截断历史解决启动失败。`role-api-proxy`和`role-host-api-transport`的针对用例验证无委托时API及Host可用、Cloud仍拒绝。

`scripts/multi-runtime-acceptance.mjs`和`tests/helpers/multi-runtime-native-fixture.mjs`准备独立Native测试数据库、公司、控制根与task绑定，沿原Native执行器运行有限步骤；它不是另一个自动调度器。定向测试为`task-runtime-policy`、`task-runtime-routing`、`role-runtime-profiles`、`role-opencode-config`、`role-opencode-gate`、`role-api-routing`、`role-api-proxy`、`role-isolated-transport`和`multi-runtime-acceptance`，并保留原prep/adapter/host/budget/QA回归。离线通过、真实Native模型、同任务handoff、生产部署和业务是不同证据；本轮已完成的隔离结果见专题，不能代替生产激活验证。

`role-claude-gate`兼容stock Native精确的单Agent header及两个固定实例缓存根，实际入口检查缓存目录和指令文件的归属、权限及无链接；Host继续只使用permit绑定材料，不读取缓存正文授予权限。`current13-runtime-acceptance --repair-current13-preclaim`是显式的隔离管理操作：实际Native官方未开始provider、Gate未claim、无Host请求及租约闭合原件都匹配后，保留失败run、原operation与第9次预算，为同task/root/Agent准备一个新operation；它不唤醒模型，也不退款。相关fixture严格重验唯一失败attempt及预算集合；收存器先保留Native失败或未知状态，再读取Host结果，避免缺失文件掩盖真实原因。

## 20次预算与原任务开发续接

`task-call-policy`默认20，`native-role-budget`、`chief-context-native`及QA返修共同接受可信20次证据；旧6/12回执和历史QA专项保持其原合同。`task-call-budget --maximum 20`只修改Owner绑定额度，不修改旧budget文件或唤醒模型。相关budget/context/retry回归验证第20/21次边界及原计数保留。

`team-dispatch-control`纯规划与Owner CLI通过精确registry摘要、空执行面和CAS维护派发布尔值；`completed-team-resume`校验原flow、输入、已发通知、原件与workspace，归档旧代后写Native控制与同根恢复信封；`rwb-development-registration`通过Native API登记长期开发workspace、既有规则/检查和原GitSafety命令。对应测试分别为`team-dispatch-control`、`completed-team-resume`和`rwb-development-registration`，实际CLI、源切换、授额和新run仍需现场回执。

Chief的`roleInstructions`与DevOps的`renderRoleCapabilitiesMarkdown`同步说明普通原根20次、历史可信额度保留及按项目自身授权交付，生成的两份`assets/role-profiles`逐字匹配；没有修改调用门、权限或Skill包摘要。`team-roles`、`role-capabilities`、`task-call-policy`和`role-profile-publication`既有回归分别检查模板一致性、受管通道、历史预算与人工内容保护。源码修正不等于Native材料已发布；实际更新仅在运行窗口交接后通过Owner/CAS进行，未执行时记为NOT_RUN。

`role-host-capabilities`对已登记的工作区准备、候选准备和交付命令启用既有`host-proxy-environment`，由宿主命令端口把解析后的代理传给实际子进程；模型代理初始化晚于首次工作区准备，不能代替此路径。相关host回归验证命令环境、原Git/候选/QA门及失败处理，代理解析器的既有回归保留环境优先、系统loopback及本地绕过合同。真实GitSafety fetch与Native任务执行另留运行证据。

`role-project-context`从当前Native工作区记录产生代码源输入绑定，`native-role-adapter`对照真实nested `paperclipWorkspace.workspaceId/projectId/cwd`，保留固定artifact目录和配置变化拒绝。`native-role-runtime`的实际产物执行投影沿同一固定目录进入permit；源绑定不能由模型请求或缺失的顶层workspace字段代替。context/adapter/runtime回归覆盖代码源、旧artifact、错项目/ID/cwd、登记变化与产物投影；Host工作树隔离沿原host回归核对。

`role-native-retry`与原consumer/team tick增加显式completed-resume Chief首个workspace bootstrap拒绝的窄分类，fresh Native workspace及原control/claim、Native首次successor、官方NoProvider和零physical同时约束。`completed-resume-chief-retry`按真实字段形状覆盖queue→真实parent→selector→原binder，保留原Root/op/nonce/已用计数；不扩大普通Chief错误、重试次数或UNKNOWN重放。

未启动successor校验还区分Native原生前置管理信息与真正调用证据：ledgerScope、初始receipt/reservation必须来自固定安装版dispatch合同并绑定当前任务/run；其它usage、会话、进程、输出或未知结果不因零token获准。原生dispatch无模型回归覆盖真实准备顺序，另验已知受控中间拒绝的三行原retry链；旧reconciliation/null保留，不能以简化status-only fixture代替运行时合同。

## 真实任务驱动的迭代

`team-plan.validateTeamPlan`的outputFile stem上界与原Native output/collector/archive统一为111，保留角色、key、hostActions、DAG、QA及预算限制。`team-plan`回归核对真实UUID代际前缀和111/112边界；Native collection合同另验证可信prefix防串代、成功source原plan重复收存幂等、旧phase正常释放及首child由原AdmissionMeter取新阶段。仅长度合同修复，不创造collection lease或修改成功产物/模型调用记录。

`native-role-runtime.registered`通过现有`readControl`读取registry，统一使用4 MiB控制文件上限，保留owner、私有mode、常规文件、symlink及hardlink检查；其它私有JSON仍沿原1 MiB读取器，不扩大凭据文件限制。`native-role-runtime-context`回归执行真实registered函数及instruction readiness，复现并验证大于1 MiB的合法registry，同时拒绝超4 MiB、宽权限和链接文件，不用截断旧operations或修改历史来通过。

`role-native-retry`的首个已登记子任务bootstrap路径只验证官方Native明确的未启动provider失败及原自动retry关系，在原flow、owner/input、Chief wake、预留phase nonce、预算余量和零物理证据全部成立时返回原context/operation。缺失permit、budget或transport不是单独的未执行证明；未知证据仍返回reconciliation，不伪造文件、改nonce或生成替代operation。后续正常producer绑定原operation到该Native successor并首次计费；既有queued consumer及普通已执行失败重试合同保持。

该路径的产物目录使用`resolveNativeRetryScope`中`projectForOperation`解析出的可信目录。普通Native操作可以没有M2专用的`contextVersion/workspaceCwd`，仍由公司及当前项目绑定到受管`_default`目录；显式上下文目录继续要求与项目合同一致。`child-bootstrap-retry`回归同时覆盖普通操作缺少这两个字段、目标文件已存在及读取证据未知的拒绝，避免用M2夹具代替普通文档任务。

`bridge/role-permit-contract.mjs`统一公司Skill snapshot原8 MiB上限及完整role permit的12 MiB序列化上限；Native生产端在写operation binding/permit前拒绝超限。`role-control-store.readRolePermit`及Gate、宿主/容器transport、resident、原bootstrap/transport retry和验收/产物采集都使用专用permit上限，普通`readControl`保持4 MiB，其他证据限额不变。`tests/role-permit-contract.test.mjs`以实际公司Skill解析器生成大于4 MiB的合法snapshot，覆盖UTF-8边界、权限与链接拒绝；两种Chief retry回归核对大permit的原字节摘要与原预算保持，不重跑已成功任务。`native-role-adapter`回归验证真实超限错误`NATIVE_ROLE_PERMIT_TOO_LARGE`沿原错误白名单及runtime未进入provider的失败映射保留，日志不携带permit内容。

`bridge/role-artifact-workspace.mjs`与`docker/role-artifact-workspace-hook.mjs`按固定Native源摘要装配非Git产物目录支持；仅明确`non_git_path`、实际owner/role/run/项目/工作区/输入及artifact上界全部匹配时免除`.git`要求，其他Native工作区与代码Git保护保留。`role-preload`在instruction hook有效期间先加载、验证artifact补丁，再启动协调器和飞书服务；server-entry复用同一模块已验证的初始化结果，未知ESM缓存仍拒绝启动。`tests/role-preload-order.test.mjs`以fresh process覆盖飞书提前导入heartbeat、维护模式及未知缓存拒绝。新建M2产物workspace使用该类型，旧local_path仅可重用，不自动获得例外。源码/真实Native函数分支测试与实机新任务分别取证，不创建假Git仓库。

守卫读取原始Native Agent行时，启用标记接受字符串`"true"`或Native的`{type:"plain",value:"true"}`，不解析秘密引用；false、混合及无效结构拒绝。`tests/role-artifact-workspace.test.mjs`保留实机选定字段形状的匿名化Chief首调用回归，覆盖owner wake、run与持久工作区绑定；失败终态保持原证据，离线fixture不冒称实机重跑。

`bridge/native-npm-cache.mjs`在Mac启动本run前校验WorkDisk卷身份、路径、归属和权限，写私有HOME中的纯cache `.npmrc`及`NPM_CONFIG_CACHE`。共享的是可再生npm下载缓存，HOME/CODEX_HOME、认证、会话和产物继续逐run分离；无配置或卷身份不符时不静默落内盘。`tests/native-npm-cache.test.mjs`与Mac transport fixture核对多HOME复用同一cache、拒绝覆盖/符号链接和缺卷零写；配置证明不冒称包或业务通过。

`bridge/native-plugin-cache.mjs`只把私有`CODEX_HOME/plugins/cache`链接到独立的WorkDisk Native插件代码缓存，保持`plugins/data`、认证、配置、会话及SQLite私有。先验证卷身份、canonical路径、owner与权限，拒绝链接整个plugins、逃逸路径、旧私有cache覆盖及sealed recovery目录；CLI返回后只读复核链接，不自动修复。`native-plugin-cache`与完整Mac transport fake CLI回归核对实际写入位置和私有状态隔离。`native-proof.pluginCache`只证明已配置且链接复核通过，真实Codex兼容仍为`NOT_RUN`，由下一正常B1计划调用补证，不加模型探针。

`bridge/host-github-read.mjs`通过`host.github_read`读取Native登记仓库的固定GET端点，复用宿主gh登录，不把凭据复制到独立任务HOME。无代码workspace也可用，原read_only上界只增加允许的只读工具名，不开放代码或写入。`tests/host-github-read.test.mjs`核对路径/方法限制、响应完整性与列表截断；实际连接及业务结论另行验证，见[连接合同](github-read.md)。

`bridge/team-quality-resume.mjs`与`scripts/resume-team-quality.mjs`提供本人已授权的同目标质量续接。默认preview；apply需停派发、原Root/输入/已发送阻断回执及flow摘要匹配、累计预算足够、尚有第二轮额度。Native根行事务记录稳定resume ID，再投影原flow；同事件只对账投影，不新建Root或run。旧summary、通知、QA与调用历史保留。`tests/team-quality-resume.test.mjs`覆盖预算、scope、事务回滚不发事件和投影幂等。

`bridge/task-call-policy.mjs`统一普通原根默认20次与历史可信12次/QA专项兼容；`scripts/task-call-budget.mjs`只在关闭派发且排空后显式授予原根20次，不改写任何旧预算文件。物理调用、Chief提示、续接、Native失败重试与普通QA返修共用同一上限。`tests/task-call-policy.test.mjs`与原budget/retry/context测试验证累计计数、伪造上限拒绝和原记录保持。

`bridge/team-qa-repair.mjs`和`team-native-runtime.mjs`把普通成功QA的NEEDS_WORK回交原执行子任务，最多两轮；每轮使用新operation/run/session和独有输出，原开发、QA及失败历史不覆写。采集绑定当前dispatch操作，旧QA不进入新reviewedArtifacts。预算不足、需要多项衍生重建或修复负责人不明确时保留可恢复阻断，不冒充Native失败重试。相关驱动与边界见`tests/team-qa-repair.test.mjs`。

`chief-context-paperclip`沿既有预算/物理映射识别受控Chief直接重试的闭合历史，保留未知Native原字段；`chief-context-native`对已持久Owner continue复用原事务kernel，`scripts/reconcile-chief-command.mjs`提供排空后的认证管理preview/apply。相关context及CLI回归覆盖原source身份、JSONB字段顺序、失败ACK保全、同源幂等、后续项目选择、错误输入和pending补充先后顺序；不接新文本、造SDK事件或增加监听/账本。

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

`assets/role-skills/shared/engineering.md`随每run只读能力包提供当前共同工程规则：不采用防御式推进，Skill流程按任务裁剪，复用已有授权及有效相关验证，失败只留必要短记录。支持文件与整体包摘要同步，岗位CAPABILITIES中的包摘要由原生成器更新；不改第三方Skill原文或在途快照。

本轮将执行策略贯穿preparation、Native adapter、CLI gate及宿主transport，broker/MCP使用宿主真实路径和loopback端点。公司库分配与最终CODEX_HOME物化使用同一选择，职责摘要、Managed bundle与权限同步。相关测试覆盖原生和旧Docker模式、完整Skill包、来源去重、依赖、参数、取消与恢复；见[本轮合同](plans/native-skills-20261120.md)。配置预检、真实订阅调用、Docker项目检查及运行切换各自留证。

| 子系统 | 本仓库入口 | 维护与验证 |
|---|---|---|
| M2 项目与本人命令 | `bridge/context-projects.mjs`、`bridge/chief-context-commands.mjs`、`bridge/chief-context-native.mjs` | catalog 绑定 Native project/可选 workspace ID；原 activity 持久化项目/任务选择、补充、暂停、继续与 linked followup。`context-projects`、`chief-context-commands`、`chief-context-native` 同名测试核对契约。 |
| 本人原消息受控补收 | `bridge/chief-official-message-recovery.mjs`、`scripts/chief-feishu-recover.mjs`、M2 service/repository | 官方 GET 验证原 Owner、既有 SDK 单聊、正文 SHA 与原 ID，只恢复 new goal；默认 preview，不造 SDK 事件或直接 wake。`chief-official-message-recovery`、`chief-feishu-recover-cli` 及既有 context 测试覆盖身份拒绝、跨来源并发、ACK 未知与去重。 |
| M2 记忆与协调 | `bridge/project-knowledge-store.mjs`、`bridge/team-context.mjs`、`bridge/team-native-runtime.mjs` | owner-confirmed 当前版本按项目共享/角色私有先隔离后检索；新 session 不带旧任务 history；原根可信额度（普通20次、历史明确12次与QA专项保持）、原操作对账和分代产物保留。对应 `project-knowledge-store`、`team-context` 测试。 |
| M2 材料与配置 | `bridge/role-material-snapshot.mjs`、`bridge/native-role-runtime.mjs`、`scripts/role-container-transport.mjs`、`scripts/context-configure.mjs` | 专用只读 snapshot，manifest/permit/项目/workspace 同域；配置默认 preview、显式 apply，保留旧 RWB primary/回调。`native-role-runtime-context`、`role-container-materials`、`context-configure` 及既有 gate/adapter/preparation 测试；合同见[跨项目专题](cross-project-context.md)。 |
| 通用岗位与能力 | `team-roles.mjs`、`role-labels.mjs`、`role-capabilities.mjs`、`company-role-skills.mjs`、`role-skill-bundles.mjs`、`assets/role-profiles/`、`assets/role-skills/` | 13职业候选含完整Full Stack Engineer，生产旧12保持；默认/补充能力和完整Skill包可核验，方法/工具/业务证据分开。全栈仅前后端开发测试组合，独QA保留；入口字节摘要与files聚合摘要分别对实物校验。 |
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

宿主检查环境与工作树交接由`tests/role-host-capabilities.test.mjs`覆盖：真实登记脚本及直接Git检查保留各自通配语义，父进程四种pathspec污染不进入登记命令，Host的显式文件Git操作仍只处理所选字面路径。inspect核验当前bootstrap与动态HEAD的区别、原回执字节摘要/白名单、配置命令身份及缺失原始退出码，不重跑workspace准备或查询会合并的delivery status。

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

本人2026-11-19取消每日10个新任务的数量硬上限。`AdmissionMeter.reserveTask`与Chief只读预准入均不再按日计数拒绝；同一原SQLite继续记录上海日期及任务身份，全局单执行租约、未知结果核对、每run64次responses保持；根调用槽随后由2026-11-22的`task-call-policy`更新为普通20次，历史明确12次与QA专项保留。`evaluation/candidate.json`以null明确表示无每日任务数上限，预检拒绝旧数字限制，不能仅修改界面文字。离线测试顺序登记26项同日任务并核对原账本、互斥、释放证据和去重。真实实例生效还须绑定同一已验收源码。

`bridge/role-labels.mjs`仅统一显示名；Native名称更新复用原ID。岗位拆分与新增执行器必须另外确认，不能从命名映射推断已实施。

`bridge/team-roles.mjs`是11角色职责与层级清单，Native preparation、材料和最终CLI gate共用稳定角色键，避免清单已增加而最终执行门仍拒绝。`tests/team-roles.test.mjs`检查唯一ID、完整英文显示名、架构下属前后端、质量独立汇报及无额外高管岗位。System Resource Engineer使用独立resourceScope，数据库业务/运行/物理资源职责分开。实际Native创建、启用、分派及通知须独立留证。

## Chief Native控制器

既有queued Native重试的协调器入口按该run的`retryOfRunId`读取真实父行，再交给原`selectQueuedNativeRoleRetry`和Native消费者。operation最初wake对应的run可能是更早的祖先，不能替代第二次retry的直接父行；父行缺失、错误scope、非唯一队列及数据库读取失败均不派发。整tick回归覆盖该差异，正式执行仍由原retry binder逐项核验，不创建替代wake或run。

`bridge/team-native-runtime.mjs`将本人Native输入、结构化Chief计划、角色派发、收回、独立质检及通知接到现有Native服务。`team-plan.mjs`校验根预算、DAG和质量依赖；`role-control-store.mjs`仅保存控制映射/意图/回执。`task-input.mjs`统一title及description输入版本。父子调用共用`role-call-budget.mjs`根预算。

PR30的Native内置retry只绑定已存在的后继run。M2绑定先按原operation/Native task派生局部项目，精确选择同输入/同代际dispatch所属flow；旧flow和其他代际保留。原项目artifact与meter使用该局部绑定，Native control的暂停/pending/输入/计划确认仍在原根事务核对，provider启动守卫继续生效；不增加wake、root或重置原根累计预算。`tests/role-native-retry.test.mjs`覆盖RWB专用workspace、全局默认个人项目不变、旧portable flow及暂停/版本负例，真实重试另行留证。

PR32复用Native唯一queued消费者。若M2本人已暂停/补充或预算用尽，现有后继run仅在原scope、输入和完整physical failure证据通过后settle-only：只读归档、持久幂等回执、精确释放父调用锁，并返回bootstrap NoProvider；不创建operation、不推进flow、不调用模型或新增预算。Native终态与原archive共同证明已结清后，既有phase释放复用`observeContextCallEvidence`及Native租约核对；unknown不释放。`chief-context-native`串联回归验证pause/add→queued消费→NoProvider证据→本人continue同根应用输入；Docker夹具不等于Mini实测。

`native-role-adapter.mjs`在实际QA派发的可信提示中明确JSON契约：verdict仅为`PASS`或`NEEDS_WORK`，`findings`/`notRun`始终是数组，`reviewedArtifacts`逐项匹配可信执行绑定。范围和限制保留在独立字段；未执行验收继续记入`notRun`，必需证据缺失不能转成PASS。上游报告仍作为证据数据传递，不提升为指令。`tests/native-role-adapter.test.mjs`捕获真实`nativeExecute`最终prompt，验证QA协议、精确产物绑定及非QA不受影响；严格collector、材料、权限、预算和调度均未修改。源码回归不代表旧运行报告已修复或真实业务通过。

`team-plan.mjs`的可信Chief协议明确最终飞书发信由run结束后的控制器受管outbox负责；模型仅写summary，并将发信阶段标为等待控制器回执。模型不能自行宣称已发送，也不为这一步发现飞书插件、索取凭据或另发消息；尚无回执不能推断连接缺失或发送失败。其他已授权Apps/Plugins照常用于其指定任务。上述回归同样捕获实际Chief summary派发提示；发送器、通知回执及运行配置不在本次提示修复范围。

`team-result-notification.mjs`复用已有飞书SDK和本人绑定，持久化结果outbox；发送成功不重复调用，未知结果停止等待核对。`scripts/role-transport-resident.mjs`是既有宿主Node的Docker管理传输与只读宿主快照，模型及产品协调逻辑仍在Docker。只读Snapshot不授予系统修改权，使用WorkDisk/原数据卷前核对固定UUID。新宿主开机服务不在本轮配置。

`team-configure.mjs`明确新角色paused纯登记，保护原ID/配置/材料；`team-bootstrap.mjs`串行复用原Native lifecycle，保留真实探针与无新探针的区别。原 M1 阶段的296项离线回归、Native11配置及8新探针是各自时点证据；不能替代 M2 精确候选或多项目真实业务验收。M2 复用原角色，不重跑一次性 team-configure 重建身份。

## Chief 飞书入口

`bridge/chief-feishu-intake.mjs`校验SDK来源的本人单聊、固定应用/租户及消息摘要；`chief-feishu-native.mjs`将登记、发送和唤醒认领保存到Native事务/activity ledger。`chief-feishu-service.mjs`复用已固定的1.76.0 SDK与原连接工厂，默认关闭，唯一主进程监听；不新增依赖、调度器或任务库。测试覆盖身份负例、源消息冲突、并发去重、合理等待、陈旧输入及未知结果不能重发。真实连接、本人发送、Chief分派和通知必须另验。

## 单根QA补核例外

本人仅批准LEO-23根7956bcfe的第七次调用用于原QA补核。`role-call-budget.mjs`在原全局调用锁内匹配受保护授权的owner/company/root/既有child/QA Agent/operation/phase/证据manifest及有效期；仅原目录已有六条时放行一次。第八次、其他角色/目的/Root、换ID或省略父映射均拒绝；未知结果保留原锁。这是历史专项；当前其他根沿`task-call-policy`及其原可信额度，不从该例外提高授权或重置计数。

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
