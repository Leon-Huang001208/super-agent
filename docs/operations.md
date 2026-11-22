# 运行维护与恢复

## 可读的飞书成果回执

先读任务标题和当前阶段，再用短编号定位原任务，查看状态、原因和下一步。“本轮结果已汇总”不等于所有业务或部署已完成；质量复核未通过时进度明确暂停，不把已用调用或已收到的文件算作完成率。标题或业务进度未知时如实说明。质量阻断显示中文解释，内部UUID、错误码和SHA留在同一任务的技术记录中。通知日期取原outbox创建时间并按上海日期显示，不能用通知日期冒称成果版本或包发布版本；预算缺少可信读数时不填默认值。

展示更新不改原产物或已发送回执。`sent`不得为换文案重发，`unknown`先核原message／outbox，不恢复旧许可或另建任务。源码经检查、独评和CI后，只在当前持有者确认无在途模型的自然安全窗口切换；旧通知保留，后续新通知再验证实际文本。

## 已登记子任务的受控入口拒绝

修复已有queued retry的运行源时，queued不称为空闲。限定维护须证明仅有本次原队列行和匹配预留phase、未启动物理执行且无其他写者；保持team派发关闭，直到正常App、host、飞书入口、source pin与完整Native/材料/预算保全核验完成。最后恢复team后，由同一协调器自然消费已获授权的原queued行；不重复调用retry-now，也不为继续比较旧行摘要而停止已启动模型。

已绑定SDK可在明确`team.enabled=false`时建立连接，未知开关与app/owner身份变化仍拒绝启动。连接就绪不授予派发权限：入站登记、项目选择和drain继续由原`currentScope`要求team开启，暂停期间不创建任务或消费原队列。

普通Native文档任务沿`projectForOperation`解析当前项目的受管产物目录，不要求旧operation具有M2目录字段。原始bootstrap失败后的首次retry若在受控入口返回、没有进入provider，可在保留其`reconciliation/null`历史的前提下核对既有第二次retry：必须具备完整Native三行关系、唯一前置返回合同及Native只读reconciliation通过，并重验原owner/输入/flow/QA代际、phase、全部进程与环境租约、零物理证据和剩余额度。只读核对使用`mixed`结果，不代写“未执行”或调用带continuation副作用的resolve入口。

后续仅由已装配受控adapter的常驻App消费该既有retry；不打开全局scheduler、不重置attempt、不补写旧operation/预算/permit/transport。第一次受控恢复再失败时保存原结果，先核对同一operation，不能通过新任务或手动回退状态绕过。

## 20次预算及已完成原根续接

2026-11-22起普通原根默认20次，Chief/执行/QA/续接共用累计；历史12次与专属QA记录保持，Owner可明确升至20。`scripts/task-call-budget.mjs --task-id <原root> --maximum 20 --approval-source <本人授权来源>`默认preview，`--apply`仍需本人会话、停派发和真实排空；已登记done根可仅修正额度，不因此重开或唤醒。

维护派发使用`node scripts/team-dispatch-control.mjs --action status|pause|resume`。pause/resume默认preview；apply还需稳定operation ID、preview给出的`--expected-registry-sha256`及`--approval-source`。它仅改派发布尔值，保留旧值和意图，拒绝活动run/call锁/未结清租约；同操作丢回执只按精确已发布状态对账。

长期RWB开发接线用`node scripts/register-rwb-development.mjs --request <私有JSON> [--apply]`。新建代码workspace并更新项目执行策略与catalog指向，保留旧workspace，不逐任务重复授权。真实源码只读挂给App；代码写入仍在宿主独立worktree，准备/发布/合并使用RWB原GitSafety及Native QA证明，不用通用Git旁路。

`node scripts/resume-completed-team.mjs --request <私有JSON> [--apply]`只处理本人明确确认原目标未完成的已结清done根。请求绑定原task、输入/flow/新workspace摘要、已用次数、稳定resume ID及continuation；apply先保全旧产物，Native事务记录Owner恢复事件，再投影新控制代际。旧根/调用/QA/summary/通知不重写，不新建Task或模型run；恢复派发后由原coordinator继续。

运行源更新须同时核对App只读挂载、宿主transport source/cwd和登录恢复脚本的source pin。保留原Compose、源码、启动恢复及预算指纹；没有真实排空不重启App或transport，不重启Docker Desktop。源码/CI通过不等于现场已改为20或已开始新代。

## Agent迭代发布

### registry读取与零物理尝试续接

Native角色注册读取和控制层统一采用4 MiB的registry合同；其它私有JSON的1 MiB限制保持。合法registry因旧单点上限拒绝时，修复读取端并保留原operations、任务和预算，不通过清历史或缩写旧输入过门。实际registered路径及材料ready检查都需要回归，不能仅证明通用读取器可读取大文件。

已登记的非Chief子任务若在首次物理执行前失败，只有官方Native已保存`bootstrap/providerWorkStarted=false`、精确失败类型及首个自动retry关系，且原agent/Chief wake、root/input/flow、预留phase nonce均匹配，同时不存在permit/claim/transport/opbinding/budget/call.lock等物理证据，才可沿原operation继续。保留原失败和已有调用，不新建operation、root或wake；正常producer第一次为原operation写successor绑定并计费。未知或矛盾证据保持reconciliation，不把文件缺失当作未调用模型。全局scheduler关闭时由Owner仅推进已存在的单Issue重试；预留phase lease必须保全，不能为了普通空闲检查删除或退款。

### 大型role permit的采集合同

公司Skill snapshot继续最多8 MiB，完整role permit包括该快照和运行材料元数据，统一最多12 MiB（序列化JSON含结尾换行的UTF-8字节）。生产端在持久化operation binding/permit前检查同一上限；所有正式permit读取路径使用该专用合同。普通控制文件仍最多4 MiB，私有mode、owner、常规文件、symlink及hardlink检查保持，不通过全局放大控制文件上限解决单个permit问题。

