# 受控真实验收手册

## 验证服务于本次交付

不采用防御式推进，不把本手册当每个小改的完整待办。按当前改动直接检查效果，复用有效证据；发现实际回归再扩对应检查，必要CI与分支保护照常。错误直接更正，失败短记录即可，本任务无用途的可重建临时／失败产物正常清理，不为留错追加全树hash、恢复重演、审批或新模型调用。

岗位材料小改检查相关生成一致性和实际保存结果即可；Architect的选型与规格在真实工作中使用，判断官方适用版本、实际代码约束和可执行交接，不为证明材料生效另造探针。Doc／QA人工内容及已在途快照不覆盖，新版本用于后续run。

共同工程规则支持文件变更只检查包校验与相关岗位生成一致性；发布新运行源后，后续run读取新文件。在途run保留原快照，源码提交不等同于运行源已切换；无须因此重跑第三方Skill或制造模型探针。

## 成果回执可读性

用真实任务标题、辅助短编号和四种质量阻断决策验证中文状态、当前阶段、原因及下一步；未知原因不回显技术码。核对标题缺失、长标题、换行与空白处理，不以UUID伪造任务主题。阶段进度不得把调用或文件数量写成完成百分比，也不得把本轮汇总冒称业务整体完成。确认通知不把SHA前缀或集成包`0.1.0`冒称成果版本，而显示原创建时点的上海日期；用户摘要中的合法业务数字与链接保留，技术commit等完整标识留在原报告。可信预算可显示实际已用／上限，缺失不推零或默认20。

以真实LEO-65形态回归：完整报告含重复标题、UUID、SHA表、命令和NOT_RUN流水，但通知只取同次总结生成的独立三字段摘要并排成短纯文本。缺失、错误或重复摘要块不得透传原报告；空QA集合不得显示通过，文档QA通过不得写成源码／部署完成，模型提供的stage不能决定展示阶段。核对提示追加不增加Native run或模型调用，原归档及原评论仍保存完整报告字节。旧LEO-65仅做纯渲染、不发送；加载新源后，用下一条自然新通知的官方SDK GET核验实际正文，不以fixture或sent行代替真实显示。

验证原summary字节、摘要、归档和outbox键／UUID保持；已sent重复调用零发送，unknown继续拒绝自动重放。调用仍走原company／owner及私有文件守卫，测试替身不能认证真实飞书交付。Source和CI通过后，在无在途模型的已交接窗口应用；实际下一条通知的任务、状态与文本另取证，不重发旧sent来伪造验收。

## 任务级多 Runtime：仅隔离candidate

本轮验收按[候选合同](plans/task-runtime-routing.md)及[13岗全栈合同](plans/full-stack-engineer.md)，保持生产旧12岗固定源码、身份、权限、资料和调度不动。先验证可信任务策略：Chief先选全栈或专业岗位的唯一执行范围，再选模型/Runtime；核心Chief/PM/Architect/独立QA固定Codex，复杂/高风险/unknown保守Codex，低风险routine执行可选MiniMax，合适research/cross-check可选DeepSeek。显式profile冲突拒绝，current-binding snapshot不构成新任务选型授权。

真实验收必须进入实际安装的Native任务/run与adapter，再由Mac原生CLI执行；独立CLI小样、固定文档模拟、环境检测或退出0不能替代该证据。计划限定routine Backend/MiniMax、同一个Backend task中显式handoff到Codex、Research/DeepSeek、PM/Codex及独立QA/Codex。保全Native/task/root/operation/run、provider/model、真实工具/产物/测试与usage；未报告费用或子工具退出码保持未知，不伪造数值。

handoff前须已知成功并确认模型与broker执行闭合，版本化旧产物和累计预算，后run使用fresh session，保持同task/root且不重置计数。负例覆盖core/risk冲突、unknown、跨task/root/Agent、活动或超时/未知执行、产物/计数漂移、错误token/模型/path/CA、取消和响应上限；不为验收故意破坏生产产品。

