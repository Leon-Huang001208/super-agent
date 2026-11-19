# Research 与 PM 原生能力接入

## M0 现场核查，2026-11-19

实际非云盘主检出为 /Users/leon/Developer/Super Agent，干净提交 c83400cd08c99c28772c97929dfcd5044f2eca8a。独立实现位于 WorkDisk 的 Projects/SuperAgent/research-pm-m1-20261119。WorkDisk APFS UUID 已核对为 2BC466D2-FD62-4395-86AC-45CFF653BC51。

Docker context 为 desktop-linux。评估应用与日常 Chief 应用引用同一镜像 sha256:ce66c5354e5efdd7279953134cba2a43c16b54e618a9e15ca6eb83e6bcae0c6c。评估实例的数据、固定依赖及覆盖层依赖 /Volumes/SuperAgentDockerData，该挂载当前缺失。旧 sparsebundle 位于 My PSSD/SuperAgent/paperclip-data.sparsebundle，但本轮未挂载或修改。评估应用、评估数据库均退出。

日常 Chief 应用也依赖该旧挂载，启动错误明确指出 broker 路径缺失。日常数据库使用独立命名卷，健康且存在一个 in_review 任务 81077116-4bfb-4574-9133-56a76ac2dbdd，不能认定排空。其 heartbeat_runs 查询无记录，不能用此事实证明原任务无外部动作。旧租约、通知、模型会话和评估数据库因挂载缺失保持 UNKNOWN。

## M1 设计与顺序

Paperclip 保留唯一任务、assignment、run 和 session 归属。Research 和 PM 是同一项目的角色。复用现有 projectAdapters、个人订阅、原生 codex_local 及单一飞书监听。旧 wrapper 保留，新增角色需独立受控许可及实际工具校验。

先实现纯读取的材料预检与知识投影。材料由部署方的固定清单提供相对路径、字节摘要和必需引用。目录链拒绝符号链接，读取有界，摘要变化即拒绝。role 私有记录只向对应角色公开，项目记录跨角色可见。确认决定带版本、来源和适用条件；任务状态继续读取 Paperclip。

后续先将上述预检接在实际原生执行器准备入口，再启用一个 Research 与一个 PM。装载失败须阻止模型启动。必须用真实运行证明工具可用和被拒绝情况。当前不能把纯函数验证或旧 JSON 文档 worker 记为业务验收。

PM Skill 的跨设备参考包须先核对声明的 ZIP SHA、六成员白名单及文件指令。本机没有已核实安装副本；传输文本不等于已接入。

## 验收与当前缺口

离线验收覆盖引用缺失、摘要变化、路径穿越、符号链接、材料总量、项目隔离、角色私有隔离和决定版本。实际执行还需原挂载恢复及身份核对、数据库/租约/原操作排空证明、原生适配器源码审计、wrapper 新路径许可、真实技能加载和工具证据。

真实调研、PM 产物、跨新会话记忆召回、真实飞书去重与续接均为 NOT_RUN。新增源码与运行开关分别交付。

只读来源挂载尝试使用本任务 Scratch 的独立 mountpoint，系统返回“权限被拒绝”，未恢复原挂载。M0 因此仍缺外置核心、旧数据库、会话和租约的原件核对。此为当前技术阻塞，不以历史终态覆盖。

离线材料预检及知识读取候选已有 Docker 回归，尚未接到原生适配器。正式任务、模型、飞书、运行切换和业务验收均未开始。

离线 Role preparation 端口核对 task/agent/project/run/owner/inputRevision、前后 Native revision、固定订阅配置、必需材料及角色知识。它只输出待审核准备结果，dispatch 与 toolVerification 明确为 NOT_RUN。现行原生执行器尚未接入此端口，待完整运行包核实后完成装配和真实工具范围验证。

日常数据库的未完任务属于 Chief process Agent，company 为 d79278a0-288f-4ae8-96e9-e39e16ef45d8，project_id 为空，任务更新于 2026-11-09。模型运行表为空，原任务仍 in_review。角色准备端口要求 Native 权威读口确认 projectKey/role 并复制第一次读取的快照，防止缓存原地更新掩盖版本漂移。

