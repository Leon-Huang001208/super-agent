# Super Agent 开发规则

## 开始工作

- 默认中文。先读 [文档索引](docs/README.md)、[架构](docs/architecture.md)、[开发地图](docs/development-map.md) 和 [工作流](docs/agent-workflow.md)。修改前读取文件及所属文档。
- 本仓库是 Paperclip 集成与验收资产。Paperclip 是唯一目标调度方；旧自建核心是历史，不启动第二个调度器。
- 区分源码、运行候选、业务验收和资源收尾。未执行为 NOT_RUN，活动未知不得当成空闲。

## Harness 与隔离

- 每个交付任务通过 `node scripts/project-runtime.mjs session` 显式开始或恢复受管 Harness；项目固定版本的校验、交付、验证记录和收尾命令见工作流。
- 高风险及发布任务使用 `iteration-delivery`、`--delivery-required` 和 `--require-delivery`。本项目覆盖框架的直接推送默认值：除首次经审查的基线外，必须 PR、适用 CI 和独立评审通过后再合并。
- 不覆写其他 worktree；不能从路径名称、暂停、容器健康推断无活动任务。遇到其他任务的未提交集成版本，保持原状并报告。

## 代码与验证

- 既有 Mac 原生 Codex 执行合同保留；本次任务级多 Runtime 隔离候选可显式使用 Mac 原生 OpenCode/Claude Code 和绑定的 DeepSeek/MiniMax。OpenClaw/Hermes先核具体组合，未验不入池、不启动竞争业务调度。项目构建、测试和服务按项目需要使用 Docker；复用现有宿主工具，不隐式安装依赖。原生执行链的 macOS 检查在宿主运行，Docker 检查与宿主证据分开。
- 新增或修改代码有明确错误处理和脱敏日志，日志在 `logs/` 或 `SUPER_AGENT_LOG_ROOT` 指向的专用外置日志目录。不得记录密钥、认证原文或完整模型提示。
- 运行 [开发地图](docs/development-map.md) 的相关检查；关键路径按 [文档治理](docs/documentation-governance.md) 同步文档。免更新必须有具体理由及当前 PR head 的独立批准证据。
- 依赖安装、新依赖、秘密处理、数据库迁移、系统配置和部署均须任务专项授权。不得跳过测试、删锁、强推或强删脏 worktree。

## 授权和交付

- 用户已将仓库设为 public；本项目在检查、独立评审和真实服务端分支保护满足后自动合并。必需状态为 governance、offline-regression、independent-review；新 head 必须重新绑定评审。缺保护仍阻断，不以人工直推替代。tag、版本发布及生产部署不在持续授权内。
- 本人于2026-11-22确认 Super Agent 代办 RWB 与直接 Codex 执行采用相同的项目授权，不再额外限定为 PR-only。RWB 自身持续授权、必需检查、独立评审、最新基线和分支保护满足后，可通过原 Git 安全入口自动合并并安全收尾；生产部署仍须具体任务授权和受管写窗口。原历史批次的 DevOps `host.rwb_release` 继续绑定其原任务、候选及操作，不扩大为默认部署权。
- 既有 Codex 验收仍固定现有个人订阅 `gpt-6.1-sol` / `low`，无 API 回退。任务级多 Runtime 候选只接受可信控制器显式绑定的主选档位，API 主选不是会员失败后的 fallback；仅在任务开始或已知成功且执行闭合后的明确 handoff 切换。未知结果不自动重试或换模型。开发和评审独立会话，每任务最多两轮修复；不设每日新任务数量硬上限，保留原模型调用预算、全局单写。
- 当前专项包含12岗（含Document Specialist）、RWB实际交付中的持续迭代；本人于2026-11-22将每个原任务默认角色调用上限改为20次，Chief、执行岗和QA共享，补充、续接和重试不重置已用计数，最多两轮QA返修及每run64 responses保持。可信历史12次记录和原第七次QA专项保持可读，由本人受管登记20次后才覆盖其旧额度；授额不重开或唤醒任务。共享运行接线及 RWB 常驻切换先核对当前唯一写窗口并交接，不停止在途模型。全局 Docker 重启、无关数据库迁移及未知资源删除不在此次授权内。
- 资源仅在明确归属本任务、退休、证据归档和安全复查后回收；其他任务、研究资料、凭据、旧原型和恢复证据保留。

