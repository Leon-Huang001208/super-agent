# Super Agent · Paperclip 集成与受控交付

当前主线：优先验证 Paperclip，通过后由它唯一负责跨项目任务与调度。本项目保存飞书、RWB、执行权限适配和验收资产。

从 [文档索引](docs/README.md)、[架构](docs/architecture.md)、[开发地图](docs/development-map.md) 和 [开发交付](docs/agent-workflow.md) 开始。代理还须读取 [AGENTS.md](AGENTS.md)。

2026-11-04 已核对：实际服务从独立、存在未提交改动的统一集成目录启动，不能用本 checkout 覆盖运行实例。本轮两条 low 档位真实验收尚未执行；运行与远端阻塞见 [日期状态](docs/governance-status-20261104.md)。旧 hello 只证明当时的认证请求。

## 运行与检查

所有产品依赖和测试都在 Docker 中，不安装宿主产品依赖。现有宿主 Node/Git/gh 用于受管工程操作；Docker 数据位置不变。评估管理脚本要求专用 APFS 卷 /Volumes/SuperAgentDockerData：

```sh
./scripts/sa status
./scripts/sa test
./scripts/sa preflight
./scripts/sa logs
```

test 在无网络容器中运行回归检查。preflight 记录容器事实，不代表业务验收。logs 保存脱敏日志并返回路径。未挂载专用卷会拒绝启动，不能在宿主盘创建替代数据库。

当前主线中的 Codex 包装器默认拒绝业务任务，hello 使用单次只读许可。独立运行候选的业务入口须另核对；失败或未知结果不自动恢复许可，不复制宿主认证、不转付费 API。干净 CI 的 Docker 验证见开发地图，不依赖个人外置卷或认证。

## 边界与文档

- 首个项目为 ResearchWorkbench；Codex 开发和独立评审，Claude 手动选择。
- 上海日限 10 个新任务，全局单写，最多两轮修复。RWB 代办止于 PR；本项目自身在 CI、独立评审和分支保护满足后可自动合并。
- 数据、凭据和日志在外置SSD的专用APFS卷，秘密不入仓库。
- 当前真实验收固定既有订阅 `gpt-6.1-sol` / `low`；[产品目标](docs/product.md)、[验收手册](docs/acceptance-runbook.md)、[运行维护](docs/operations.md)。
- [文档治理](docs/documentation-governance.md)、[Docker 验证基线](docs/paperclip-evaluation.md)、[旧交接快照](docs/current-handoff.md)。
- [订阅 hello 说明](docs/subscription-hello.md)、[来源校验修复](docs/auth-origin-fix.md)、[旧原型保全](docs/prototype-checkpoint.md)、[选型分析](docs/paperclip-assessment.md)。

旧自建设计已归入 [历史资料](docs/archive/self-built-architecture.md)。离线检查、真实模型、CI、业务验收和资源收尾分别报告。
