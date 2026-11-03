# 历史：自建架构与接口

本文件是已停止扩写的历史方案，未声明以下 API 已实现。现行 [Paperclip 架构](../architecture.md) 优先。

## 组件

`sources → intake → store / scheduler → executor / project adapter → outbox → channels`

- `src/core/`：SQLite 事务、任务和事件关联、决策、配额、执行租约、恢复及通知去重。
- `src/executors/`：Codex JSON-RPC stdio、Claude print JSON 协议；模型与会话配置固定。
- `src/projects/`：RWB Git 安全入口、验证策略及 GitHub 受控写入。
- `src/sources/`：GitHub polling、飞书长连接；所有外部文本都是数据。
- `src/http/`：认证、CSRF、请求校验与 API；`ui/`：React 面板。

配置是版本化 JSON；SQLite 保存任务采用的不可变配置快照。秘密通过本机私有文件引用，API 仅返回是否已配置。

## 网页 API（全部 JSON，除 session/login/setup 外均需会话）

- `GET /api/session` → `{ authenticated, setupRequired, csrfToken? }`
- `POST /api/auth/setup` → `{ bootstrapToken, password }`
- `POST /api/auth/login` → `{ password }`；`POST /api/auth/logout`
- `GET /api/overview` → `{ counts, quota, disk, integrations, intakeEnabled }`
- `GET /api/tasks` → `{ tasks: TaskView[] }`
- `GET /api/tasks/:id` → `{ task, attempts, events, artifacts, decisions }`
- `POST /api/tasks` ← `{ projectId, title, description, executor? }` → `{ task }`
- `POST /api/tasks/:id/actions` ← `{ action: pause|resume|cancel, version, comment? }`
- `GET /api/decisions` → `{ decisions }`
- `POST /api/decisions/:id/resolve` ← `{ choice, taskVersion }`
- `GET /api/config` → `{ revision, settings, projects, rules, credentialsConfigured }`
- `PUT /api/config` ← 同上，忽略 credentialsConfigured；revision 必须匹配。
- `POST /api/integrations/feishu` ← `{ appId, appSecret?, ownerOpenId? }`，不回显秘密。

写请求带 `X-CSRF-Token`；Origin 必须在本机或已配置的私有地址列表内。错误形状为 `{ error: { code, message } }`。

TaskView：`id, projectId, title, status, stage, version, createdAt, updatedAt, executor, prUrl?, summary?, errorCode?`。
Decision：`id, taskId, taskVersion, title, detail, choices: string[], status, createdAt`。

状态：queued、running、paused、waiting_user、waiting_checks、pr_ready、failed、cancelled。

面板每 5 秒刷新可见数据；交互失败显示错误码，不把失败写成成功。
