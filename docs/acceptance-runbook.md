# 受控真实验收手册

## Mac原生和公司Skill验收

公司Skill list/detail的字段投影单独验证；审查metadata需以选定来源的详情为准，不能用手造完整列表夹具代替安装版响应。

本地导入真实集成需证明currentVersion已创建、逐文件摘要一致、重复同步不增版本或Agent配置修订。GitHub源与已审查本地快照并存以及上游frontmatter名称不同的场景，都须验证实际被选版本与条件加载。

按[本轮合同](plans/native-skills-20261120.md)分别验证全部11角色的分配/Managed说明/完整包/依赖/最终CLI配置，以及预算内代表角色的真实订阅执行。核对`process.platform=darwin`、实际宿主cwd、CODEX_HOME、无冲突沙盒参数及原订阅，不能用CLI版本或文件存在替代真实模型结果。

取消、超时、进程恢复使用可控夹具覆盖；真实模型动作结果未知时核对原run。Skill与脚本依赖缺失标为NOT_RUN；其他岗位配置通过不等于其业务闭环通过。切换后的候选、实际调用数、失败和恢复分别写入本轮运行证据。

实际macOS进程身份、进程组和完整host transport夹具仅在Mac执行。固定Node Linux镜像没有macOS的ps接口，且测试临时挂载不允许直接执行文件，因此Linux明确跳过这4项；参数/策略与loopback broker检查仍在Linux执行。必须另有Mac目标平台结果，不能用Linux的skip声称通过。

## 通用角色与跨项目能力

逐角色核对职业说明、默认能力和实际工具目录；补充能力由Chief结构化计划进入原operation/permit，不接受工具参数自签。Skills完整包须可读取并验证依赖引用，MCP目录须与真正允许调用一致。现有版本源码合同测试必须使用固定Native schema/service的合法`metadata.superAgentProject`，不能用不存在的runtimeConfig字段假造通过。

跨两个不同仓库验证Native项目选择、公司/owner关联、隔离工作树、项目规则、知识作用域、已登记checks及交付动作。实际编码、只读验证和远端发布分别留证；只读能力验收使用artifact动作上限，避免发布业务改动。RWB项目规则只影响RWB。

宿主Git/check与选定MCP要有真实入口结果；网络/资源事实来自宿主。QA在干净的精确候选上独立执行，发布消费Native QA与实际检查记录；旧SHA或自签结果必须拒绝。取消包装进程时核对其后代退出；命令失败应把脱敏的退出码和定位信息返回模型。网页保存及历史保留沿前节回归。

Native全局scheduler保持原受控关闭状态。恢复既有scheduled retry时用官方retry-now，记录同一run变为queued；现有team tick仅在当前登记work-step和全局唯一queued匹配时调用Native消费者。scheduled、其他任务、其他active行与陈旧输入不得触发消费；claim返回仅证明Native已认领并安排执行，不能当provider/业务成功。执行前仍须通过retry binder，不重置锁、预算或会话，不另起wake/run。

## 角色指令网页保存

迁移11角色前记录每个角色的Agent ID、原adapterConfig/runtimeConfig、manifest、旧材料摘要及既有运行数量。排空后用精确文件集合建立独立Managed bundle，每个列表只含自身角色的可读路径，旧UUID文件及历史不删除。迁移后逐角色核对入口、内容摘要和非指令配置保持一致。

在已认证Chrome打开角色Instructions，确认Managed、`<role>/AGENTS.md`和无修订模式错误。通过Edit保存一个无行为影响的标记，刷新后读回，核对registry摘要与历史快照；再从相同网页恢复原内容，验证两次变更都可追溯。受控执行预检必须读取最新摘要，run副本应固定本次字节。普通网页保存、非模型预检和真实模型运行分别报告，不能将预检当成模型已经执行。失败恢复与角色间材料隔离由相关回归覆盖。

## 前置条件

- 文档、候选回归和独立评审通过，同一候选的镜像、依赖和源码可追溯。
- 远端仓库已建立；用户已改为 public。本项目自动合并前，必需 CI、independent-review 状态和分支保护真实可用。
- 核对实际运行目录的拥有者和未提交状态。无活动或未知任务、run、租约或外部动作，方可更新；并发候选保持保护。
- 新鲜宿主磁盘证据至少 5 GiB，专用 APFS 挂载正确；按上海时间保留新任务统计、取消每日数量硬上限；全局单写与模型调用预算在实际入口生效。
- 业务许可精确绑定任务、项目、候选、模型、推理档位、workspace、动作上限及有效期；开发与评审独立会话，确认实际加载 Skills。hello 许可不能执行业务任务。