2026-11-19 原挂载由本人通过 Finder 成功恢复，APFS UUID 0A71984A-FF62-4B30-8E23-D91478C246F8。评估db及app按原ID恢复，所有执行/调度开关false。评估69条run均终态，但manual in_review与active旧恢复动作仍需保全，不把无running视为业务完成。飞书覆盖层121+1文件摘要全部通过。PM ZIP的15960字节、声明SHA和六成员已核对，落在本任务assets下，尚未实际加载。用户另授权迁移窗口独占运行环境，本窗口已交接并暂停运行写入。

新增 native-role-adapter 为原生 codex_local execute 的预检包装候选，保留原ctx、身份及回调，禁止直接CLI替换、API回退和resume旧session。现行应用尚未导入该包装；需迁移窗口释放后，在受控配置中完成原生注册表与prepareRole装配及真实工具核验。新增合同测试在迁移期间暂未执行。

## 真实运行候选的工具约束

新角色保留原 codex 命令路径。wrapper 仅在原生注入角色标记且存在精确 run 许可时进入新增 gate，旧 hello/Chief 分支保留。新 gate 固定个人订阅模型/low、read-only sandbox、禁用 shell/unified_exec/apply_patch/apps/plugins；Research 仅开公开网页搜索，PM 关闭网页搜索。角色材料和研究结果由原生适配器注入，原生任务/运行/会话继续归 Paperclip。每 run 独占 claim，重复或未知结果不得重发。真实模型工具枚举、搜索来源和拒绝证据尚待验收。

2026-11-19 存储迁移已完成并正式交还窗口。WorkDisk运行镜像与原逻辑APFS UUID保持，两库隔离还原通过。原生角色装配选用 Paperclip registerServerAdapter 包装已有 codex_local execute/testEnvironment。探针也须有Root操作许可、共用原 AdmissionMeter 的上海日限10及全局租约，每任务共6次物理调用，probe/run共用单活调用锁。确定未执行的拒绝释放本次调用锁，执行后未知结果保留待核。角色开关与旧Chief/hello各自限定。

CLI 0.159.0实际features list确认shell_tool、apps、plugins为false；unified_exec显示true，即使显式设false也未改变。不能据此宣称执行工具已全面隔离，真实会话须以实际工具行为记录，并仅使用独立哨兵夹具验证，禁止读取真实秘密。新wrapper命令仍为原路径，新增lane要求精确Native run/task/agent/company、订阅home/grant和材料SHA。

## 工具范围的最新本人授权

2026-11-19本人要求对Research/PM开放shell、文件补丁、Apps和Plugins并全部测试。此授权覆盖本轮受控工具矩阵；候选现使用workspace-write、shell/unified_exec/apps/plugins及网络搜索，写入仅用于任务目录和独立哨兵。安装、连接、配置开启和真实工具调用分开记录；缺少连接或授权时保留受限，不把模型文字声明当机械拒绝。前文只读小工具集方案已被本段取代。

## 全工具执行的隔离与计数

Native的受管wrapper将授权的stdio委派给临时任务容器。此传输不创建第二任务、运行或会话存储。应用和模型均不挂Docker socket；宿主仅以既有Docker CLI管理一次调用的隔离资源。任务容器不挂应用state、宿主HOME或其他角色知识，网络仅连接私有任务网。任务外的临时provider broker持有Native选择的订阅授权；模型只拿限时opaque授权，原授权不从任务回写。固定订阅后端使用同一模型及low，不转付费API。

预算分母明确区分。每任务最多6次Native外层调用（包括环境探针），每个工具run的provider broker最多转发64次responses。固定session header不证明请求来自原CLI，不能宣称任意shell请求均可归因给某个工具；计数以broker实际转发次数和Native记录核对。用户的上海每日10个新任务与全局单任务执行继续使用原AdmissionMeter。

测试已证明初始隔离桥中两套DB5432与应用3100不可达、应用密码/socket/宿主HOME不可见。新任务内部网络和受控TLS出口需在实际运行中再次验证。公开HTTPS出口按IP拒绝私网目标；未知或取消发布持久取消意图，原锁保留，不自动重发。

## 现场接线修正

Native托管订阅拒绝Agent配置内的原始-c参数，故Agent仅声明原生支持的sandbox参数，已授权的工具和传输参数由可信任务执行层施加。原生验证还需明确引用已有master key文件，不能创建替代key。以bind挂载替换CLI wrapper时必须保留可执行位；镜像构建中的chmod不能替代宿主文件的模式验证。前两次环境预检均没有hello provider claim，按原操作证据收存，未作模型通过证据。
