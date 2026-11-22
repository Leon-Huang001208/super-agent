# 任务级模型与 Runtime 隔离候选

## 范围与当前状态

2026-11-22用户选定：保留原12岗身份、汇报关系、Skills、权限和Codex会员，并新增[Full Stack Engineer](full-stack-engineer.md)，形成13岗候选。Chief先选全栈或专业岗位的唯一执行负责人，再按任务难度、风险、用途和工具需要选择模型/Runtime；先用隔离任务验收。Paperclip继续拥有任务、run、会话与正式恢复，不增加另一套调度器。

本专题是候选接口与验收合同。原12岗首批五次Native模型调用及独立QA已通过；普通QA产物权限reader修复后仅重验原回执与固定检查完成收尾，新增模型调用为0，原根累计6次（含原bootstrap调用）。原源码、失败与成功回执保留，不重跑已成功步骤。本轮13岗新源码、全栈业务和新增组合须取得新implementation proof，旧PASS不自动进入新池。生产仍固定旧12岗源码；自动调度/M2、UI、Cloud Apps、13岗完整业务、登录恢复及生产切换均未验证。本轮不部署升级生产；共享运行窗口仍归当前负责人。

## 当前绑定与任务选择

`role-runtime-profiles.mjs`定义以下固定档位，不含Key或岗位权限。`DEFAULT_ROLE_RUNTIME_ASSIGNMENTS`是全Codex的初始/旧绑定快照，`getRoleRuntimeProfile`只验证当前绑定，不能用它替代任务选择。

| Profile | Runtime / adapter | Canonical runtime model | Provider API model / credential kind |
|---|---|---|---|
| `codex_subscription` | Mac Codex / `codex_local` | `gpt-6.1-sol`，low | `gpt-6.1-sol` / `chatgpt-subscription` |
| `deepseek_opencode` | Mac OpenCode / `opencode_local` | `deepseek/deepseek-flash` | `deepseek-flash` / `api-key` |
| `minimax_opencode` | Mac OpenCode / `opencode_local` | `minimax-cn-coding-plan/MiniMax-M3.1-Flash` | `MiniMax-M3.1-Flash` / 国内 `coding-plan-api-key` |
| `deepseek_claude` | Mac Claude Code / `claude_local` | `deepseek-flash` | `deepseek-flash` / `api-key` |
| `minimax_claude` | Mac Claude Code / `claude_local` | `MiniMax-M3.1-Flash` | `MiniMax-M3.1-Flash` / 国内 `coding-plan-api-key` |

模型与Runtime分开选择。候选矩阵为Codex会员CLI，以及DeepSeek/MiniMax分别配OpenCode、Claude Code、OpenClaw、Hermes，共9个组合；5个已有候选执行描述子，描述子不是实际通过证据。Claude Code是外壳，不新增Claude模型订阅。OpenClaw当前固定Native只有gateway adapter；本机headless入口仍需单独本地adapter合同。Hermes当前Native把prompt放argv，宿主入口还会拉起gateway，本轮无网关限制下保持NOT_RUN。两者均不加入可执行池。

`task-runtime-router.mjs`先验证Chief给出的任务难度/风险/模型需要，再从已验收池按工具和任务类型挑选Runtime。Chief的prompt不能携带可用池、PASS或凭据；操作员私有登记需绑定真实Native成功、broker观测模型、usage、实际工具回执、进程闭合及源码/CLI指纹。未通过、未实现或实现已漂移的组合明确拒绝，不自动换成别的模型。普通授权范围内分派无需逐次问用户；controller仍校验原权限及任务身份。

控制器在原Admission/root锁合同下先保存准备记录、通过Native生命周期配置，再重读任务/预算/池与实现，持久化一次wake认领后fresh唤醒。配置或唤醒结果未知时留待对账。当前生产`wakeRole()`尚未接入新池；离线controller检查不能代替真实Chief自动分派验收。

可信Controller/经验证的Chief计划调用`selectTaskRuntimeProfile`，输入仅角色、complexity、risk、purpose和可选profileId，返回canonical profile与固定reason code。它不修改Native对象、会话、预算或权限，也不接受prompt作为授权。

