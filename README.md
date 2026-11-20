# Super Agent · Paperclip 集成与受控交付

当前主线：优先验证 Paperclip，通过后由它唯一负责跨项目任务与调度。本项目保存飞书、RWB、执行权限适配和验收资产。

从 [文档索引](docs/README.md)、[架构](docs/architecture.md)、[开发地图](docs/development-map.md) 和 [开发交付](docs/agent-workflow.md) 开始。代理还须读取 [AGENTS.md](AGENTS.md)。

运行实例消费精确提交的独立候选，不能用工作区未提交内容覆盖。12岗的职责、能力与实际任务反馈见[持续迭代](docs/agent-iteration.md)；源码、Native材料发布、真实业务和部署分别验证。[2026-11-04快照](docs/governance-status-20261104.md)保留原时点含义，不能覆盖当前运行事实。

## 运行与检查

所有产品依赖和测试都在 Docker 中，不安装宿主产品依赖。现有宿主 Node/Git/gh 用于受管工程操作；Docker 数据位置不变。评估管理脚本要求专用 APFS 卷 /Volumes/SuperAgentDockerData：

```sh
./scripts/sa status
./scripts/sa test
./scripts/sa preflight
./scripts/sa logs
```

test 在无网络容器中运行回归检查。preflight 记录容器事实，不代表业务验收。logs 保存脱敏日志并返回路径。未挂载专用卷会拒绝启动，不能在宿主盘创建替代数据库。

Native业务入口以原任务/run的受控许可调用现有个人订阅，Mac原生模型关闭沙盒，Docker按需使用；hello仍为单次只读验证。失败或未知结果不自动恢复许可，不转API。干净CI的Docker验证见开发地图，不依赖个人外置卷或认证。

## 边界与文档

- 首个项目为 ResearchWorkbench；Codex 开发和独立评审，Claude 手动选择。
- 不设每日新任务数量硬上限，原根默认6次、可信复杂任务12次，保留已有计数、每run64 responses、全局单写及最多两轮质量返修。RWB普通代办止于PR，本人本次授权的历史交付仅经绑定任务的DevOps发布接口按批合并部署。本项目自身在CI、独立评审和分支保护满足后可自动合并。
- 数据、凭据和日志在外置SSD的专用APFS卷，秘密不入仓库。
- 当前真实验收固定既有订阅 `gpt-6.1-sol` / `low`；[产品目标](docs/product.md)、[验收手册](docs/acceptance-runbook.md)、[运行维护](docs/operations.md)。
- [文档治理](docs/documentation-governance.md)、[Docker 验证基线](docs/paperclip-evaluation.md)、[旧交接快照](docs/current-handoff.md)。
- [订阅 hello 说明](docs/subscription-hello.md)、[来源校验修复](docs/auth-origin-fix.md)、[旧原型保全](docs/prototype-checkpoint.md)、[选型分析](docs/paperclip-assessment.md)。

旧自建设计已归入 [历史资料](docs/archive/self-built-architecture.md)。离线检查、真实模型、CI、业务验收和资源收尾分别报告。
