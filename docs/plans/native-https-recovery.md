# Native HTTPS 与原 Chief 计划恢复

## 问题与范围

2026-11-20 的真实 Mac 原生首计划恢复已经越过参数门与 Native bootstrap 绑定，但 Codex 0.169.1 报 `workspace backend must use an HTTPS origin without credentials`。当前执行器强制本地 HTTP broker 并把它传给 `chatgpt_base_url`；代理审计只有 metadata/MCP，模型 `/responses` 请求为零。CLI session 和运行预算占位不代表完成模型推理。

本次修复继续使用现有个人订阅、固定模型及 Mac 无沙盒策略。保留原任务、Native 行、operation 链、失败记录、Admission nonce、调用预算和已有技能；不重发目标、不创建另一队列、不改变 RWB 或接入 Document Specialist。

本人同时指定后续网络故障由Network Engineer牵头，Chief负责路由与执行协调，必要代码修改由对应开发岗完成，独立QA验收。此次同步两岗职责模板；Native材料在无在途模型的窗口通过现有认证保存链发布，其他岗位和项目知识保留。

## 每次运行的 HTTPS

Native broker 在 loopback 动态端口提供 HTTPS，复用现有认证、模型、会话及工具校验。就绪证据必须来自已监听的 TLS 端口；CLI 与 MCP 不消费 HTTP 就绪记录。证书含 loopback IP SAN，信任和私钥仅属于本 run，不写 Keychain 或系统 CA，也不关闭证书验证。

CLI 使用任务内 CA 与公共根的信任文件；Node stdio MCP 子进程显式继承任务 CA。旧 Docker 路径保留其既有端口与 listener 合同。TLS、错误 CA/主机名拒绝、MCP 调用和进程收尾分别验证，不能以参数字符串或 fake CLI 成功代替真实 TLS 握手。

当前 CLI 默认尝试 WebSocket，现受控 broker 的模型入口使用 HTTP POST 流。本 run 的 `paperclip_broker` CLI 配置固定 `wire_api=responses`、`supports_websockets=false`、`requires_openai_auth=true`，请求仍进入同一任务 broker；Native 选定的个人订阅、凭据解析、上游模型和工具校验不变，不提供 API key 或 API 回退。不能覆盖 CLI 保留的内置 `openai` provider，单设两个旧 WebSocket feature 为 false 也不足以改变当前 CLI 的实际方法。

真实 CLI 的无模型合同使用隔离 HOME/CODEX_HOME、synthetic auth 和只在本机监听的 mock HTTPS。合法 workspace routing fixture 使用 accounts List 与 `NO_CONSTRAINT`；旧 Map 会丢弃 routing 字段。mock 故意拒绝模型请求，只验证证书、路由、POST、模型/effort、认证与会话头，不连接上游。此合同的通过不能冒充模型完成推理；真实账户的区域约束不改写成 `NO_CONSTRAINT`。

## 首计划的第二次 Native 重试

只扩展原根 Chief/plan 的明确 HTTPS-origin 失败：Native 已有 attempt2，父为第一次 retry，原链可追溯最初 Gate 拒绝，且同任务、输入、本人、项目、原预算和 Admission。旧两个调用槽不退款，新物理执行仍由 `withRoleCall` 记入原六次上限。

恢复前核对 Native 终态、完整真实 transport 的输出摘要、精确错误、零模型 response 审计、进程清理回执及已释放环境租约。缺证据、其他错误、模型请求存在或结果未知均拒绝；不能把已启动 CLI/broker 的旧 Native 行伪写成 bootstrap NoProvider。

匹配的旧锁通过既有失败归档与 CAS 收尾，再绑定同一个 Native 后继；不删除未知锁。M2 只通过可复核的归档证据将该旧失败认作 settled，保留原 Native result。新证据拒绝保持 reconciliation/unknown，不自动认证为未调用 provider。

## 原预算与计划暂停

Chief 提示使用可信当前预算，扣除本次计划调用后，为 summary 保留一槽。若当前是第三槽，之后剩三次，计划最多两个子任务。计划校验仍使用同根真实账本，模型文字不扩大额度。

原 `--plan-first` 继续在生成计划、持久化 checkpoint 与通知后等待本人继续，不实际派发子任务。此时不修改其他岗位旧 error 状态，也不把未执行的下属任务称作通过。

## 验证与应用

先通过无模型 TLS/恢复合同测试、完整离线回归、独立评审及精确 PR/CI，再在无活动模型/宿主传输且原 scheduled retry 已保全的窗口，切换同一 App 与 owned resident。三个 Role/Team/Feishu 开关和 registry/context 保持启用，全局 scheduler 关闭；启动恢复入口同步新候选。

最后仅通过常驻 App 的已认证单 Issue retry-now 接口推进既有行，请求前核对其精确 run/parent/attempt。持久一次性请求记录防止等待、超时或响应未知后重复 POST；运行后核对真实结果、预算、计划摘要、通知、进程组及 Native 环境租约。源码、无模型验证、实际推理、计划暂停和业务验收分别记录，失败不自动另起尝试。