原12岗五次成功Native模型及CSV结果保留原源码证据，最终读回/收尾仅由根任务按原精确回执填写，不重跑成功模型。新增Full Stack Engineer后，新13源码与Native名册/公司Skills/材料/registry/catalog必须同批迁移；原12 Agent身份及历史摘要保持，旧PASS不自动授权新源码组合池。新全栈真实小功能/前后端流或Bug+tests、独立QA及复杂升档/专业岗责任交接须另验，保持同task/root、原产物和累计预算。生产配置、自动调度M2/UI/Cloud Apps、13岗完整业务、重启恢复和生产切换仍未验证。

queued retry续接须另验协调器整tick：原operation的初始wake指向attempt0，而唯一queued attempt2的`retryOfRunId`指向attempt1时，只能按Native记录的直接父行选择并消费原attempt2一次。父行缺失/错scope、非唯一或scheduled队列、DB失败均不启动；不能用纯binder测试代替队列到binder的衔接验证。

## 20次与同根开发续接验收

先核普通根20、物理第20次允许和第21次拒绝、历史12次/QA专项与最多两轮返修。原根授20前后逐文件比较已用budget及操作，不能退款或换根。维护CLI需验证错误Owner/摘要、活动run、call锁及未释放租约拒绝，同操作发布后丢回执只核对不重放。

对已完成但总体未完成的原根，保存原summary/QA/通知和flow摘要；授权接入源码后通过显式Owner续接形成新代，原4次等累计不变，旧sent不阻挡新代，也不重复发送旧通知。wrong workspace/input/flow、cancelled、unknown及Native事务失败均拒绝；事务失败不得发布活动或唤醒。真实新run必须绑定原root及新workspace，静态QA通过不能冒充PoC或整体目标通过。

RWB开发接线另验App内Git可读、宿主worktree隔离、真实规则/checks、Native QA精确候选、PR及项目规则允许的合并。缺注册入口或检查/评审时仍拒绝发布，不因移除PR-only身份限制放宽项目门。

代际计划收存须用真实79字符outputPrefix及最长32字符key，111 stem通过、112 stem和路径拒绝；foreign prefix仍由Native收存guard拒绝。以已成功source run、原计划hash和Root in_review/旧phase已释放为起点，核原coordinator收存/创建children、重复tick不重复对象或Chief调用，首child由正式Meter获取新nonce。旧registry lease映射不代表仍held；不能据日志去重后的ADMISSION拒绝推断tick停住，也不能为修文件名重写SQL/旧nonce或重跑成功模型。

## 真实交付中的持续迭代

非Git任务另验Native真实校验目录与模型最终cwd，不能用旧Git pilot通过校验后改写cwd来证明产物目录本身正确。正式non_git_path例外只消除对应缺Git分支；已装Native函数的其他错误与代码仓库Git检查必须继续拒绝。运行时新任务应固定实际projectWorkspace/executionWorkspace/Native run和角色许可，源码hook通过不等于已执行任务。

npm缓存复用验证多个run仍有不同私有HOME、auth/session和输出，同一已验卷缓存配置无凭据。临时cache fixture与真实共享cache分开，测试不写真实WorkDisk缓存；首次真实run只证明其实际执行范围。已结束run的再生副本按资源生命周期退休，原会话、预算和失败不能为腾空间删除。

GitHub连接须区分宿主认证可用与Native任务内可用。匿名403/额度耗尽时保留实际响应，不认定仓库缺失；接通登记仓库GET工具后，由真实Research/QA任务读取当前PR、Issue和head，记录工具来源与观察时间。单独CLI测试不能冒充Native已调用。

同Root质量续接另验：旧5次等实际调用文件字节不变，complex12记录不退款；同一resume ID只记录一次Native恢复事件，提交失败无提前发布，文件投影丢失只对账。下一轮仍使用原Research/开发及QA子任务、新operation/run/session和独有输出，旧NEEDS_WORK及通知保持；第三轮、未知传输、输入变化、未释放租约均拒绝。源码夹具不替代真实原任务续接结果。

上下文恢复须覆盖真实Native repository与事务整链：受控Chief A→P→S直接重试且S有唯一绑定成功调用时，P可进入既有settled历史集合，原null/预算字节不改；断链、错身份/操作/输入、无成功绑定或失败方存在执行残留仍拒绝。本人原continue因unknown被拒后，按Native持久intent及JSONB还原来源校验，teamfalse下复用原kernel写result/control，再由原coordinator应用pending输入并认领原resume；在fake adapter边界停下，不调用模型。另验先应用pending再对账旧请求会拒绝、重复管理/历史SDK消息不多写effect或ACK、后来的项目/任务选择不被回退、错误Owner与任何live/未知执行不被放行。夹具通过与线上同根真实进展分别取证。

