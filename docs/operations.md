# 运行维护与恢复

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

Paperclip 评估项目名为 `super-agent-paperclip-eval`。专用数据根 `/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0`，底层为外置 SSD 的 APFS sparsebundle。Docker.raw 仍保持原位。数据库、订阅认证、workspace、日志和旧候选必须保留；本仓库不保存秘密。

运行身份以实时容器 inspect 的镜像 ID、Compose 来源、挂载及启动命令为准，不能以本目录的 compose 文件代替。2026-11-04 已观察到运行服务从另一个统一集成目录启动，详见 [当日状态](governance-status-20261104.md)。

## 只读核查

- 用 `docker ps` 和选择字段的 `docker inspect` 核对服务、镜像、挂载与配置来源，避免输出整个环境变量和认证内容。
- 用宿主 `df` 和 APFS 挂载检查确认系统盘与专用卷；业务准入必须来自新鲜宿主证据，容器 statfs 不足以证明达标。
- 同时核查 Paperclip 原生 run、任务、进程、执行 journal 和外部结果。暂停或没有日志不能证明排空；字段缺失、读取失败和状态冲突一律未知。
- 日志必须脱敏，`scripts/sa logs` 仅收集其已知服务，不能代表后续集成服务的全部日志。

## 更新窗口

### 镜像构建、复用与退役

使用 `./scripts/sa image-build` 显式准备镜像，`./scripts/sa image-audit` 只读清点本入口登记的镜像。已登记且输入、平台、镜像 ID 与指纹标签吻合时直接复用；未登记的同名镜像、失效引用、Docker 观察失败均停止，不把未知视为缓存未命中。构建失联时保留自有锁及暂存上下文待核对，不重跑。

构建上下文仅包含 Dockerfile、运行脚本、包装命令与安装锁文件；不包含任务数据或凭据。Dockerfile 中固定的基础镜像必须已在本地。构建成功回执仅证明精确构建身份；离线回归、评审、部署和业务验收仍走各自门。实际安全更新需要显式更新构建输入，不能以每任务一个新标签刷新依赖。

`./scripts/sa up` 按当前输入解析精确镜像 ID，固定 Compose 文件和项目名，禁用隐式配置覆盖、构建及拉取。登记将本次构建元数据的镜像 manifest/index digest 解析为本地 ID，再与标签实际指向比对，不把配置 digest 当镜像 ID；无法核实即保留锁和现场。镜像构建登记和日志保存在专用外置根。首次采用新入口须在获授权的运行升级窗口准备同候选镜像并验证；本次源码改动不改正在运行的独立集成目录。

清点保留有容器引用的镜像和未知镜像。无容器引用的登记项仍是待核对候选；须由资源所有者同时证明不属于现用、上一已验回滚版本或恢复/活动依赖，才按正式退休流程处理。禁止全局 prune。见[外置存储规划](external-storage-plan.md)。

仅在明确候选和授权后关闭新派发，确认无活动及未知任务，保全数据库可读备份、原镜像与依赖、会话和回执。升级仅触及 Super Agent 专用容器。镜像、依赖和源码不一致、其他任务持有工作区或未知结果时停止；不强杀、不删锁、不重置任务。

恢复数据库连接、应用和单一飞书连接后先保持派发关闭。核对同一任务、原 attempt、幂等键、旧许可消费和外部 PR/通知状态；只有确定尚未发生的动作才继续，未知动作先查回执。旧模型许可不恢复，不为了恢复重跑模型。

本轮可在排空后升级专用评估实例；Docker Desktop 全局重启、数据库迁移、新依赖、RWB 常驻服务及系统配置不在授权内。当前有并发脏集成候选时不执行更新。两条验收结束后恢复暂停调度。

固定版本的 Chief 网页路由由显式启动配置提供装配器。运行镜像包含源码模块和对话插件包，镜像复用键覆盖全部打包输入。启用前核对发布包 app.js、agent-conversations.js 摘要和认证模式。路由插入发生在进程加载时，已安装依赖文件保持原样。回合回调未知结果时使用持久消息唤醒核对，不重发模型。插件启用、实际业务授权和专用应用重启各自留证。

## 故障与回退

缺盘、低于 5 GiB、宿主证据失效、租约未知、日限耗尽、评审缺失、CI 未知及外部结果未知都拒绝继续写入，保存稳定错误码及脱敏日志。不建立替代数据库、不切备用 API。

启动失败先检查精确候选及日志。回退必须重新满足排空和兼容检查；保留上一个已验证镜像及依赖。备份可列目录不等于真实恢复成功；没有演练证据就标明未演练。禁止直接 `down -v`、Docker prune、删数据库或删除不明锁。

## 飞书多项目交付

本人私聊使用 `/任务 <项目名> <需求>`，并在 `文件：` 下逐行声明范围。启动方从可信配置登记项目名、Paperclip 任务适配、必跑检查和准入账本命名空间。飞书输入只选择已经登记的项目。通用入口统一核对登记回执、输入版本和补充关联。项目适配器负责自己的仓库、分支、文件与写入授权。

RWB 是当前运行覆盖层的内置项目，保留现有 `/rwb` 兼容入口。其他项目通过启动方的 `projectAdapters` 注册，并使用同一套接单逻辑。每个适配器须在隔离环境验证实际执行、发布、CI 及恢复证据，随后才能接入真实任务。飞书仍使用一个监听。

### RWB 运行覆盖层

自动接单以实际运行的 Native、飞书和宿主组件为基线。操作前确认飞书唯一监听、Paperclip 任务排空、共享写租约和旧 Host 窗口为空。保留现有容器配置、镜像及数据，保持历史发件请求隔离。用 `node scripts/prepare-feishu-auto-rwb-overlay.mjs <Paperclip运行包> <飞书运行包> <新目录>` 从固定基线生成候选。准备器核对每个替换文件的字节摘要，输出候选摘要清单。用 `scripts/check-feishu-auto-rwb-compose.mjs` 对照正在运行的容器核对原文件字节、镜像、挂载、环境和隔离选项。候选复用原镜像、网络和数据卷。

在统一集成状态根的私有 `feishu-auto-rwb/policy.json` 设置有效窗口和至多两组精确路径。每组写入预先用目标仓库验证规划器核实的检查 ID。原运行配置保持 `dispatchMode=off` 和 `githubMode=off`，仅专项已绑定任务进入受控派发。结束时排空原操作、关闭专项策略并保留记录。回退恢复原容器定义和镜像，先核对在途操作与远端 PR。
