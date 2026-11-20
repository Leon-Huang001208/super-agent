# 运行维护与恢复

## 原生Agent切换

保持原AI连接时，配置更新不应触发无许可generic hello。固定源的进程内AI equality修复只纠正键顺序误判，不能关闭真实连接变更验证；源SHA漂移应停止装配。首次分配官方paperclip操作包也须有Native版本快照，包含其全部references/scripts，不能仅把SKILL.md登记为完整能力。

安装版公司Skill列表是轻量视图，不携带完整metadata。同步只为本次审查清单命中的sourceLocator读取已认证详情，核对id/company/sourceLocator后补充reviewedSource；不把列表缺字段当成审查记录丢失，也不批量拉取无关技能的正文。

实际安装版的本地目录导入不会自动建立currentVersion。同步工具对新导入和已导入但缺版本的包，先核验完整目录，再通过原生`POST /companies/:companyId/skills/:skillId/versions`创建唯一缺失快照，回读逐文件比对后才分配；已有版本不覆盖。`--asset-root`和`--package-root`必须指向公司已登记workspace或受管Skill目录中的任务专用暂存，不能放宽后端目录边界。并存的GitHub自动导入条目保留，优先选本轮已审查的固定版本。

当前飞书监听要求team已启用才能启动。暂停派发维护时先在本次Compose中暂时关闭飞书监听，应用保持可访问；完成配置和验收后恢复原team状态及监听开关，不能把team暂停和原监听启用同时作为应用启动配置。

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