成功运行的产物采集若因合法大permit被旧读取上限拒绝，保留原permit/claim/run/session/产物与已用调用，修复读取合同后由原coordinator接续采集。不得重跑已成功的Document任务、编辑旧permit、减少已绑定Skill，或另建替代任务绕开证据。超过12 MiB的新permit在provider启动前以`NATIVE_ROLE_PERMIT_TOO_LARGE`拒绝；该原因沿原adapter错误通道保留，并标记已知未启动provider，不降为未知或记录permit正文。这项大小合同不放宽原任务/角色/工作区/claim校验。

### 产物工作区和再生缓存

无代码产物目录明确登记为Native `sourceType=non_git_path`、可信owner及`delivery.maximumAction=artifact`、无repository.hostPath；远端fullName只供只读GitHub工具，不能据此把目录当作checkout。固定版本进程内hook仅对受管Mac角色与真实Native绑定全部成立的目录免除缺Git错误；持久工作区/CWD/项目一致性及代码/PR任务的Git检查仍保留。不得用创建假`.git`、改整个Native校验器或清M2 catalog绕过错误。旧local_path需在排空后由Owner明确改类型，配置工具不会悄悄迁移。

启动时由`role-preload`在instruction hook装配期间主动加载并严格验证artifact补丁，之后才安装执行器、启动协调器和飞书。飞书初始化及协调器都可能提前导入Native heartbeat，不能只在server-entry安装首次Hook。server-entry复用同一模块私有的已验证初始化；此前未知、未打补丁的ESM缓存会报`ROLE_ARTIFACT_WORKSPACE_HOOK_NOT_APPLIED`并停止，不能删除verify或把维护模式健康当作正常入口启动证明。切换验收分别核对维护和飞书开启的fresh process、真实入口就绪及原任务保全。

Native Agent原始配置中的`SUPER_AGENT_ROLE_ENABLED`可保存为plain绑定对象，而adapter执行时才获得字符串。产物守卫仅在该原始值明确等于字符串`"true"`或`{type:"plain",value:"true"}`时认可角色开关，不为此解引用秘密或修改Agent配置。出现`ROLE_ARTIFACT_WORKSPACE_DENIED`时分别核对真实原始行、caller工作区与owner wake；模型启动前失败仍保留原run、恢复动作与零调用记录，不用终态已清空的run指针推断启动时字段。

Native npm缓存默认复用WorkDisk下项目专用工具缓存；本run HOME仅新增纯cache配置，不链接或复制宿主`.npmrc`，不混入token/认证，不更改package版本或执行安装。卷身份、canonical路径、UID及权限在写入前核对，已有用户配置拒绝覆盖。`native-proof.npmCache`仅记录配置与卷验证；实际依赖启动及业务结果另行验证。

Native Codex插件代码缓存使用`/Volumes/WorkDisk/Caches/SuperAgent/codex-native/plugins-cache`，仅链接本run私有`CODEX_HOME/plugins/cache`，不移动或链接整个plugins。`plugins/data`、HOME/CODEX_HOME、auth、config、sessions和SQLite继续在原私有目录。该路径是独立的Native可变代码缓存，不能指向sealed retirement恢复副本，也不把宿主凭据或整个Codex用户目录共享。CLI返回后复核链接仍指向预期目标；链接丢失或被替换时保留失败，不静默改回Data盘或修复旧cache。

