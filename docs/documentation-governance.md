# 文档治理与自动检查

## 权威与更新责任

项目规则定义权限与必需流程；架构和专题文档解释现行合同；代码证明实现；精确候选的日志与 CI 证明执行。带日期快照只证明观察时点，archive 只保留历史。冲突先查拥有该事实的来源，不能用历史结果覆盖当前未知。

`documentation-governance.json` 是必需文档、入口链接、历史类别和代码路径同步映射的机器清单。相关代码变更至少同步一份映射文档，文档改动必须说明行为和验收影响；日期状态或历史文件不能充当同步更新。未知代码路径拒绝通过，先补映射和专题说明。脚本不能证明文字准确，独立评审仍必需。

## 检查入口

镜像构建或 Compose 消费规则改动须同步运维、开发地图或架构对应说明；离线复用夹具通过不允许把实际构建、迁移或旧镜像退休写成已完成。

Docker 内运行 `node scripts/check-docs.mjs`，只检查结构和所有 Markdown 文件链接；`npm run check:docs` 同义。`npm run check` 执行静态文档检查及回归，不执行模型或业务预检。

变更映射必须提供 `--changes <JSON文件>`，格式为仓库相对路径数组，含删除及重命名的旧、新路径。CI 从 PR base 到 head 的实际 Git diff 获取；不使用可由 PR 作者填写的路径清单。日志输出到 `SUPER_AGENT_LOG_ROOT` 或 `logs/`，检查失败非零退出，成功日志也保留检查范围。

检查标准 Markdown 内联链接和 reference 链接，包含本地文件及标题锚点；忽略 fenced code 中的示例链接。链接不允许逃出仓库或通过符号链接读取外部文件。HTTP(S)、mailto 和其他显式 URI 不联网检查；因此远端链接可达性不在 PASS 的证据范围。

CI 的 `governance` 与 `offline-regression` 分别验证文档和完整离线回归，使用原生 Linux ARM64 runner 以匹配既有 ARM64 Node 镜像，不安装包、不挂载个人卷或凭据。工作流本身也属于独立评审范围。评审 API 的分页响应由 gh 原样收取、Node 归并并仅保留身份/状态/提交元数据，避免不同 gh 版本的 slurp/jq 组合不兼容。

CI 从目标分支读取原治理清单，通过 `--baseline-manifest` 同时检查既有映射，候选不能靠新增 nonCode 或删除规则免除原映射。首次建设时目标分支没有清单，须独立评审建立初始基线。检查脚本、工作流和清单本身仍属于必须审查的可信代码，不能宣称此机制可抵抗恶意改写整个 CI；分支保护缺失时不合并。

## 经评审的免更新

默认不存在例外。确实不影响文档时，可在 `.github/documentation-exceptions.json` 声明数组，例如 `[{"path":"docker/gateway.mjs","reason":"仅调整局部变量名，接口、日志和错误行为均不变"}]`。路径必须精确匹配，理由至少 12 字，不能通配或用于未知路径。

本地离线检查只有来自 PR 的当前 head、非作者且有效状态 APPROVED 的 GitHub review 证据才能接受例外。CI 通过只读 GitHub API 获取 review，按每人最后一次决定性意见计算，并把其及 PR head/作者传入 `--review-context <文件>`；不从 PR 文件读取评审身份。普通 COMMENTED 不撤销批准，CHANGES_REQUESTED 和 DISMISSED 撤销同一人的旧批准。过期、作者自评和伪造声明均不能豁免。

本地手工提供 review-context 只用于复现，不能替代远端真实评审；merge 前必须核对实际 API 与同 head 的 CI。本项目没有可用分支保护时始终禁止合并，例外不能扩展权限。

Chief 网页操作策略沿 bridge 路径映射维护架构、开发地图与验收手册。离线路由、策略与 Native repository 适配用例分别核对。真实 Paperclip 网页和运行回执另行验证。
