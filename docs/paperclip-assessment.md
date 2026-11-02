# Paperclip 选型核查

## 核查基线

只读源码分析固定到 `1a6017d6460267ad89d7e1784e2b521c28d8e9ac`。第一轮发布包候选另为 v2026.1023.0；两者证据保持分离。

## 可复用与需补接的边界

| 部分 | 判断 |
|---|---|
| 任务与运行记录、原子 checkout、上下文恢复、审批与界面 | 值得复用 Paperclip；逐项运行验收后采用 |
| 飞书长连接、操作者绑定与卡片幂等 | 核查树中未见 Feishu/Lark 路径；作为明确的适配验收项 |
| RWB 验收、Git 安全入口与 PR 动作上限 | 继续使用 RWB 专有流程，中台只编排与收证据 |
| 每日 10 个新任务、单写入者、最多两轮修复 | 验证原生配置能否强制表达，不用月度费用预算代替 |
| 外部事件映射、决策版本及发送回执 | 最小桥接数据；不再保存第二份可编辑任务状态 |
| 已写自建代码 | 保留作为受限执行、RWB 桥接和回归用例参考，停止扩写独立任务中台 |

## 源码实证

- `packages/adapters/codex-local/src/index.ts` 定义 `DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX = true`。必须显式关闭并实测拒绝行为。
- `codex-args.ts` 在 classic CLI 路径可能添加 legacy `sandbox_mode=workspace-write`。Codex 新权限 profile 与 legacy sandbox 配置不组合，不能仅设 false 就声称私有文件隔离成立。
- `docs/adapters/codex-local.md` 描述 managed CODEX_HOME 的认证和配置播种，以及用户技能目录的符号链接。需先审查，不默认复制现有认证或改动全局技能目录。
- `docs/deploy/deployment-modes.md` 把 Tailscale/VPN 对应到 authenticated + private；默认 local_trusted 不需要登录，不能直接用作私有远程管理入口。
- 费用接入代码会区分 subscription/API，但存在 `costUsd: null` 的用量记录。不能据此推断订阅剩余额度或精确美元成本。
- 当前 README 说明源码开发默认启用 native Runner，并要求 Rust 工具链或兼容预构建 Runner；这与“始终仅 Node、Runner 都还实验性”的概括并不等价。
- RWB `git_safety delivery --publish` 返回延后自动合并的回执；`--status` 可能推进合并。PR 上限的适配器不能照搬完整交付轮询动作。

## 来源

- [官方源码](https://github.com/paperclipai/paperclip/tree/1a6017d6460267ad89d7e1784e2b521c28d8e9ac)
- [Codex 适配策略](https://github.com/paperclipai/paperclip/blob/1a6017d6460267ad89d7e1784e2b521c28d8e9ac/packages/adapters/codex-local/src/index.ts)
- [Codex 参数构建](https://github.com/paperclipai/paperclip/blob/1a6017d6460267ad89d7e1784e2b521c28d8e9ac/packages/adapters/codex-local/src/server/codex-args.ts)
- [部署模式](https://github.com/paperclipai/paperclip/blob/1a6017d6460267ad89d7e1784e2b521c28d8e9ac/docs/deploy/deployment-modes.md)
- [数据库](https://github.com/paperclipai/paperclip/blob/1a6017d6460267ad89d7e1784e2b521c28d8e9ac/docs/deploy/database.md)
- [发布候选](https://github.com/paperclipai/paperclip/releases/tag/v2026.1023.0)