- Chief Coordinator、Product Manager、Software Architect与独立QA优先Codex会员，本切片固定Codex。
- 执行岗位的complex/high-risk或unknown任务保守选Codex；缺少复杂度或风险信息同样按unknown处理。
- routine且low-risk的execution默认MiniMax，合适research/cross-check默认DeepSeek。执行岗位不永久绑定这些档位。
- Full Stack Engineer优先承担有界小功能、简单前后端联动、Bug与测试；Chief避免与专业前后端重复派工。复杂升Codex或明确交专业岗时保留原task/root、产物、累计预算和证据，仍需独立QA；本岗仅开发测试能力组合，不因任模型获得发布/网络/资源权限。
- 显式选择与core/risk/复杂度规则冲突时拒绝，不能把拒绝或provider失败转成静默fallback。

`runtimeAssignments`仍可保存完整13岗当前绑定快照，但只有task-routing模式及与当前operation一致的可信route才能授权候选API执行。`roleInstructions(...,{taskRuntimeRouting:true})`生成模型无关的任务绑定/handoff规则；无该flag的默认资产仅表示初始/legacy Codex绑定，不是全栈永久选型政策。

## 任务边界与执行合同

只在task开始或明确handoff边界选型。handoff必须以前run已知成功、transport成功、模型和broker实际执行闭合为前提；保存旧产物的版本/摘要及原预算记录，沿用同一task/root与项目，用新operation/run和fresh session继续。同Agent换Runtime保持Agent身份；全栈交专业岗还须真实Native责任转移与唯一Owner记录，不能仅改role字符串。它不是因模型失败自动升级，也不复制旧CLI session到另一Runtime。

route的任务/root/Agent/operation、输入版本及profile选择应重验，风险或范围变化重新进入可信控制器。活动/超时/取消/unknown、旧产物变化、已用计数变化或跨任务引用均拒绝。保留全局单执行、普通原根20次外层调用、每run64 responses及最多两轮QA返修；历史6/12次和第七次QA专项记录仍按原绑定可读。切换不退款、不重建Root、不重置已花调用。

Native准备、材料/知识摘要、工作区、能力allowlist、独立QA及outbox继续走原链。OpenCode仅为显式Mac原生候选，不据此宣称有Docker内OpenCode模型验收。当前无沙盒/approval never政策与其真实OS权限边界保留；任务工作区和配置隔离不等于整机OS级岗位隔离。

## 凭据、配置与broker

Codex保持既有会员链。DeepSeek OpenCode固定官方`https://api.deepseek.com/v1`，DeepSeek Claude Code固定`https://api.deepseek.com/anthropic/v1`；MiniMax国内Coding Plan固定`https://api.minimax.cn/anthropic/v1`。按具体Runtime使用chat-completions或Anthropic Messages，不允许任务文本替换endpoint、provider或model。Claude 2.1.330 SDK实际使用的精确`?beta=true`仅为Claude档位放行，其它query仍拒绝。

真实Key原件与临时工作副本仅在内盘受限控制区或受控容器内存，目录/文件0700/0600；不得进入Git、模型提示、CLI argv或普通日志。Native通过`secret_ref`解析控制侧Key；`SUPER_AGENT_ROLE_PROVIDER_API_KEY`只给控制侧，在调用stock OpenCode执行器前剥离。模型Host只获得每run opaque key与固定loopback HTTPS通道；broker按run、model、官方path、到期时间和请求计数核验，日志只记脱敏身份/状态/摘要。

`OPENCODE_CONFIG`只允许Agent专属的`/paperclip/control/research-pm/opencode-clients/<agentId>/config.json` marker；它不含真实Key，仅使Native不会误继承原OpenAI订阅。任意路径、内容/目录覆盖和上游凭据env仍拒绝。Host真正的OpenCode私有配置按run生成，不继承个人全局provider、session、MCP或Hooks；Native已提供的指令不重复前置。结束后按原结果/进程证明退休临时凭据，unknown时先核对，不掩盖原结果。

Claude使用独立的`CLAUDE_CONFIG_DIR` marker与Host配置，`--bare`、禁hooks/自动记忆/后台任务、严格MCP与固定所有secondary model；临时`ANTHROPIC_API_KEY`仅是opaque run token。本机假TLS探针已实际验证Claude/OpenCode的SSE及Host MCP协议，它不是厂商模型验收。会员委托不复制真实refresh token：每个Codex步骤在已取得真实租约、Owner及旧执行闭合后，要求至少210秒有效期，不足则向控制侧申请同账号的短委托，响应只写内盘并校验nonce、期限与身份。broker期限不得超过原委托期限；超时或未知不得唤醒模型。`implementation-proof.json`记录实际源码manifest、CLI入口/二进制、args与配置摘要；不记录完整prompt或认证。