RWB每个有效工作项沿原Issue/NativeTask/分支/PR推进，重复或已覆盖项以实际包含/替代证据对账，不盲目全部合并。以当前候选的适用检查、独立QA、PR/CI、按依赖批次部署及业务结果分别验收；其他聊天持有的部署窗口先交接。FinGPT保持已定顺序及其独立provider费用预算，Codex根调用分档不替代该预算。

至少一个实际可修复的QA问题需证明：同Root和原开发/QA子Task、原输入hash不变，原NEEDS_WORK/产物仍在，新增fix与独立reQA操作/run/session，当前reviewedArtifacts排除旧QA，PASS绑定新候选。不得为验收故意破坏现有产品；使用真实发现或离线故障夹具验证故障分支。离线驱动通过不等于真实任务已跑。

普通原根默认20次，历史可信12次和QA专项继续按原证据核验，最多两轮质量返修。额度不足留可恢复阻断，不新建Root绕过；unknown保持原call/host操作证据。角色AGENTS/CAPABILITIES发布、新run实际加载、具体工具动作、业务结果逐项取证。未参与岗位、未测格式和未连工具保持NOT_RUN；ready/idle不当作12岗业务通过。

Native HTTPS 恢复按[专题合同](plans/native-https-recovery.md)先做无模型验证：正确 CA/loopback SAN 成功，错误 CA/主机名失败，Node stdio MCP 继承本 run CA，TLS 监听后才 ready。恢复既有 Chief attempt2 时保全原两槽与旧失败，核明确切 HTTPS-origin 错误、零模型 response、完整进程/环境租约收尾及匹配锁；实际调用后以原剩余额度验证计划，并核计划后暂停和真实通知。不将 mock TLS、CLI session、预算槽或队列状态当作模型成功。

## 文档岗

先验证原11身份/配置/技能/知识不变，以及新岗9项完整版本与Managed文件。合成输入的xlsx/docx/pptx/md/pdf文件结构、真实公式重算、中文PDF和栅格化、原件哈希分别核验，使用task专属输出与Office profile。该工具链证据不计为Agent模型实跑。新岗ready只能来自正式单岗生命周期验证；不得伪造或跳过真实环境测试。控制计划仍最多四子任务，普通原根20次；Doc正式交付须有独立QA，二进制文件通过md/json清单及摘要交接。

## Mac原生和公司Skill验收

未变个人订阅在JSONB键顺序重排后仍须被判定为未变；provider、method、connectionId或mode真实变化仍走原Native验证。进程内hook需精确源字节及启动装配合同，不能通过绕过权限或替换认证来完成配置验收。官方paperclip包的12个文件亦核对实际快照与读取。

公司Skill list/detail的字段投影单独验证；审查metadata需以选定来源的详情为准，不能用手造完整列表夹具代替安装版响应。

本地导入真实集成需证明currentVersion已创建、逐文件摘要一致、重复同步不增版本或Agent配置修订。GitHub源与已审查本地快照并存以及上游frontmatter名称不同的场景，都须验证实际被选版本与条件加载。

按[本轮合同](plans/native-skills-20261120.md)分别验证全部11角色的分配/Managed说明/完整包/依赖/最终CLI配置，以及预算内代表角色的真实订阅执行。核对`process.platform=darwin`、实际宿主cwd、CODEX_HOME、无冲突沙盒参数及原订阅，不能用CLI版本或文件存在替代真实模型结果。

取消、超时、进程恢复使用可控夹具覆盖；真实模型动作结果未知时核对原run。Skill与脚本依赖缺失标为NOT_RUN；其他岗位配置通过不等于其业务闭环通过。切换后的候选、实际调用数、失败和恢复分别写入本轮运行证据。

实际macOS进程身份、进程组和完整host transport夹具仅在Mac执行。固定Node Linux镜像没有macOS的ps接口，且测试临时挂载不允许直接执行文件，因此Linux明确跳过这4项；参数/策略与loopback broker检查仍在Linux执行。必须另有Mac目标平台结果，不能用Linux的skip声称通过。