## M2 跨项目续接与记忆

命令与作用域合同见[跨项目专题](cross-project-context.md)。2026-11-20的515/515仅为加入配置工具前的首轮本地Docker回归，既不是最终候选总数，也不证明Mini激活/真实业务。下列M2现场项目当前均为`NOT_RUN`，按同一组合候选保存原始回执；不拿模型自述替代机械证据。

| 必须取得的现场证据 | 通过边界 |
| --- | --- |
| 精确源码/镜像、配置preview与apply、排空和唯一飞书连接 | Mini实际运行指纹匹配组合候选；原11角色/Native配置保留；RWB旧primary/callback不变，无第二监听。 |
| 两个真实项目与持久选择 | 本人projects/project/status、重启后恢复选择；task/flow/operation/permit/cwd及可选workspace ID一致，项目查询不建task/不调用模型。 |
| 同根两轮补充、等待与继续 | 保存本人原消息、pending应用时点、新旧输入SHA、分代artifact；原预算累计≤6，先对账已登记dispatch；重复消息/UNKNOWN不换operation、不重复模型/通知。blocked重规划不足三次时零新调用并明确受阻。 |
| 普通继续及可选plan-first | 默认目标无额外审阅；同版本暂停/continue复用原计划，plan-first只暂停一次，补充后continue按最新要求执行，无复制64SHA门。 |
| done后的独立新目标 | 本人显式followup产生linked新根且无parentId，旧六次账本不变；failed/UNKNOWN/原结果修正不能走此路线。 |
| 新Task和全新session召回/更正 | 本人remember后完成A；B无A history/预装答案仍引用实际记忆ID/version/source hash。本人correct后C新session取v2，旧版本可查。 |
| 项目共享/角色私有隔离与显式share | 两项目及不同role的负例由读取范围、mount/broker原始证据证明；本人share后只目标共享分区可读。legacy明确historical-reference，不伪造确认；材料快照无跨项目可读文件。 |
| 实际能力、闭环与收尾 | 保存本轮Skill读取/选定工具真实调用、Chief派发/收回/QA、精确artifact、本人飞书最终sent回执，核对零在途角色容器/调用锁；未执行项继续NOT_RUN。 |

以下网页、RWB和个人M1章节保留各自原专项及历史验收合同，不能据此恢复旧入口或扩大M2动作范围。M2不接管RWB旧callback/primary或其发布流程。

## Chief 网页续接试点

原任务 LEO-4 对应 RWB #261。历史飞书回执确认原版已完成且调用账为 8/8。网页试点验证本人对话下的一次补充、同任务和同 PR、精确候选确认，以及等待 CI 时的专用应用恢复。原任务两轮反馈修复已用完，额外一次开发和一次独评按新输入版本单独授权，Chief 调用另记。

离线路由、面板客户端、Chief 调用证据与策略用例覆盖同源、成员关系、身份、对话代际、并发重放、过期、旧 head、暂停与确认竞态及响应丢失。原生网页、回合收尾、并发认领和执行重放、固定版本任务和对话行锁、真实持久事务、模型调用和运行验收分别留证。

## 网页新建任务演练

1. 从候选的干净检出启动独立实例，记录源码 SHA、镜像 ID 和依赖锁摘要。以专用测试账户打开原生 Chief 对话，安装候选携带的本地插件。
2. 在 Chrome 点击「新建演练任务」一次，记录 Native 任务 ID、请求 ID 和操作 ID。关闭演练标签页，核对同一任务自动进入等待模拟 CI，执行租约已释放。
3. 在模拟 CI 未送达时仅重启演练应用。核对同一任务仍等待同一候选，旧候选 CI 不改变状态。发送匹配事件，再重发同一事件以核对幂等。
4. 重新打开同一对话，核对任务、候选、终态和回执。关闭入口并确认无待执行任务或持有的租约。验收回执区分首轮历史 #261、此次演练及后续真实业务。

## 两条限定任务

真实 Chief 新任务试点只写 `docs/super-agent/chief-task-verification.md`。从同一对话发起初稿，再提交一次补充。逐轮核对任务、输入版本、开发和独立评审证据以及候选确认。验收须对应同一 RWB PR 的两次 head、第二次等待 CI 时的应用重启、最新 head 的真实检查和原对话终态。受控租约和六次以内的模型账本另行留证。

