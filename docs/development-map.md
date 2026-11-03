# 开发地图

| 子系统 | 本仓库入口 | 维护与验证 |
|---|---|---|
| 容器与存储 | `compose.yaml`、`docker/Dockerfile.runtime`、`scripts/sa` | 专用 APFS、只读根、固定镜像、日志和缺盘拒绝；Docker 回归 |
| 依赖与候选 | `docker/package*.json`、`evaluation/candidate.json` | 固定版本与完整性；候选校验不等于安装或业务验收 |
| 订阅 hello | `docker/bin/codex`、`docker/codex-hello-gate.mjs` | 单次许可、只读、无回退、进程终止与审计；不能充当业务执行器 |
| 网关与初始化 | `docker/gateway.mjs`、`docker/bootstrap*.mjs`、`docker/server-entry.mjs` | 精确 Origin、秘密不回显、启动校验及错误传播 |
| 预检与日志 | `scripts/paperclip-preflight.mjs`、`scripts/redact-logs.mjs` | 容器预检和脱敏；容器 statfs 不是宿主磁盘准入 |
| 文档与 CI | `scripts/check-docs.mjs`、`.github/workflows/ci.yml` | 文档结构、同步映射、免更新审查、离线回归 |
| 受管 PR 复用 | `scripts/existing-pr-runner.mjs` | 精确候选、同仓库同基线、拒绝其他动作和 SHA 条件合并；真实保护、CI 与评审状态仍必需 |

本轮候选要求已改为 `gpt-6.1-sol` / `low`，预检拒绝旧 xhigh 配置；`acceptance` 仍为 NOT_RUN。此更改不修改运行实例的 Agent 配置或 hello 历史，也不代表业务模型调用已发生。

## 已验证的运行检查入口

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

## 运行集成边界

当前工作区的基线不包含后来统一集成目录中的 bridge、业务执行许可、宿主准入及恢复模块。该目录是独立候选且存在未提交改动，不能复制覆盖或视为已合入。其能力应在取得一致、已提交候选后逐项核对合同、测试和运行证据，再接入本体系。参见 [当日状态](governance-status-20261104.md)。