## 通用角色与跨项目能力

逐角色核对职业说明、默认能力和实际工具目录；补充能力由Chief结构化计划进入原operation/permit，不接受工具参数自签。Skills完整包须可读取并验证依赖引用，MCP目录须与真正允许调用一致。现有版本源码合同测试必须使用固定Native schema/service的合法`metadata.superAgentProject`，不能用不存在的runtimeConfig字段假造通过。

跨两个不同仓库验证Native项目选择、公司/owner关联、隔离工作树、项目规则、知识作用域、已登记checks及交付动作。实际编码、只读验证和远端发布分别留证；只读能力验收使用artifact动作上限，避免发布业务改动。RWB项目规则只影响RWB。

宿主Git/check与选定MCP要有真实入口结果；网络/资源事实来自宿主。QA在干净的精确候选上独立执行，发布消费Native QA与实际检查记录；旧SHA或自签结果必须拒绝。取消包装进程时核对其后代退出；命令失败应把脱敏的退出码和定位信息返回模型。网页保存及历史保留沿前节回归。

登记检查另验真实子进程Git语义：`ls-files '*.md'`能枚举、`check-ignore`接受正常路径，登记命令为Git本身时也不得被Host强加literal；同时以含方括号的文件名验证Host的模型文件操作不扩大选集。父进程四种pathspec变量须隔离且父环境保持。inspect分别呈现当前bootstrap、已绑定回执原始摘要、登记配置与未保存的历史raw exit；不得把`started`当作实施后prepared候选缺失故障、为补证重放start、输出秘密参数或认证尚未运行的业务。

已登记命令的代理接线分别核对工作区准备、候选准备、PR发布/状态消费的子进程环境，确认复用现有宿主代理及本地`NO_PROXY`，不由模型参数选择任意代理。离线回归只证明环境传递，不能用GitHub只读或模型连通性替代真实GitSafety fetch。实际网络验收记录同一Root、候选、入口、退出码及回执；网络故障按既有分工交Network Engineer，未知结果沿原操作核对，未运行保持NOT_RUN。

代码源输入绑定须使用真实Native形状：`paperclipWorkspace.workspaceId`而非假造顶层字段。分别验证fresh DB源目录、固定artifact投影及独立Host代码工作树；Native只读源码挂载不写入报告。错ID/project/cwd、缺Owner登记、只读catalog撤权与中途登记变化均拒绝。源码/夹具通过不等于真实Native调用、GitSafety receipt或PoC通过，现场以原Root/run/permit及实际路径另行取证。

补验Native local realization的最高cwd优先级：copy/in_place使用原installed execute和假CLI，核真实进程cwd及`PAPERCLIP_WORKSPACE_CWD`均为固定artifact；保留源绑定、环境/lease身份，foreign root、非空alias/restore、remote/isolated不得被投影放行。不运行模型或连接生产数据的合同仍不是业务验收。

Native全局scheduler保持原受控关闭状态。恢复既有scheduled retry时用官方retry-now，记录同一run变为queued；现有team tick仅在当前登记work-step和全局唯一queued匹配时调用Native消费者。scheduled、其他任务、其他active行与陈旧输入不得触发消费；claim返回仅证明Native已认领并安排执行，不能当provider/业务成功。执行前仍须通过retry binder，不重置锁、预算或会话，不另起wake/run。

## 角色指令网页保存

迁移11角色前记录每个角色的Agent ID、原adapterConfig/runtimeConfig、manifest、旧材料摘要及既有运行数量。排空后用精确文件集合建立独立Managed bundle，每个列表只含自身角色的可读路径，旧UUID文件及历史不删除。迁移后逐角色核对入口、内容摘要和非指令配置保持一致。

在已认证Chrome打开角色Instructions，确认Managed、`<role>/AGENTS.md`和无修订模式错误。通过Edit保存一个无行为影响的标记，刷新后读回，核对registry摘要与历史快照；再从相同网页恢复原内容，验证两次变更都可追溯。受控执行预检必须读取最新摘要，run副本应固定本次字节。普通网页保存、非模型预检和真实模型运行分别报告，不能将预检当成模型已经执行。失败恢复与角色间材料隔离由相关回归覆盖。