完整镜像复验使用独立允许路径 `docs/super-agent/chief-browser-acceptance.md`，复用同一流程。首条和补充都从 Chrome 原生编辑器发送。启动后核对应用只有依赖、私有交接及数据卷挂载，恢复模块随镜像打包。

常驻试点启动前核对第二版私有清单中每个 Chief 和对应原生对话。离线验证重复 Chief、调换两个对话的 Chief 绑定及其他用户均会被拒绝。真实验收逐条核对当前对话的任务、PR、最新 head 的 CI 和租约释放，再开放下一条。

受控恢复后重启监督器时，验证原对话未到成功终态或共享租约仍存在时保留阻塞。只有同一绑定对话提供匹配最新 head 的成功终态且排空后，才登记这条回执并开放下一槽。

验证 CI 查询传输故障后保留原操作，旧 head 的检查不能结束任务。补录成功时检查原失败回执仍在，同一对话显示对应 head 的真实结论，模型账本与发布次数保持一致。

双任务验收使用同一个 Native 对话，提交两条分别包含开放文件路径的要求。第一项完成、真实 CI 回写且租约释放后，第二项才开放。记录两个 Native 任务 ID 和两个 PR。第二项首次发布后，在同一个对话追加一次针对同一文件的要求。核对原任务、分支、PR 和更新后的 head，确认第二个 PR 的最终 CI 与第一项的历史回执同时可见。

单一镜像贯穿验收另用 `docs/super-agent/chief-single-image-verification.md`。核对同一镜像、两个 Native 输入、一个任务和一个 PR，以及真实 CI 等待前后的应用身份。通过后启用有时限的常驻白名单，连续验证前两条文档任务，保留第三个受限入口供试用。

开发若在模型启动前停于资源登记，核对同一操作的保留失败回执、原租约、原工作树和调用槽。回归覆盖精确证明后的原操作续跑，以及基线漂移或脏工作树时继续阻断。

首次发布的推送前恢复另行核对原候选和确认期限、原推送证明与远端分支及 PR 均不存在，以及恢复认领仅一次。回归覆盖恢复后只对账，并保留同一任务和原发布操作 ID。

工作区回归覆盖明确的锁拒绝先等待、同一候选准备仅生效一次，以及暂停或回调已开始时阻止重复执行。

第一条：在 Paperclip 建立 Super Agent 文档任务，仅补充真实任务操作指南。隔离修改后独立评审，经过本项目本地检查、PR、CI 和受保护自动合并，回传结果。

第二条：在已绑定本人飞书验收会话发起 RWB 文档任务，新增 Super Agent 受控任务交接说明。使用 RWB 自身 Git 安全入口、隔离工作区、独立评审及必需检查，创建 PR 并回传。最高动作是 PR；不合并、不部署、不触及 RWB 常驻服务。

两条均固定现有订阅 `gpt-6.1-sol`、`model_reasoning_effort=low`；不转 API、不换模型，最多两轮修复。输入和决策回复绑定原任务及版本；未知模型、PR 或通知结果先核对，不重发、不重试。既有其他任务的旧 PASS 或不同推理档位不能代替这两条验收。

## 行为与故障验证

镜像复用先用离线夹具验证。相同构建输入只建一次，输入变化产生新标识，已登记 ID 漂移、未登记同名镜像、低盘及并发均停止构建。另用离线夹具验证验收回执、容器引用、配置保护、归档和单镜像退役。真实 Docker 构建、Compose 启动和宿主退役各自留证。

用离线夹具验证低盘、过期许可、跨任务或模型不匹配、并发写者、无任务数上限的日期统计及模型预算、重复事件、决策重放、CI 等待释放、重启核对、丢失远端响应和候选变化。保留原失败，不删除必需验收。不能靠真实调用耗尽配额，也不对未知任务注入重启。

## 证据与终态

每条记录任务 ID、输入版本、候选 SHA、运行镜像/依赖、模型与 low 档位、开发/评审会话标识、Skills 证据、验证结果、PR、精确 head 的 CI、合并状态和通知回执。提示与秘密不入公开证据。

状态分别记录源码交付、运行升级、业务验收和资源收尾。任何源码变化都重验受影响行为并重绑候选。

