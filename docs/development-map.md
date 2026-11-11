# 开发地图

| 子系统 | 本仓库入口 | 维护与验证 |
|---|---|---|
| 容器与存储 | `compose.yaml`、`docker/Dockerfile.runtime`、`scripts/sa` | 专用 APFS、只读根、固定镜像、日志和缺盘拒绝；Docker 回归 |
| 镜像复用 | `scripts/runtime-image.mjs`、`tests/runtime-image.test.mjs` | 同输入重复构建只执行一次；Chief 网页源码和插件纳入输入指纹；输入变更、未知镜像、引用漂移、并发和低盘拒绝；独立镜像清点不删除 |
| 依赖与候选 | `docker/package*.json`、`evaluation/candidate.json` | 固定版本与完整性；候选校验不等于安装或业务验收 |
| 订阅 hello | `docker/bin/codex`、`docker/codex-hello-gate.mjs` | 单次许可、只读、无回退、进程终止与审计；不能充当业务执行器 |
| 网关与初始化 | `docker/gateway.mjs`、`docker/bootstrap*.mjs`、`docker/server-entry.mjs` | 精确 Origin、秘密不回显、启动校验及错误传播 |
| 预检与日志 | `scripts/paperclip-preflight.mjs`、`scripts/redact-logs.mjs` | 容器预检和脱敏；容器 statfs 不是宿主磁盘准入 |
| 文档与 CI | `scripts/check-docs.mjs`、`.github/workflows/ci.yml` | 文档结构、同步映射、免更新审查、离线回归 |
| 受管 PR 复用 | `scripts/existing-pr-runner.mjs` | 精确候选、同仓库同基线、拒绝其他动作和 SHA 条件合并；真实保护、CI 与评审状态仍必需 |
| 项目工程运行时 | `scripts/project-runtime.mjs`、`scripts/vendor/leon-engineering/` | 固定 0.19.4 模块与来源校验，显式 Harness 和交付入口，旧回执续接；`tests/project-runtime.test.mjs` 和 `tests/management/project-runtime-git.mjs` |

本轮候选要求已改为 `gpt-6.1-sol` / `low`，预检拒绝旧 xhigh 配置；`acceptance` 仍为 NOT_RUN。此更改不修改运行实例的 Agent 配置或 hello 历史，也不代表业务模型调用已发生。

## Chief 网页续接策略

`bridge/chief-web-pilot.mjs` 是 #261 的限定操作策略。入口接收服务器已认证的本人会话和命令。调用方提供持久事务接口，在原 Paperclip 任务锁下读取绑定、版本、消息和历史操作，并原子记录意图与控制门。该接口只保留关联与回执，任务状态以 Paperclip 为准。

`bridge/chief-web-native-store.mjs` 对接原 Native repository 的任务行锁与 activity ledger，持久化操作意图和暂停门。离线用例验证策略、事务回滚与重建后的回执。`bridge/chief-web-routes.mjs` 提供默认关闭的原生路由安装器，借助 Paperclip 的已认证用户、公司成员和会话代际校验状态与控制请求。显式启动选项可通过 `docker/chief-web-app-hook.mjs` 在固定发布包的同源保护后挂载路由，`bridge/chief-web-paperclip.mjs` 使用同一个应用数据库和固定版本依赖装配 Native 适配和操作策略。`plugins/chief-web-pilot` 使用原生对话的任务详情插槽展示状态与控制。`bridge/chief-web-paperclip-repository.mjs` 使用固定版本的 issue service 锁定原任务与当前对话代际，再读取回合证据和写入操作意图。`bridge/chief-web-supplement-evidence.mjs` 核对本人消息、已结束的 Chief 回合和物理调用回执。`bridge/chief-web-settlement.mjs` 接收固定版本的原生回合收尾和后续核对，按同一消息登记含原始摘要、回合、唤醒及调用标识的补充意图。`bridge/chief-web-intent-consumer.mjs` 由既有控制器调用，在受管认领后执行补充或更新原 PR，并以原操作核对未知结果。`bridge/chief-web-intent-authority.mjs` 在 Native 行锁下持久认领与核对回执。真实启动所需的既有执行准入、发布绑定、插件启用和会话验收仍需接线及验证。

## 已验证的运行检查入口

真实 RWB 网页入口由 `bridge/chief-web-real-intake.mjs` 和 `bridge/chief-web-real-engine.mjs` 接入。私有操作交接只由 `scripts/chief-web-real-runner.mjs` 的本次受控运行消费。主应用与模型容器使用同一镜像指纹，订阅会话只在本次模型容器中可用。

`bridge/chief-web-runtime-bootstrap.mjs` 按固定 Paperclip 服务指纹装配 #261 入口，并读取私有绑定、调用证据和本次执行投影。`bridge/chief-web-recovery.mjs` 管理确认后的认领、发布、CI 回写和租约收尾。端口适配器必须提供原生任务记录、目标项目 Git 安全能力和权威回执。

`compose.chief-web-evaluation.yaml`、`bridge/chief-web-evaluation.mjs` 和 Chief 插件共同提供隔离网页演练。Docker 回归覆盖登记事务、权限、对话代际、候选匹配和未知结果恢复。使用 Chrome 和真实 PostgreSQL 的证据另行记录。

现有评估管理脚本依赖外置卷，不能用于无专用卷的干净 CI：

```sh
./scripts/sa status
./scripts/sa test
./scripts/sa preflight
```

`status` 只说明容器；`test` 是离线回归；`preflight` 是候选环境观察。它们不证明业务闭环。不要从此 checkout 执行 `up/stop`，除非先确认它确实拥有当前运行配置。

干净 checkout 的无产品安装检查使用现有固定 Node 镜像，输出写入忽略的 logs：

```sh
mkdir -p logs
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m \
  -v "$PWD:/workspace:ro" -v "$PWD/logs:/logs" -w /workspace \
  -e SUPER_AGENT_LOG_ROOT=/logs \
  node@sha256:a52166d89cfcc66ea62d10535ca712d161cece5d77ff4cfa758866b6b75ccb3f \
  node --test tests/*.test.mjs
```

文档静态检查将最后一行替换为 `node scripts/check-docs.mjs`。带变更映射的检查使用 [治理流程](documentation-governance.md)；Docker 无须挂载 `.git`，由宿主先生成路径和评审输入。

项目工程运行时的基础镜像合同覆盖全局安装缺席、校验失败前拒绝执行、旧 Harness 会话续接、资源内核路径保护及 GitHub 混合检查类型。真实 Git 管理验收另运行 `node --test tests/management/project-runtime-git.mjs`，覆盖原交付回执、远端候选失效、CI 失败、资源阻塞及 `delivery --status` 的回执更新。该命令在已有且固定镜像 ID 的 Node+Git 工程容器运行，挂载仅限本次 checkout 和日志，网络关闭，根文件系统只读，临时目录使用允许执行本地 `gh` 夹具的 `--tmpfs /tmp:rw,exec,size=64m`。基础 Node digest 未包含 Git，所以原有 CI 离线测试入口继续执行基础合同。管理验收命令与镜像 ID 记录在本次交付证据中。

## 运行集成边界

当前工作区的基线不包含后来统一集成目录中的 bridge、业务执行许可、宿主准入及恢复模块。该目录是独立候选且存在未提交改动，不能复制覆盖或视为已合入。其能力应在取得一致、已提交候选后逐项核对合同、测试和运行证据，再接入本体系。参见 [当日状态](governance-status-20261104.md)。