## 隔离验收与证据

`scripts/multi-runtime-acceptance.mjs`使用`tests/helpers/multi-runtime-native-fixture.mjs`准备隔离Native数据库、公司、项目、fixture和控制根，只驱动明确列出的Native任务。原12岗历史fixture保持原source身份；新13岗候选须先完整迁移Native名册、资料、Skills、registry/catalog与执行器，再做新case。它不启动第二个SDK监听、M2或生产接单；共享Admission仍保留全局单执行，不用新私有锁绕过现有任务。

隔离数据库使用已有固定Postgres镜像、专属network-none命名空间及tmpfs；只对精确隔离库运行固定Native迁移，生产数据库不迁移。原生模型由宿主CLI执行。明文provider工作副本与恢复master保存在内盘受限bind，业务夹具/可配置cache在已核验WorkDisk。初始夹具出现的Postgres启动及材料名失败保留启动记录；材料名修正符合原UUID合同，未放宽gate。

已知bootstrap恢复须重读Native明确provider未开始且gate claimed=false、零Host claim/request、终态run、原12岗/同task/root与累计预算摘要。保留原失败/取消及原预算，新operation/run承接同任务；禁止Native自动重试。仅对已确认没有执行事件/PID/session/用量的取消孤儿补齐管理侧结束确认，原行和摘要先归档，记录Native activity，然后走真实生命周期恢复。未知执行或任何矛盾证据均拒绝，不造成功transport或改写原状态。

预定五步为：Backend routine任务由MiniMax执行；同一Backend task明确handoff给Codex；Research使用DeepSeek；PM使用Codex；独立QA使用Codex。验收固定的合成文件、命令与产物摘要，证明真实Native run/adapter、实际Mac CLI、provider/model、工具执行、结果收存与usage。未参与岗位或更广业务并未因此通过。

| 层级 | 当前状态 | 不能替代的证据 |
|---|---|---|
| 固定profile/策略、route、gate及broker离线检查 | 由本候选精确检查回执单列 | 真实模型、Native业务结果 |
| 原12岗五步Native模型与同任务handoff | PASS，5次真实调用、独立QA及固定检查；原根累计6次，收尾不新增模型调用 | 新13源码、生产启用或自动调度 |
| 新13岗迁移、Full Stack业务、新source组合 | 分步以`multi-runtime-current13-acceptance.json`真实回执为准，整体验收未完成前不入池 | 不继承旧12批PASS |
| 生产切换、M2、UI、Cloud Apps、13岗业务、重启恢复 | NOT_RUN；生产旧12仍pinned | 不能由源码、配置、旧CLI样例或隔离fixture推定 |

实际执行后记录candidate SHA、镜像/依赖身份、Native task/root/operation/run、CLI版本、provider/model、产物和测试、预算前后、fresh session、已闭合执行与用量。缺失费用/子工具退出码保持未知；保留原失败和known/unknown区别。不为补证据重跑已成功步骤或篡改旧计数。

CLI的`total_cost_usd=0`等只可记录为Runtime估算；没有真实厂商计费证据时实际费用保持未知，不能据此声称套餐免费。

新批次入口为`scripts/current13-runtime-acceptance.mjs --input <内盘私有输入>`，同Root新增具体需求：全栈微功能8项检查、同任务Backend HTTP扩展4项、MiniMax/Claude偏好模块5项、DeepSeek两种Runtime交叉检查及独立QA。`scripts/chief-runtime-routing-acceptance.mjs --input <私有输入> --cases /paperclip/control/research-pm/multi-runtime-current13-acceptance.json`只在新批次整体PASS后构池，由真实Chief先选唯一Owner再选模型/Runtime，控制器执行一次真实分派。父控制侧须提供300秒内的真实Mac源码/CLI指纹观察；共享槽可明确等待15分钟，模型运行上限仍为180秒。等待不新建Root、不重置已用预算，不停止其他任务。

已成功且Host闭合的前缀可用`--finalize-current13-prefix`纯复核原证据和固定检查，不读取凭据或新增模型调用；`--resume-current13 --input <私有输入>`仅接续尚未启动的步骤。整合最新主线导致源码指纹改变时默认拒绝；只有显式增加`--allow-historical-source-transition`并提供固定Host侧transition描述、精确候选回归与独立评审证据才接受历史前缀继续。旧run及implementation proof保留原摘要，不能因此成为新源码组合池的PASS；缺失或漂移的证据仍拒绝。