## Document Specialist 专项

本人于2026-11-20授权按实际需要新增一个文件与文档专职岗位。本次定义增加`Document Specialist`（`document-specialist`），向Chief汇报，复用现有公司文档Skills、个人订阅、Mac原生策略及根调用预算。保留原11岗的身份、资料、权限和历史，不重跑全队初始化。共享运行仍由当前主窗口持有；仅在明确协调的窗口同时完成12岗源码、单岗Native登记、catalog/材料及正式生命周期验证，不能在旧11岗执行器下先放一个paused占位。

## 任务级模型与 Runtime 隔离候选

本次候选保留现有12岗身份、汇报、Skills和权限，并按用户2026-11-22最新决定新增第13岗Full Stack Engineer，Native role为engineer、向Architect汇报，完整合同见[全栈岗位候选](docs/plans/full-stack-engineer.md)。Chief先选全栈或专业岗位并确定唯一执行范围，再选模型和Runtime，避免重复派工。Chief Coordinator、Product Manager、Software Architect与独立QA优先Codex会员，本切片固定使用Codex；执行岗位不永久绑定某个模型。复杂、高风险或信息未知时保守用Codex，routine且low-risk的执行默认MiniMax，合适的research/cross-check默认DeepSeek。显式选择与核心岗或风险规则冲突时拒绝，不静默fallback。

Chief使用Codex分别判断模型与Runtime工具需要，可信Controller核验已通过组合池、实际源码/CLI及原权限后执行普通分派，不让用户逐次手动切换；prompt、网页、Skill或岗位自述不授予切换权。任务开始或明确handoff继续使用同一task/root、原产物、累计调用预算和checks，保持fresh session，不跨Runtime复制会话。`DEFAULT_ROLE_RUNTIME_ASSIGNMENTS`只是初始/旧绑定快照，不是执行岗永久使用Codex的策略。细节见[候选合同](docs/plans/task-runtime-routing.md)。

Full Stack Engineer承担小功能、简单前后端联动、Bug与测试；权限不超过既有前后端开发/测试，不继承发布、网络、资源或root权限，仍交独立QA。复杂度升级为Codex或交专业岗时，沿同task/root保留原产物、累计预算和证据，明确交接唯一负责人，不用新任务重置计数。

生产仍固定旧12岗源码；13岗source、Native新Agent、公司Skills、Managed材料、registry/catalog与执行器必须在隔离候选同批迁移，不能先在旧12岗执行器下新增paused占位。旧12岗五次成功Native运行及CSV证据保留原source身份，不重跑或改写，也不自动算入13岗新源码组合池。本轮不声明生产动态切换、自动调度/M2/UI/Cloud Apps或13岗业务全部通过；共享写窗口仍由当前负责人持有，验收与窗口交接前不升级或部署生产。

## 原生执行与岗位持续授权

本人于2026-11-20确认 Mac 原生 Agent＋按需 Docker，并授权各岗位在可信任务范围内自动执行所需危险操作，关闭 Codex 沙盒及逐项审批；跨岗共享对象由 Chief 指定负责人。此授权覆盖本轮执行链改造、Skill 导入分配、职责权限更新和排空后的运行切换。保留11个现有 Agent、汇报关系、个人订阅、模型、预算、独立 QA 和恢复历史。明确禁止的动作仍受原约束；无沙盒不代表 root 或 macOS 隐私权限已授予。实施与证据见 [原生执行和技能分配](docs/plans/native-skills-20261120.md)。
