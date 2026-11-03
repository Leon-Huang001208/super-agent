# Super Agent 开发规则

## 开始工作

- 默认中文。先读 [文档索引](docs/README.md)、[架构](docs/architecture.md)、[开发地图](docs/development-map.md) 和 [工作流](docs/agent-workflow.md)。修改前读取文件及所属文档。
- 本仓库是 Paperclip 集成与验收资产。Paperclip 是唯一目标调度方；旧自建核心是历史，不启动第二个调度器。
- 区分源码、运行候选、业务验收和资源收尾。未执行为 NOT_RUN，活动未知不得当成空闲。

## Harness 与隔离

- 每个交付任务自动开始或恢复受管 Harness；入口在 `$HOME/.agents/leon-engineering/runtime/`，不复制到仓库、不修改全局框架。具体命令见工作流。
- 高风险及发布任务使用 `iteration-delivery`、`--delivery-required` 和 `--require-delivery`。本项目覆盖框架的直接推送默认值：除首次经审查的基线外，必须 PR、适用 CI 和独立评审通过后再合并。
- 不覆写其他 worktree；不能从路径名称、暂停、容器健康推断无活动任务。遇到其他任务的未提交集成版本，保持原状并报告。

## 代码与验证

- 产品依赖、模型执行和测试都在 Docker；复用现有宿主 Node/Git/gh 仅供工程管理，不在宿主安装产品依赖。
- 新增或修改代码有明确错误处理和脱敏日志，日志在 `logs/` 或 `SUPER_AGENT_LOG_ROOT` 指向的专用外置日志目录。不得记录密钥、认证原文或完整模型提示。
- 运行 [开发地图](docs/development-map.md) 的相关检查；关键路径按 [文档治理](docs/documentation-governance.md) 同步文档。免更新必须有具体理由及当前 PR head 的独立批准证据。
- 依赖安装、新依赖、秘密处理、数据库迁移、系统配置和部署均须任务专项授权。不得跳过测试、删锁、强推或强删脏 worktree。

## 授权和交付

- 用户已将仓库设为 public；本项目在检查、独立评审和真实服务端分支保护满足后自动合并。必需状态为 governance、offline-regression、independent-review；新 head 必须重新绑定评审。缺保护仍阻断，不以人工直推替代。tag、版本发布及生产部署不在持续授权内。
- 代办 RWB 任务最高动作仍是 PR，禁止调用可能自动合并的状态入口；使用 RWB 自身 Git 安全和验证规则。
- 真实验收固定现有个人订阅 `gpt-6.1-sol` / `low`，无 API 回退、无换模型、未知结果不自动重试。开发和评审独立会话，每任务最多两轮修复；上海日限 10、全局单写。
- 当前专项授权只覆盖两条限定文档任务、已绑定个人飞书验收会话及排空后的专用评估容器升级。RWB 常驻服务、Docker Desktop 全局重启、数据库迁移、新依赖不在此范围。
- 资源仅在明确归属本任务、退休、证据归档和安全复查后回收；其他任务、研究资料、凭据、旧原型和恢复证据保留。
