# Super Agent · 个人自动化中台

Mac mini 上的个人自动化系统：飞书任务或经过本人授权的 GitHub Issue，进入持久队列，经隔离开发、独立评审和项目验证后交付 PR。

## 初始边界

- ResearchWorkbench 为首个项目；Codex 开发和独立评审，Claude 为手动选项。
- 上海时间每天最多启动 10 个新任务，全局单并发，最多两轮评审反馈修复。
- 默认关闭模型执行和外部通知；完成配置及受控验收后明确启用。
- 运行数据位于 `~/Library/Application Support/SuperAgent/`，日志位于其 `logs/` 子目录，秘密不进入仓库。
- 服务使用 `127.0.0.1:8097`，私有访问规划使用 Tailscale HTTPS 8443。

## 开发与验证

需要 Node 25.9 或以上。依赖用途及固定版本见 [依赖清单](docs/dependencies.md)，安装须按用户授权要求执行。

```sh
npm test
npm run build
npm run setup
npm run doctor
npm start
```

初始管理员令牌只保存在本机私有文件中。请在本机配置页设置管理员密码；不要把密钥或令牌发到聊天里。

## 文档

- [架构与接口](docs/architecture.md)
- [已批准实施方案](docs/implementation-plan.md)
- [依赖清单](docs/dependencies.md)

测试、真实模型运行、飞书联通、远端 CI 和业务验收分别报告，不能互相替代。