本机CLI为0.171.0；官方同版本源码把cache固定在Codex home的`plugins/cache`，并在目标父目录中创建staging及完成rename，[存储实现](https://github.com/openai/codex/blob/ccf9be8cc458bd6b8336fe84d68d8893f2691a5e/codex-rs/core-plugins/src/store.rs)与[配置schema](https://github.com/openai/codex/blob/ccf9be8cc458bd6b8336fe84d68d8893f2691a5e/codex-rs/core/config.schema.json)未提供独立cache路径设置。仅cache链接的方案据此实现，fake CLI只证明文件系统写入路由；真实Codex执行兼容仍为`NOT_RUN`，在下一已授权正常计划调用检查实际cache落盘及私有状态，不额外消耗模型探针。共享缓存沿已有全局单Native执行使用，不新建控制器或锁；结束单个run不能把其链接目标当作私有临时目录删除，清理共享代码须另核当前引用和租约。

容量不足先由System Resource Engineer区分可再生缓存和业务状态。退休当前任务缓存需终态/租约/自有进程组及实际文件引用证明，独立副本读回后逐路径处置；活跃、未知或外部引用不按名称放行。lsof非零且有输出不能当完整无引用证明；用独立查询完成正向分类，部分失败沿同一intent和已删除清单对账。日志、会话、SQLite/WAL、预算、Skills和原产物保护，不降低准入门槛或重启整个VM。

### GitHub只读通道与原质量任务续接

连接按[GitHub只读合同](github-read.md)配置。Native workspace远端身份经Owner接口登记，保留metadata原有内容、无代码hostPath及artifact上界；不因接通读通道开放GitHub写入。先修实际工具缺口，取得原操作的可核验证据，再在安全节点恢复原质量任务，避免继续花调用等待同一外部条件。

质量任务因预算不足阻断后，既有本人分档授权可经`task-call-budget.mjs`以`--maximum 20`显式授予同一原Root额度；合法历史12次档与旧budget文件保持。`resume-team-quality.mjs --task-id <原root>`只读返回flow SHA；`--apply`另需稳定`--resume-id <UUID>`和同一`--expected-flow-sha256 <SHA256>`。要求team派发关闭、无活动run/未释放环境租约/call锁、原owner/输入/阻断摘要匹配、至少3次剩余额度、尚未完成两轮。未知模型或传输失败不走这个入口。

应用先在Native根行事务记录owner恢复事件与in_review状态，提交后发布Native通知，再保存原flow投影；若文件保存前中断，同一resume ID按已提交事件只对账投影，不重复Native转换。旧质量阻断、summary和已发送通知存入同一flow历史及不可覆盖归档，旧run/session/产物/预算保持。该入口不唤醒模型；恢复原派发后仍由既有coordinator沿原执行/QA子任务进入下一质量轮，不重规划成替代任务或提高最多两轮限制。

源码经PR、检查与独评后，在同一实例排空的窗口更新原App/宿主传输及启动恢复入口，保留Mac原生策略、12岗ID、公司Skill、原任务/调用历史和飞书入口。运行升级与RWB业务部署是不同写窗口；原任务持有窗口时不并发切换RWB。

### 已保存继续请求的原意图对账

本人真实continue已经保存Native intent、因核对门拒绝且未产生effect/result时，先修复具体状态判定，保留原消息、失败ACK和预算。在关闭team派发、确认全部Native run/队列/环境及phase租约/call锁均排空后，认证Owner可运行`node scripts/reconcile-chief-command.mjs --request <已核私有请求JSON>`只读预览；加`--apply`才在原Native事务中消费同一操作。请求仅绑定原task/company/project/sourceKey/operation及输入、control版本和来源摘要，不接受新正文、消息ID或Owner身份。

来源由唯一Owner intent读取，按原固定schema重建JSONB字段次序并核对原parse/body/fingerprint；不把重建数据投递成SDK入站。应用不调用模型、不创建目标、不改已用调用或旧null、不重发ACK/通知，也不回退后来本人的项目/任务选择；返回成功不等于后续业务通过。必须先完成原意图对账，再恢复coordinator处理pending补充；反向顺序导致旧输入不匹配时保留拒绝，不修改摘要来迎合。再次调用同一已应用请求只读原result；部分结果或未知保持原件核对，禁止另建操作重放。

角色材料用`publish-role-profiles.mjs`经Native Owner/CAS保存。升级可通过`--baseline-profiles <私有JSON>`提供上一现役源码生成的24份文本（键为`<role>/AGENTS.md`或`<role>/CAPABILITIES.md`）。当前文本既不等于目标也不等于旧生成基线时保留整岗材料并报告`custom_content_preserved`；不把人工定制当作旧模板覆盖。旧内容和在途run固定快照保持。源模板发布不等于对应岗位业务验收。

原根授额用`scripts/task-call-budget.mjs --task-id <原root> --maximum 20 --approval-source <既有本人授权来源>`预览；只有`--apply`写可信原任务额度记录，要求关闭派发、无活动run/call锁及真实Owner会话。原budget目录全部保留，不因授额20次或重新规划退款；不再新建12次授额。

本人创建、尚未唤醒且属于已登记项目的Native根任务可在首次Chief调用前显式登记20次额度；这一步只保存额度，不登记执行、不增加调用或操作历史。已经运行的原根仍沿其登记与累计记录处理。

`host.rwb_release`只接受Native项目metadata中该root的登记操作ID，且执行者必须是DevOps本岗、当前Native操作绑定吻合并持有该action。`inspect`只读取本地受管回执，不刷新远端CI、不调用会合并的status。`merge`复用RWB GitSafety，`deploy/rollback`复用其现有resident CLI；跨Git common的证据transfer仍是RWB原发布窗口的独立前置，接口不改`source_common`。部署source tree须等于审查候选，旧版/当前版与真实accepted一致。回滚传`--rollback-target CURRENT_ACCEPTED_SHA`，由原sealed capsule决定恢复前版。原host-call队列按登记operation ID去重，started未知只核对，不以新RPC或新run重放。

合法发布可能含450秒构建和180秒安装，单独使用固定有界时限：命令30分钟、RPC31、MCP32、Mac进程35、broker准入36/退出36.5、transport37、Native adapter40。只有可信DevOps发布任务启用；普通工具及任务不变，五分钟permit仍只管启动。长响应使用本次CA和有限HTTP请求，无自动重试；取消继续等待自有进程组收口，未知保留原受管操作。

## Document Specialist 单岗扩展

遵循[文档岗合同](plans/document-specialist.md)，仅在当前运行Owner协调的排空窗口新增第12岗。source/Native新Agent/registry/catalog/材料及ready需配套，不能先在旧源创建paused占位；不重跑旧11岗configure或bootstrap。当前Research既有error或其他旧岗问题由原窗口核对，单岗工具不得修写其他角色。恢复入口前保留完整名册ready证据；失败不伪造验证或擅自回退丢弃新配置。

## 原生Agent切换

Native HTTPS 与原首计划恢复按[专题合同](plans/native-https-recovery.md)进行。不能把 `chatgpt_base_url` 指向 HTTP loopback 来适配要求 HTTPS origin 的 CLI，也不能关 TLS 验证或直接绕过 broker。证书、CLI/Node 信任和就绪端口均限本 run；先用无模型握手与恢复合同验证。第二次 Chief retry 仅接原 Native 已有行的明确 HTTPS-origin/零 response 失败，旧锁先按真实证据归档、预算不退款，未知结果不重复 POST。

保持原AI连接时，配置更新不应触发无许可generic hello。固定源的进程内AI equality修复只纠正键顺序误判，不能关闭真实连接变更验证；源SHA漂移应停止装配。首次分配官方paperclip操作包也须有Native版本快照，包含其全部references/scripts，不能仅把SKILL.md登记为完整能力。

安装版公司Skill列表是轻量视图，不携带完整metadata。同步只为本次审查清单命中的sourceLocator读取已认证详情，核对id/company/sourceLocator后补充reviewedSource；不把列表缺字段当成审查记录丢失，也不批量拉取无关技能的正文。

实际安装版的本地目录导入不会自动建立currentVersion。同步工具对新导入和已导入但缺版本的包，先核验完整目录，再通过原生`POST /companies/:companyId/skills/:skillId/versions`创建唯一缺失快照，回读逐文件比对后才分配；已有版本不覆盖。`--asset-root`和`--package-root`必须指向公司已登记workspace或受管Skill目录中的任务专用暂存，不能放宽后端目录边界。并存的GitHub自动导入条目保留，优先选本轮已审查的固定版本。

当前飞书监听要求team已启用才能启动。暂停派发维护时先在本次Compose中暂时关闭飞书监听，应用保持可访问；完成配置和验收后恢复原team状态及监听开关，不能把team暂停和原监听启用同时作为应用启动配置。

已登记但首Chief计划在Gate启动provider前失败的目标，不重发飞书消息或执行补收apply。先保存真实失败与Native既有retry、原budget/operation/permit/Admission及无host启动证据，修复参数契约和bootstrap恢复后再处理原run。现役源码、已安装adapter与宿主resident须匹配；合法Native bypass顺序由调用门识别，不能改回Docker或关闭策略来试通。若全局scheduler关闭，原`scheduled_retry`需要通过Native限定Issue的retry-now/promote接口进入原队列；不打开全局scheduler，不在未装配受控adapter的管理Node中直接执行原始adapter。未启动的scheduled retry不是活动模型，但仍是必须保留并纳入交接的Native状态，切换前须确认没有执行/claim及没有其他工作占用，并保存原恢复关系。

本轮经本人授权采用[Mac原生执行和公司Skill](plans/native-skills-20261120.md)。切换前暂停新派发，核对Native无running/queued/scheduled_retry、无本次活动调用，保全当前Compose、registry、Agent配置及Managed指令版本。通过验证的源码候选与宿主执行器必须一致，不能只修改UI中的bypass开关。

保持原Paperclip数据库、登录、飞书监听与项目服务。最终模型进程迁到Mac，每run broker与临时文件按原run收尾；项目Docker检查使用已登记镜像和命令，失败不安装替代依赖。原执行策略保留为回退配置；未知结果保留原认领和证据，不先回退再重跑。

在应用容器中，`node /opt/super-agent/role/scripts/sync-company-role-skills.mjs --inventory <已审查清单> --package-root <固定完整包目录>`默认只读preview；排空且team暂停后加`--apply`，再运行`publish-role-profiles.mjs --apply`同步Managed说明。公司API不支持的审查metadata仅在原owner认证后按精确company/skill行补充，并保留Native activity；固定GitHub源码包的本地导入不能冒充GitHub自动同步。

代表角色验收使用`native-skills-acceptance.mjs`：默认status，`--init --apply`幂等建立独立根及六子任务，之后分别指定`--role research|pm|frontend-engineer|qa|network-engineer|system-resource-engineer --apply`串行执行。仅`--reconcile --apply`可核对原run，不重试失败/未知调用。它保留原r.taskId、team flag、Agent及历史；六角色共用新根原有六次预算，只有真实终态和输出摘要核清后释放自身lease。

## 岗位能力与项目接线

项目代码配置由Native项目workspace API写入`metadata.superAgentProject`，包括源仓库宿主路径、任务工作树根、已登记checks、交付入口、宿主动作和选定MCP。只读/非代码项目可没有代码仓库。任务工作区与项目知识按Native project ID绑定，旧记录不搬迁。

角色先读取项目实际提供的AGENTS或其他规则。项目未提供AGENTS时，依据现有文档及共有工程规范完成已授权的只读验证，不为满足文件名而修改目标仓库；项目明确要求的规则仍是约束。Skill校验应将单个入口文件内容与`entrypointSha256`比较，文件集则按索引files清单聚合并与`fileSetSha256`／原`source.sha256`比较，不能混用。材料澄清不覆盖原QA结论或旧运行证据。

代码项目的Native `workspace.cwd`须指向app可读的Git源码，例如将源仓库只读绑定到`/registered-projects/<key>`；不要把非Git产物目录登记为该代码workspace。
项目通过官方API配置`executionWorkspacePolicy`：`enabled:true`、`defaultMode:"shared_workspace"`、`sharedWorkspaceConcurrency:"serialize"`、`allowIssueOverride:false`、`workspaceStrategy:{type:"project_primary"}`，避免Native在只读源码内新建worktree。
原Git校验完成后，角色适配器将实际Actor cwd切换到Data中的`<project>/_default`非Git产物目录；任务代码工作树仍在Projects，另挂`/workspace/project`。

`publish-role-profiles.mjs --apply`要求暂停本团队新派发且无活动run，通过现有本人会话执行真正的网页文件读写接口；CAPABILITIES先保存，再CAS更新入口AGENTS，Native保存链保留旧内容并同步摘要。同内容重跑不增加变更。恢复原团队开关后才启动Chief主服务，避免把维护暂停误判为部署绑定错误。

材料发布只保存Managed AGENTS/CAPABILITIES，保留原Native Agent简介及连接配置；简介PATCH会触发连接验证，材料发布不需要这一步。

新运行候选必须同时包含bridge、docker与完整Skill资产包，provider broker需要其只读源码挂载；Actor另挂选定Skill入口、只读包和任务代码。宿主MCP配置只在宿主读取选定服务，不复制完整配置或凭据给模型。使用实际目录/调用验证能力，按失败码诊断，不自动安装缺依赖或补回已经停用的全局Hook。

宿主检查与MCP使用异步子进程，取消或超时只终止本调用独立进程组；旧已开始而结果未知的动作保留原run目录和started记录，不重新执行。原生QA绑定真实Git候选与检查记录，发布继续使用目标项目已登记受管入口和允许动作。

任务CLI保持`approval_policy=never`。`role-host-mcp-config.mjs`将本run宿主executor实际暴露的工具逐项设为`mcp_servers.role_host.tools.<原工具名>.approval_mode="approve"`，服务器默认仍为`prompt`；带点工具名通过TOML quoted key保留原名。该设置只消除已授权专用通道的重复交互，Native许可、broker及宿主执行器仍校验每次调用，不批准未知工具或其他服务器。CLI 0.159的`mcp get --json`不输出审批字段，验证须读取实际`config/read`结果，不能只凭配置解析成功。字段定义见[固定版本官方schema](https://github.com/openai/codex/blob/rust-v0.159.0/codex-rs/core/config.schema.json)。

没有项目自有交付入口时，Native metadata可显式登记`delivery: {adapter: "managed-project", maximumAction: "pull_request"}`，使用本仓库固定manager/Harness。任务代码工作树在已登记的Projects根创建，prepare生成integration候选；QA须在该精确SHA运行登记checks并通过Native结果收存，再允许同一任务发布PR。此适配器不自动合并。`maximumAction: "artifact"`仅建立任务工作树和报告，不开始完整发布流程。CLI通过stdin接收私有许可：`node scripts/role-project-delivery.mjs --request-stdin`；检查及候选错误沿原host调用返回。

## 角色指令迁移与保存

本人已授权的角色指令修复使用`migrate-role-instructions.mjs`，先排空当前Native执行，再把每角色登记的精确材料复制为该Agent原生Managed bundle内的`<role>/AGENTS.md`。不得对共享旧materials目录直接一键迁移，也不得重跑一次性team-configure。迁移仅合并指令路径相关配置，保留角色身份、模型、汇报关系、工具和全部原历史。

若同Agent原生目标已有历史目录，先核对归属及原生revision heads，保全其字节和恢复路径，再迁移到空的现役目录；不把旧文件当垃圾删除。原intent写入中断且Native配置尚未切换时，可重验源摘要并原子恢复本intent的部分文件；已经生效的未知新内容继续保护。

网页保存沿原生文件服务执行，并通过`role-instruction-store.mjs`同步manifest及内容历史。错误返回时保留具体修改记录，按原修改对账恢复，不能删除记录或改写旧permit/claim。预检对尚未同步的角色明确拒绝。候选通过回归、评审后复用既有镜像，应用和宿主传输都切到同一候选；旧Compose和旧材料继续可恢复。现场验收见[验收手册](acceptance-runbook.md)。

## 独立 Chief 真实 RWB 试点

单镜像复验使用 `docs/super-agent/chief-single-image-verification.md`。应用、独立模型容器和宿主发布器绑定同一个构建候选，复验中重启应用前后核对镜像 ID。

同一 Chief 对话的双任务验收使用 `compose.chief-web-real.yaml` 叠加 `compose.chief-web-daily.yaml`，监听 `localhost:8113`。第三版私有清单的两个槽绑定同一用户、公司、项目、Chief、对话和代际，各自使用独立的交接目录。先处理 `docs/super-agent/chief-daily-task-intake.md`，再处理 `docs/super-agent/chief-daily-result-recovery.md`。第一项限一轮，第二项允许一次补充。每条消息带当时开放的文件路径，发布绑定本任务的候选、评审和远端 head。排空后切换，页面继续显示前一项成功回执。两项完成后保留末项面板供查询，关闭执行消费者。

小范围常驻使用 `compose.chief-web-real.yaml` 叠加 `compose.chief-web-resident.yaml`，监听 `localhost:8112`。宿主监督器按私有清单顺序开放 `chief-resident-intake.md`、`chief-resident-recovery.md` 和 `chief-resident-status.md`。Paperclip 为同一用户与 Agent 保留一条原生对话，因此每个文件使用独立 Chief，共用专用实例的数据库和登录。第二版私有清单逐项固定 `scopeRoot`、`conversationId` 和 `chiefAgentId`。每个绑定限一轮输入。只在前一条确认完成、原消费者已退出、共享租约为空后切换当前绑定。每次发布仍需网页确认。

完整镜像复验可在部署时选择 `docs/super-agent/chief-browser-acceptance.md`。同一专用实例、宿主和模型容器使用相同的 `SUPER_AGENT_CHIEF_WEB_REAL_DOCUMENT`，私有会话绑定记录中的 `targetDoc` 必须匹配。缺省沿用首轮限定文档，输入版本和发布护栏仍绑定当次唯一目标。

使用 `compose.chief-web-real.yaml`，网页绑定 `127.0.0.1:8108`，入口默认关闭。先配置专用原生对话、项目及账户，关闭该 Chief 的计划、按需唤醒和快速响应。设置受控实例绑定与私有交接目录。Mac 宿主只在核对旧实例排空、共享准入、固定工具链及资源来源后启动本次运行。实际写入前，Git 钩子核对远端通告的原 head、当前候选和唯一目标分支，并执行项目原有钩子。

宿主资源包包含已固定 RWB 提交中的 `research_workbench_entrypoint` 和 `.agents/resource-closeout.json`。如果开发停在初始资源登记，操作员可以在停掉原宿主消费者后，对同一操作核对原 Native 认领、共享租约、已创建的受管工作树，以及物理请求、调用和运行容器均不存在。通过后登记一次私有恢复证明，保留原失败回执，继续同一操作。无法证明调用从未启动时保持阻塞。

常驻监督器记录任务阻塞后停止该槽执行。操作员完成原任务的受控恢复并排空消费者后，重新启动监督器。它只接受原绑定对话里与最新 head 匹配的成功终态，复核共享租约后再开放下一槽。仍在执行、等待 CI 或继续阻塞时保留原槽状态。

GitHub 读取传输暂时失去结果时，CI 继续等待同一操作。早期版本若已将该传输错误记为阻塞，保留原回执并在专项许可内重新读取 GitHub。只有原任务、输入版本、操作 ID、PR 和 head 都匹配的检查结论可以补录。CI 核对无需执行租约或模型调用。

首次发布若在推送前因共享仓库锁等原因中断，先停原宿主消费者。只有原确认仍有效、原认领及受管候选一致、原推送证明缺失且 GitHub 上的目标分支和 PR 都不存在，才登记一次私有恢复证明。恢复沿用原操作 ID，单独写入恢复认领和推送证明，保留原记录。已有恢复认领时只能对账。

准备工作区或候选时，只有固定 Git Safety 在进入受管回调前返回明确的仓库锁拒绝，宿主才在原租约内有界等待。每次继续前重新核对暂停、租约、基线和已有提交。已进入回调或结果未知时保留原记录。

## 独立 Chief 网页演练

使用 `compose.chief-web-evaluation.yaml`，项目名为 `super-agent-chief-web-rehearsal`，网页绑定 `127.0.0.1:8107`。设置 `SUPER_AGENT_RUNTIME_IMAGE` 为按构建输入复用的确切镜像，设置 `SUPER_AGENT_VERIFIED_DEPENDENCIES` 为与候选锁文件一致的只读安装目录。应用与数据库位于内部网络，网关仅将网页转发到本机端口。

首次启动保持 `SUPER_AGENT_CHIEF_WEB_EVALUATION_ENABLED=false`。在该实例通过 Native 登录和首次管理员认领建立测试账户，启用 Agent Chat，建立公司、项目、测试 Chief 和该账户的原生对话。从实例安装镜像中的 `/opt/super-agent/plugins/chief-web-pilot`。将 `userId`、`companyId`、`chiefAgentId`、`conversationId`、`projectId` 和独立随机 `ciToken` 放入演练 state 卷的 `/paperclip/control/chief-web-evaluation.json`，使用 root 所有且权限 0600 的常规文件。随后以启用开关重新创建该项目的应用容器。配置和测试密码只保存在私有演练记录中。

模拟 CI 由同源已认证演练账户向 `/api/issues/<对话ID>/chief-web-evaluation/ci` 提交 `operationId`、`candidateSha` 和 `conclusion`，请求头 `X-Super-Agent-Eval-Token` 使用演练 token。重启仅针对 `paperclip` 服务，关闭入口后保留独立数据卷和回执。

## #261 受控恢复

Docker 内的操作员入口为 `node /opt/super-agent/bridge/chief-web-recovery-cli.mjs <inspect|claim|publish|record-ci|release> <确认操作ID> [CI事件ID]`。仅 root 且显式启用 `SUPER_AGENT_CHIEF_WEB_RECOVERY_ENABLED=1` 时可用。恢复读取原 Native 任务、对话和受控记录。`inspect` 可只读核对保留的原认领。应用仍需提供现有私有 Pilot 绑定、受控运行状态和原租约账本。

发布使用私有宿主交接。Mac 侧适配器校验首轮固定的 RWB Git Safety 工具包，只允许更新 #261 现有分支，并要求部署侧提供独占分支发布护栏和可信回执存储。认领后的结果未知只核对该操作的宿主回执。基线、当前 head、候选或批准变化时返回阻塞。网页演练使用独立的测试账本、模拟 CI 和测试租约。

## 资产与身份

Paperclip 评估项目名为 `super-agent-paperclip-eval`。专用数据根 `/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0`，底层为外置 SSD 的 APFS sparsebundle。Docker.raw 仍保持原位。数据库、订阅认证、workspace、日志及尚未确认退役的镜像继续保留。

运行身份以实时容器 inspect 的镜像 ID、Compose 来源、挂载及启动命令为准，不能以本目录的 compose 文件代替。2026-11-04 已观察到运行服务从另一个统一集成目录启动，详见 [当日状态](governance-status-20261104.md)。

## 只读核查

- 用 `docker ps` 和选择字段的 `docker inspect` 核对服务、镜像、挂载与配置来源，避免输出整个环境变量和认证内容。
- 用宿主 `df` 和 APFS 挂载检查确认系统盘与专用卷；业务准入必须来自新鲜宿主证据，容器 statfs 不足以证明达标。
- 同时核查 Paperclip 原生 run、任务、进程、执行 journal 和外部结果。暂停或没有日志不能证明排空；字段缺失、读取失败和状态冲突一律未知。
- 日志必须脱敏，`scripts/sa logs` 仅收集其已知服务，不能代表后续集成服务的全部日志。

## 更新窗口

### 镜像构建、复用与退役

使用 `./scripts/sa image-build` 显式准备镜像，`./scripts/sa image-audit` 只读清点本入口登记的镜像。已登记且输入、平台、镜像 ID 与指纹标签吻合时直接复用；未登记的同名镜像、失效引用、Docker 观察失败均停止，不把未知视为缓存未命中。构建失联时保留自有锁及暂存上下文待核对，不重跑。

本机长期保留的运行镜像按用途使用 `production`、`development`、`rollback` 标签。构建使用临时 `input-<指纹>` 并登记精确 ID。迁移时先核对构建登记、部署和回退回执，再把适用用途标签指向完整 ID。启动配置继续固定验收过的 ID。旧标签不存在时，只有同仓库的用途标签、登记 ID、平台和输入指纹全部吻合才能复用。若旧标签已漂移则停止核对，不以用途标签绕过冲突。

在切换窗口先查运行及停止容器、所有实际启动与回滚配置，以及使用旧版解析器的入口。验证已消除旧标签依赖后移除该别名。未完成使用范围切换的旧标签保留至对应验收完成。用途标签迁移与构建、收尾共用维护窗口和锁。只有确认角色已下线后才进入退役。`image-closeout` 每次检查及移除前均核对用途标签指向的 ID，即使没有容器引用也予以保护。用途轮换后没有标签的已登记旧镜像依然按原 ID、平台和输入指纹验证。原临时标签漂移或出现其他名称时保留待核对。

构建上下文仅包含 Dockerfile、运行脚本、包装命令与安装锁文件；不包含任务数据或凭据。Dockerfile 中固定的基础镜像必须已在本地。构建成功回执仅证明精确构建身份；离线回归、评审、部署和业务验收仍走各自门。实际安全更新需要显式更新构建输入，不能以每任务一个新标签刷新依赖。

`./scripts/sa up` 按当前输入解析精确镜像 ID，固定 Compose 文件和项目名，禁用隐式配置覆盖、构建及拉取。登记将本次构建元数据的镜像 manifest/index digest 解析为本地 ID，再与标签实际指向比对，不把配置 digest 当镜像 ID；无法核实即保留锁和现场。镜像构建登记和日志保存在专用外置根。首次采用新入口须在获授权的运行升级窗口准备同候选镜像并验证；本次源码改动不改正在运行的独立集成目录。

`status`、`stop`、`test`、`preflight`、`logs` 使用固定的公共 Node 摘要完成 Compose 变量解析，无需保留旧运行基线标签。工具命令只创建独立 tools 容器，应用启动仍由 `up` 核对运行镜像。

真实验收通过并排空后，从拥有该运行配置的受控检出执行 `./scripts/sa image-closeout <plan-name>`。资源所有者在同一专用数据根的 `image-closeout-plans/<plan-name>.json` 准备本人所有、权限为 `0600` 的普通文件，提供以下字段。

| 字段 | 内容 |
|---|---|
| `schemaVersion` | `1` |
| `verification` | 验收和排空回执相对 `logs/` 的路径，例如 `daily/daily-summary.json`。回执是本人所有、权限为 `0600` 的普通 JSON 文件，包含 `status: "PASS"`、本次已验的 `imageId`、`executionClosed: true`、`activeSharedLeases: 0` 和 `liveModelWorkers: 0`。 |
| `current` | 本次已验镜像的 `{key, imageId}`，与验收回执及构建登记一致。 |
| `previousImageId` | 上一个已验回滚镜像的完整 ID。确实没有上一版本时才填 `null`。 |
| `configs` | 逐项列出实际启动和回滚配置。每项含 `kind`（`startup` 或 `rollback`）、绝对 `path` 和 `images`。列出配置使用的完整镜像 ID 或 Super Agent 镜像引用，包括通过环境变量解析的实际值。收尾也读取 Docker 记录的 Compose 文件。无法核对的 `include` 或 `extends` 配置会阻止退役。 |
| `retire` | 本任务明确归属且已确认被替代的登记镜像，每项为 `{key, imageId}`。 `key` 是完整构建输入指纹，`imageId` 是完整 `sha256:` ID。 |

按镜像 ID、标签和用途核实退役。保留本次及上一已验镜像、运行或已停止容器引用的镜像、启动和回滚配置引用的镜像，以及依赖或身份不明的镜像。镜像年龄和容器引用数只用于清点。维护窗口内暂停同一环境的外部启动和配置改动。

收尾与构建共用锁。删除前逐项复查 Docker 引用、配置和构建登记，先在专用外置数据根的 `archives/image-closeout-v1/` 保存并校验确切镜像、原构建登记和退役意图，再按完整 ID 单次删除。确认镜像消失后才转移活跃登记，并保存结果回执。重复执行原计划时，已退役的镜像按回执和实际 Docker 状态核对。删除结果未知时保留锁、归档及回执，先对账再决定后续操作。离线回归和宿主退役分别留证。见[外置存储规划](external-storage-plan.md)。

仅在明确候选和授权后关闭新派发，确认无活动及未知任务，保全数据库可读备份、原镜像与依赖、会话和回执。升级仅触及 Super Agent 专用容器。镜像、依赖和源码不一致、其他任务持有工作区或未知结果时停止；不强杀、不删锁、不重置任务。

恢复数据库连接、应用和单一飞书连接后先保持派发关闭。核对同一任务、原 attempt、幂等键、旧许可消费和外部 PR/通知状态；只有确定尚未发生的动作才继续，未知动作先查回执。旧模型许可不恢复，不为了恢复重跑模型。

本轮可在排空后升级专用评估实例；Docker Desktop 全局重启、数据库迁移、新依赖、RWB 常驻服务及系统配置不在授权内。当前有并发脏集成候选时不执行更新。两条验收结束后恢复暂停调度。

固定版本的 Chief 网页路由由显式启动配置提供装配器。运行镜像包含源码模块和对话插件包，镜像复用键覆盖全部打包输入。启用前核对发布包 app.js、agent-conversations.js 摘要和认证模式。路由插入发生在进程加载时，已安装依赖文件保持原样。回合回调未知结果时使用持久消息唤醒核对，不重发模型。插件启用、实际业务授权和专用应用重启各自留证。

## 故障与回退

### 已知本人消息补收

无回执时先保全原消息与现役状态，检查官方平台消息、SDK 入站、Native intent/registered/ACK/wake。ACK 失败不能推定未登记或零模型；不得要求重复发送、换 message ID 或另建根。并发部署须先按现有运行归属安全交接；保留新 Native Skills、执行策略与专业配置，不能回退旧候选来恢复监听。配置完成后恢复唯一监听、team 状态及对应启动/恢复入口。

对确实未受理的已知 `new` 原目标，管理工具默认只读 preview；只使用服务已有 SDK 1.76.0 和私有绑定，不接受操作者提供原文、sender 或伪造事件：

```sh
node /opt/super-agent/role/scripts/chief-feishu-recover.mjs \
  --message-id '<原om消息ID>' --expected-body-sha '<已保存正文UTF-8的SHA256>'
```

核对原 Owner、既有本人单聊及消息 ID/类型/正文版本后，同命令加 `--apply` 登记。apply 前须当前运行已完成安全交接，M2/team/角色 runtime 与唯一监听开启；不绕部署暂停。命令不启动新 SDK 长连接或调用 drain/wake，真实后续仍受原 Native 全局准入和根预算限制。GET 不提供 SDK eventId 或 chat_type；单聊信任来自既有已认证 Native SDK 登记，禁止借旧 eventId 补造本次事件。

结果及脱敏错误写 `SUPER_AGENT_LOG_ROOT` 或 `/paperclip/logs/chief-feishu-recover.jsonl`。只打印验证摘要、原消息标识及 Native IDs，不打印私聊原文或凭据。未知受理/ACK 沿原操作核对，不能改 claim 或自动补发；摘要变化、删除、错误身份/单聊与非 new 命令零效果拒绝。当前平台正文有编辑标记时只固定已核摘要，不自行改用另一版。该工具不是全历史消息补执行服务。

缺盘、低于 5 GiB、宿主证据失效、租约未知、模型调用额度耗尽、评审缺失、CI 未知及外部结果未知都拒绝继续写入，保存稳定错误码及脱敏日志。不建立替代数据库、不切备用 API。

启动失败先检查精确候选及日志。回退必须重新满足排空和兼容检查；保留上一个已验证镜像及依赖。备份可列目录不等于真实恢复成功；没有演练证据就标明未演练。禁止直接 `down -v`、Docker prune、删数据库或删除不明锁。

## 飞书多项目交付

本人私聊使用 `/任务 <项目名> <需求>`，并在 `文件：` 下逐行声明范围。启动方从可信配置登记项目名、Paperclip 任务适配、必跑检查和准入账本命名空间。飞书输入只选择已经登记的项目。通用入口统一核对登记回执、输入版本和补充关联。项目适配器负责自己的仓库、分支、文件与写入授权。

RWB 是当前运行覆盖层的内置项目，保留现有 `/rwb` 兼容入口。其他项目通过启动方的 `projectAdapters` 注册，并使用同一套接单逻辑。每个适配器须在隔离环境验证实际执行、发布、CI 及恢复证据，随后才能接入真实任务。飞书仍使用一个监听。

### RWB 运行覆盖层

自动接单以实际运行的 Native、飞书和宿主组件为基线。操作前确认飞书唯一监听、Paperclip 任务排空、共享写租约和旧 Host 窗口为空。保留现有容器配置、镜像及数据，保持历史发件请求隔离。用 `node scripts/prepare-feishu-project-overlay.mjs <Paperclip运行包> <飞书运行包> <新目录>` 从固定基线生成候选。准备器核对每个替换文件的字节摘要，输出候选摘要清单。用 `scripts/check-feishu-project-compose.mjs` 对照正在运行的容器核对原文件字节、镜像、挂载、环境和隔离选项。候选复用原镜像、网络和数据卷。

在统一集成状态根的私有 `feishu-project-rwb/policy.json` 设置有效窗口和至多两组精确路径。每组写入预先用目标仓库验证规划器核实的检查 ID。原运行配置保持 `dispatchMode=off` 和 `githubMode=off`，仅专项已绑定任务进入受控派发。结束时排空原操作、关闭专项策略并保留记录。回退恢复原容器定义和镜像，先核对在途操作与远端 PR。

已完成的旧调用若因运行包的历史索引过期而挡住新任务，先核对对应私有 claim、scope、原授权、启动记录、产物回执和 Native 终态。用 `scripts/prepare-closed-claim-history.mjs` 从固定审计源码和本机选定的历史 claim 生成只读覆盖文件。索引只用于定位旧调用，运行时仍完整验证原有证据。保留原调用及账本。待续接任务使用原操作的未派发恢复入口，先核对窗口已关闭及模型调用为零。

## Paperclip Tailscale 独立入口

本轮获准的最小入口为 `https://mac-mini-1.tail947973.ts.net:8443/LEO/dashboard`，通过已有 Tailscale Serve 转发到 `http://127.0.0.1:8097`。登录入口为同源 `/auth`。仅新增 8443，不覆盖现有 443 的根路径和 `/collections`，不启用 Funnel；运行前仍须回读实际 Serve、tailnet 有效访问策略及网关容器来源。

网关候选的 Host/转发头和一次性诊断探针合同见[开发地图](development-map.md#paperclip-私有-https-网关候选)。探针由运行配置负责人在无活动任务的窗口内临时启用，从实际 HTTPS8443 发起精确 nonce 请求，保存三项入站头证据后关闭。不能以 curl 发出的 Host 代替网关实际收到的 Host。若入站与白名单不符，先停止该候选上线，禁止通过信任任意客户端 forwarded 头解决。

Public URL、认证显式 base URL、managed runtime URL 与精确 trusted origins 必须由同一配置负责人根据固定 Paperclip 版本的认证契约统一调整。保留原配置与镜像身份，先排空并核实无未知 Native run，再操作必要的专用容器。检查旧本机 HTTP 会话、HTTPS 登录及 Secure Cookie、错误 Origin 拒绝、实时连接、443 与 collections 回归，最后从另一授权 tailnet 设备验证。页面200仅表示静态入口，不能记为登录或全链验收通过。

网络侧回退仅运行 `tailscale serve --https=8443 off`，回读确认 443 两条转发不变；重新启用使用 `tailscale serve --bg --https=8443 http://127.0.0.1:8097`。不要使用 `serve reset` 或把过期完整快照覆盖共享配置。应用/网关回退仍由原配置负责人按记录恢复；Serve 配置、应用上线、本机验收和跨设备验收分别记录。
