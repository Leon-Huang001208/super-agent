# Paperclip Docker 验证方案 · 2026-11-02

> 原候选验证记录，包含旧 xhigh 目标。本轮候选已要求 low，现行验收见 [验收手册](acceptance-runbook.md)，实际运行身份见 [日期状态](governance-status-20261104.md)。不要从此文件直接启动或覆盖新运行候选。

用户已选择：先验证Paperclip，通过后唯一调度；所有产品依赖在Docker中；新数据在外置SSD，现有Docker数据不迁移。

## 固定资产

- Paperclip2026.1023.0，releaseGit为1b4c803816e82b0265c8422e1a804327a7ed8c54。master只读审查与此候选的验收证据分开。
- Node镜像 node@sha256:a52166d89cfcc66ea62d10535ca712d161cece5d77ff4cfa758866b6b75ccb3f。
- PostgreSQL镜像 postgres@sha256:a717692f944862397bd102c6abee9b3f7927adbf7ee5f3a93e50b65aea0c5396。
- 依赖规格与完整锁在docker/；由安装容器安装，启动校验同锁与根包版本。宿主历史Node/lock仅作reference。
- 镜像文件 /Volumes/My PSSD/SuperAgent/paperclip-data.sparsebundle，专用APFS挂载点 /Volumes/SuperAgentDockerData。
- 数据根 /Volumes/SuperAgentDockerData/paperclip-v2026.1023.0，保存dependencies、state、postgres、workspaces、logs；当前依赖bind为dependencies-codex-0.159.0。升级保留旧依赖目录及镜像以便回退。

ExFAT不能直接承载npm符号链接及PostgreSQL。scripts/sa核查专用卷，所有bind禁用create_host_path，缺盘必须失败。

## 部署

Compose项目为super-agent-paperclip-eval。PostgreSQL只连internal控制网络；应用通过现有代理出网；gateway只转发固定后端，映射loopback8097，不是通用代理。没有宿主HOME、RWB目录或Docker socket挂载。

认证为authenticated/private，精确允许本机8097来源。Tailscale8443和宿主自启动未配置；现有443入口保持原位。定时调度关闭、公司暂停。

preflight的statfs仅记录容器可见文件系统，不能证明宿主系统盘空间达标；本次容器值与宿主df明显不同。宿主磁盘门槛尚未接入业务准入程序，当前由公司/Agent暂停及默认拒绝执行阻止业务开工。后续启用前须实现并验收该门槛。

Codex与Claude默认只允许认证/版本操作。订阅hello可使用独立的单次许可，详见subscription-hello.md；这不等于业务任务权限。

## 后续验收顺序

1. 完成托管订阅真实hello，保存模型、引擎、退出状态及不确定结果。不自动换模型、转API或重试未知结果。
2. 磁盘满足门槛后，明确CLI引擎、gpt-6.1-sol/xhigh、禁用bypass、隔离workspace及Skill；执行只读与worktree修改任务。Linux容器不冒充Mac原生验收。
3. 验证日限10、全局单写、两轮修复、等待释放、重启核对、重复事件/卡片/远端回执。
4. 接入飞书、GitHub和RWB既有Git安全/验收入口。交付上限PR；RWB git_safety --status可能实际合并，不能作为自动轮询入口。
5. 全部必需行为有同候选真实证据后才采用Paperclip；失败项保留，不将状态记录持久化视为恢复成功。
