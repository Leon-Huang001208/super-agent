# Full Stack Engineer：13岗候选

## 范围与组织

用户于2026-11-22明确新增Full Stack Engineer，取代此前不增岗位的方案。新角色键为`full-stack-engineer`，显示名Full Stack Engineer，Native role为`engineer`，向Software Architect汇报，产物类型`implementation`。原12个Agent的身份、名称、职责、reportsTo、任务和历史保持；不重跑全团队初始化，不替换前后端专业岗位。

当前候选源码定义13岗；生产仍固定旧12岗源码。源码、Native登记/ready、技能与材料物化、工具连接、真实业务与部署分别验收。已有旧12岗首批五次Native成功运行和CSV结果只绑定其原源码、任务/run及证据，保留原件，不为适配新角色而重跑或改写，也不自动授予13岗候选组合池资格。

## 分工与任务路由

Chief先按任务范围选择全栈或专业岗位，确定每个工作范围的唯一执行负责人，再分别选择模型与Runtime。小功能、简单前后端联动、Bug修复及相关测试优先全栈；涉及复杂架构、专业边界或高风险的实现交Architect和对应专业岗。相互独立的范围可以分别交付，同一页面/API/业务变更不得同时分给全栈与前后端重复实现。

全栈routine且low-risk的执行默认优先MiniMax；调研/交叉核对按需DeepSeek。复杂、高风险或信息未知时保守使用Codex，或由Chief明确交接给专业岗。模型和Runtime必须来自实际已验收且源码/CLI身份仍匹配的组合池；模型失败不触发自动fallback，不把岗位说明当切换授权。

升档及换岗沿同一task/root、原产物、累计调用预算和检查继续；已知原run完成且执行闭合后，由可信Controller应用明确handoff，记录新的唯一负责人和operation/run，使用fresh session。旧候选、失败和用量不删除，不能新建Root或换ID清零。角色跨Agent的交接与同Agent换Runtime是不同合同，前者需实际Native责任转移与证据，不能只改role字符串冒称完成。

## 完整职责与能力

本岗读取目标代码、项目规则、PM验收、必要设计、Architect接口与上游证据，在有界范围内完成页面/状态、API接入、后端规则、错误传播及相关回归。Bug先复现再修复，复用项目既有测试和构建入口；提交精确候选、变更文件、真实命令/退出码、端到端路径、必要浏览器证据和NOT_RUN。

完整资料在`assets/role-profiles/full-stack-engineer/AGENTS.md`与`CAPABILITIES.md`，分别由`roleInstructions`、`renderRoleCapabilitiesMarkdown`生成并逐字回归。Native任务材料用`roleInstructions('full-stack-engineer',{taskRuntimeRouting:true})`，不永久写某个模型；默认全Codex map仅是初始/current-binding snapshot。

公司默认方法为共同的paperclip、handoff、verification-before-completion，加frontend-design、frontend-testing-debugging、webapp-testing、systematic-debugging、test-driven-development、property-based-testing。React/Next.js匹配时启用react-best-practices，shadcn匹配时启用shadcn，PostgreSQL/Supabase stack或service匹配时启用supabase-postgres-best-practices。复用已存在的方法和来源，不引入依赖或安装。

权限上限为现前后端的开发/测试范围：host.project_inspect、host.project_check、host.project_git、host.github_read及前端已有的浏览器目录；项目服务MCP须显式登记允许本岗。新增岗位不继承host.project_publish、host.rwb_release、网络/系统资源操作、全局重启或root。补充能力仅可组合本岗、frontend-engineer、backend-engineer，不能通过组合DevOps/Network/Resources扩大权限。canCreateAgents=false、canAssignTasks=false、canCreateSkills=true与既有开发岗一致；方法资料不产生系统权限。

全栈开发必须安排独立Quality Assurance Engineer；开发自测不自签PASS。普通原根20次、每run64 responses、最多两轮QA返修、全局单执行及历史预算保护继续。QA问题沿原实现任务返修，旧reviewedArtifacts和结论保持历史归属，新复核绑定新候选。

## 同批登记与验收

`ROLE_KEYS`末尾追加本岗，前12顺序保持。TEAM_ROLES、能力表和公司选择均含本岗；DEFAULT_ROLE_RUNTIME_ASSIGNMENTS及初始化/Bootstrap严格计数从ROLE_KEYS派生。新13岗验证器拒绝缺本岗的12岗roster/intent；拒绝本身不是旧生产故障，应由原pinned执行器继续解释旧状态。历史回执不得用新13岗验证器重新认证或“修正”。

Native迁移由隔离登记入口负责：先保存并只读核验旧12 Agent/汇报/材料/预算/任务及源码证据，显式新增本岗UUID，在同一受控批次完成13岗执行器、Native记录、company desiredSkills/currentVersion、Managed材料/CAS、registry/catalog、plan.rosterHistory及调用预算的一致绑定。失败保留可恢复证据，不在旧12岗执行器下新增paused占位；本轮不迁移生产数据库或切换生产服务。

源码测试覆盖13岗完整性和旧12元数据保持、严格roster/bootstrap、完整资料、条件Skills、权限负例、独立QA。后续真实全栈任务须覆盖一个小型前后端/API流或Bug+tests、实际工具与固定测试、Native收存及独立QA；升级/交接另取实际责任、同task/root/累计预算和fresh session证据。静态方法与资料通过不等于该业务已经执行。
