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

- Agent 模型执行采用 Mac 原生 Codex，项目构建、测试和服务按项目需要使用 Docker；复用现有宿主 Codex/Node/Git/gh，不隐式安装依赖。原生执行链的 macOS 检查在宿主运行，Docker 检查与宿主证据分开。
- 新增或修改代码有明确错误处理和脱敏日志，日志在 `logs/` 或 `SUPER_AGENT_LOG_ROOT` 指向的专用外置日志目录。不得记录密钥、认证原文或完整模型提示。
- 运行 [开发地图](docs/development-map.md) 的相关检查；关键路径按 [文档治理](docs/documentation-governance.md) 同步文档。免更新必须有具体理由及当前 PR head 的独立批准证据。
- 依赖安装、新依赖、秘密处理、数据库迁移、系统配置和部署均须任务专项授权。不得跳过测试、删锁、强推或强删脏 worktree。

## 授权和交付

- 用户已将仓库设为 public；本项目在检查、独立评审和真实服务端分支保护满足后自动合并。必需状态为 governance、offline-regression、independent-review；新 head 必须重新绑定评审。缺保护仍阻断，不以人工直推替代。tag、版本发布及生产部署不在持续授权内。
- 代办 RWB 任务最高动作仍是 PR，禁止调用可能自动合并的状态入口；使用 RWB 自身 Git 安全和验证规则。
- 真实验收固定现有个人订阅 `gpt-6.1-sol` / `low`，无 API 回退、无换模型、未知结果不自动重试。开发和评审独立会话，每任务最多两轮修复；不设每日新任务数量硬上限，保留原模型调用预算、全局单写。
- 当前新增专项覆盖Research/PM真实交接、本人确认的11角色与汇报关系、Apps/Plugins安全测试、取消每日新任务数量硬上限及已绑定本人飞书验收；运行接线由主窗口统一负责。RWB 常驻服务、Docker Desktop 全局重启、数据库迁移、新依赖不在此范围。
- 资源仅在明确归属本任务、退休、证据归档和安全复查后回收；其他任务、研究资料、凭据、旧原型和恢复证据保留。

## Document Specialist 专项

本人于2026-11-20授权按实际需要新增一个文件与文档专职岗位。本次定义增加`Document Specialist`（`document-specialist`），向Chief汇报，复用现有公司文档Skills、个人订阅、Mac原生策略及根调用预算。保留原11岗的身份、资料、权限和历史，不重跑全队初始化。共享运行仍由当前主窗口持有；仅在明确协调的窗口同时完成12岗源码、单岗Native登记、catalog/材料及正式生命周期验证，不能在旧11岗执行器下先放一个paused占位。

## 原生执行与岗位持续授权

本人于2026-11-20确认 Mac 原生 Agent＋按需 Docker，并授权各岗位在可信任务范围内自动执行所需危险操作，关闭 Codex 沙盒及逐项审批；跨岗共享对象由 Chief 指定负责人。此授权覆盖本轮执行链改造、Skill 导入分配、职责权限更新和排空后的运行切换。保留11个现有 Agent、汇报关系、个人订阅、模型、预算、独立 QA 和恢复历史。明确禁止的动作仍受原约束；无沙盒不代表 root 或 macOS 隐私权限已授予。实施与证据见 [原生执行和技能分配](docs/plans/native-skills-20261120.md)。
