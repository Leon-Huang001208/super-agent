# Super Agent · Paperclip Docker 验证

当前主线：优先验证 Paperclip，通过后由它唯一负责跨项目任务与调度。本项目保存飞书、RWB、执行权限适配和验收资产。

评估实例已运行在 http://127.0.0.1:8097；管理员、新手向导与个人 OpenAI 订阅 hello 已完成。Codex 0.159.0 / gpt-6.1-sol 真实验证通过。公司与 Chief 暂停、定时调度关闭；完整业务闭环尚未验收。

## 运行与检查

所有产品依赖和测试都在 Docker 中。宿主不需要安装 Node/npm/Python，现有 Docker 数据位置保持不变。先挂载专用 APFS 卷 /Volumes/SuperAgentDockerData，再执行：

```sh
./scripts/sa status
./scripts/sa test
./scripts/sa preflight
./scripts/sa up
./scripts/sa logs
```

test 在无网络容器中运行回归检查。preflight 记录容器事实，不代表业务验收。logs 保存脱敏日志并返回路径。未挂载专用卷会拒绝启动，不能在宿主盘创建替代数据库。

Codex 默认拒绝任务执行；连接 hello 仅使用绑定订阅、模型和有效期的一次性许可。失败或不确定结果不自动恢复许可，不复制宿主认证、不转付费 API。

## 边界与文档

- 首个项目为 ResearchWorkbench；Codex 开发和独立评审，Claude 手动选择。
- 上海日限10个新任务，全局单写，最多两轮修复；交付上限为PR。
- 数据、凭据和日志在外置SSD的专用APFS卷，秘密不入仓库。
- Tailscale HTTPS8443、飞书和RWB业务闭环仍待实施。
- [当前状态](docs/delivery-status.md)、[Docker 验证方案](docs/paperclip-evaluation.md)、[当前交接](docs/current-handoff.md)。
- [订阅 hello 说明](docs/subscription-hello.md)、[来源校验修复](docs/auth-origin-fix.md)、[旧原型保全](docs/prototype-checkpoint.md)、[选型分析](docs/paperclip-assessment.md)。

原 architecture.md、implementation-plan.md、dependencies.md 保留历史自建设计，不作为当前安装指引。离线检查、真实模型、CI与业务验收分别报告。