2026-11-22的预算/交付文案修正只更新Chief AGENTS与DevOps CAPABILITIES的生成源。真实发布前保存实际24份材料及版本摘要，仅对相关两岗执行Owner/CAS，保全Doc/QA四份Owner自定义内容和全部旧历史；不把源码模板重新标记为全部现役材料。发布后核对两份目标字节、新run加载与旧root调用文件分别保持预期，历史显式12次及QA专项不因普通默认20而改写。离线模板/出版器回归不代替实际CAS或业务运行，未运行部分继续NOT_RUN。

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

Owner completed-resume Chief的workspace前置拒绝另验同一原操作、首次Native successor、官方providerfalse、零日志/会话/进程/permit/claim/transport/预算新增；fresh Native workspace与nested字段、原恢复control/claim、输入、旧累计及phase nonce必须闭合。以真实parent经过queue selector和生产binder后才可推进已有successor；一般第二次attempt、任意Chief失败、缺证据或旧行被改写仍拒绝。维护仅证明没有live provider时须明确保留scheduled行和phase，不误称全局空闲、不删除lease。

原生dispatch合同另验adapter前的管理字段写入：任务ledgerScope、初始accounting receipt与reservation采用真实安装版路径，字段值按可信task/run核对；不能要求所有usageJson为空，也不能把零token账务字段当作Provider未启动证明。保留Provider/session/process/output/Unknown污染负例，真实管理字段与调用证据分别判定。

受控中间前置拒绝的第二次retry须留全三行：最初官方bootstrapfalse、首次retry精确受控返回且历史null不改、现有attempt2；联合Native只读reconciliation、实际空日志/无会话进程、同op零physical及原phase/预算。原调度器→实际parent→selector→binder无模型合同通过后才允许Owner推进原有第二次行一次，不新建retry/wake/Root，不允许第三次或未知链。

首Root Chief plan的bootstrap恢复单列：父run明确Gate arguments拒绝、未claim且provider未启动，原根仅保留首次失败及其Native首次retry，没有flow、host claim/transport或未知结果。核对原owner wake、输入版本、operation/permit、Admission nonce和原预算槽；计划后暂停的`reviewBeforeDispatch`允许先产生首计划，但本人pause或待应用补充仍阻止执行。原1/6预算保留，新物理attempt正常成为2/6，不新建目标、wake或session来换额度。全局scheduler关闭时，等待到期不会自行推进；只有修复候选装配完毕后，才通过Native的原Issue retry接口推进已存在的run，并由常驻原消费者执行。保存计划产物、模型/进程组结束、Native终态及飞书结果，再进入本人补充阶段。源码回归不能替代这一实机证据。

后继run进入执行时核对：父run终态及结束时间、host result的run ID和非unknown/非超时/非取消、stdout/stderr实际SHA、原budget/operation映射、root/child输入版本、当前唯一Native执行与父Native租约释放。只对精确匹配的旧call锁归档和清除；失败产物有自己的run/operation/file/SHA只读archive。核对新operation的`acceptedRunId`为原Native后继run、`retryOfOperationId`指向旧操作，flow历史保留旧dispatch，Admission nonce、同child/root/session保持。确认物理调用开始后仅新增一条原根预算记录，沿原根可信上限（普通20次、历史明确12次与QA专项保持）及最多两次修复。

另验本人pause/add与已queued retry并存：后继run核实原物理失败后只能settle-only，保存同一原锁的immutable archive及settlement回执，以bootstrap NoProvider终结，不建新operation/advance flow/花预算。核对实际Native终态、环境租约释放与原Admission phase回收后，本人continue仍应用同root补充、旧hash/产物/预算保留。任何未知输出、scope/hash变化或锁漂移仍保留现场；不能凭模型或settlement日志声称Native已经终结。

离线回归覆盖伪造context retry声明、未启动的scheduled run、Native父关系不符、unknown/超时/取消或摘要错误、活动执行/未释放租约、输入改变、满额预算、错误锁和archive冲突。任何拒绝都保留旧证据。源码回归通过不代表真实重试、工具审批修复或业务验收已通过；这三项分别以实际Native和host回执记录。