1. 构建前通过 `./scripts/sa image-build` 查找匹配的登记，优先复用镜像，并记录本次精确镜像 ID。
2. 业务验收通过后关闭新派发，核实终态并释放自有租约。确认共享租约和模型工作进程均为零，保存绑定本次镜像的验收和排空回执。
3. 资源所有者按[镜像收尾计划](operations.md#镜像构建复用与退役)核对镜像归属、真实启动配置和回滚配置。执行 `./scripts/sa image-closeout <plan-name>`，归档退役候选后逐个清理，并记录保留和删除结果。未执行的收尾记为 `NOT_RUN`。缺证、引用不明或删除结果未知时保留现场，未决资源记为 `BLOCKED`，业务验收沿用原回执。

当前阻塞及证据见 [当日状态](governance-status-20261104.md)。此手册不是执行成功回执。

飞书自动 RWB 专项使用本人私聊 `/rwb`。首条消息写需求，另起一行 `文件：` 后逐行列出允许修改的仓库相对路径。核对精确路径、预先选定的必需检查、任务 ID、输入版本、PR 和当前 head。文档和代码各接一项，代码初版结果回到私聊后，用 `/rwb <任务 ID> 补充 <要求>` 续接一次。核对所有发布证据和真实 CI 后再登记试点验收。重复、身份不符、范围扩大或外部结果未知时保留原操作和结果回执。

通用入口用 `/任务 <项目名>`。离线用两个注册项目核对消息路由、独立文件范围、准入账本隔离和同项目续接。未知项目和跨项目补充应被拒绝。此检查只证明接单契约。每个项目的真实 PR、CI、回传和恢复分别记录运行验收。

历史调用审计修复须用同一组真实历史证据复现原拒绝，并验证修订后的闭合证明。变造 run 标识或缺少 Native 终态仍须拒绝。恢复原任务前分别核对当前角色、输入版本、原操作、已关闭写入窗口和零模型调用。

## 本人 /chief 入站验收

先核对原唯一连接已释放、固定 app/tenant/open ID、Native owner/project/Chief绑定和宿主执行传输健康，再开启专用服务标志。仅在实际 connected 后请本人发送一条新的 `/chief` 目标；不代本人制造入站。保存原消息ID/摘要、Native root、首个Chief run、createdByAgentId的子任务、交接产物及最终通知。重复投递必须返回同一个task；unknown wake/send只能核对原结果，不能重置claim或换ID重试。关闭入口只停止新接收，原任务/调用/活动账本保留。

维护期间未被 SDK 受理的本人原目标，另验官方消息补收：保全实际 API message ID、create/update 时间、body SHA、sender/tenant 与旧 SDK 单聊绑定；preview 前后 Native 任务、ACK 与运行数不增。apply 仅首次登记原 ID 的 new goal，重复 API、SDK/API 交错与并发均复用同一操作；未 claim 的登记 ACK 可以对账，claim 后未知不重发。必须标记为官方 API 验真补收，不写成平台 SDK 重投；无 eventId 就不虚构。原消息即使有编辑标记也须预期摘要匹配，删除或版本漂移零效果拒绝。新任务/模型是否真正执行、最终飞书回执及多轮/记忆业务分别取证，源码夹具不替代本人实机来源。

## Native内置重试验收

父角色run失败后，先只读核对Native已存在的`scheduled_retry`、父run、attempt序号和原子任务。不得另发manual wake或新建root。本人认证的`POST /issues/:id/scheduled-retry/retry-now`只推进原有run；Agent pause会取消scheduled retry，不能把pause/resume当作原attempt的无损暂停。

后继run进入执行时核对：父run终态及结束时间、host result的run ID和非unknown/非超时/非取消、stdout/stderr实际SHA、原budget/operation映射、root/child输入版本、当前唯一Native执行与父Native租约释放。只对精确匹配的旧call锁归档和清除；失败产物有自己的run/operation/file/SHA只读archive。核对新operation的`acceptedRunId`为原Native后继run、`retryOfOperationId`指向旧操作，flow历史保留旧dispatch，Admission nonce、同child/root/session保持。确认物理调用开始后仅新增一条原根预算记录，六次上限及最多两次修复不变。

另验本人pause/add与已queued retry并存：后继run核实原物理失败后只能settle-only，保存同一原锁的immutable archive及settlement回执，以bootstrap NoProvider终结，不建新operation/advance flow/花预算。核对实际Native终态、环境租约释放与原Admission phase回收后，本人continue仍应用同root补充、旧hash/产物/预算保留。任何未知输出、scope/hash变化或锁漂移仍保留现场；不能凭模型或settlement日志声称Native已经终结。

离线回归覆盖伪造context retry声明、未启动的scheduled run、Native父关系不符、unknown/超时/取消或摘要错误、活动执行/未释放租约、输入改变、满额预算、错误锁和archive冲突。任何拒绝都保留旧证据。源码回归通过不代表真实重试、工具审批修复或业务验收已通过；这三项分别以实际Native和host回执记录。
