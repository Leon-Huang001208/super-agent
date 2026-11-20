# Mac 原生 Agent 与公司 Skill 分配

## 已确认目标

2026-11-20本人确认将现有11角色的最终Codex进程切到Mac原生；Paperclip及数据库继续使用当前运行环境，Docker按项目需要承担构建、检查与服务。岗位与可信任务范围内的危险操作默认授权，Codex使用`--dangerously-bypass-approvals-and-sandbox`。已有明确禁令、目标项目交付规则、独立QA及模型调用预算继续有效。

开始盘点时公司库有104个Skill，11个Agent均未配置`paperclipSkillSync.desiredSkills`。真实角色任务另从31个静态包选取Skill。上传、界面分配、包已物化、依赖可用和模型实际读取是不同证据，必须逐层记录。

## 执行链

Paperclip保留原run/任务/订阅选择及单次认领。可信registry中的执行策略固定到当次permit；Mac宿主传输使用原request/stdin/stdout/stderr/result/cancel协议，启动已有原生Codex与每run broker。原Docker路径作为显式兼容和回退模式保留，不在原生失败时自动改用另一执行器重试。

每run使用独立CODEX_HOME、Native选择的个人订阅与当前岗位MCP目录，不加载宿主全局Codex配置。材料、项目worktree和Skill路径映射为真实宿主路径；broker仅监听loopback动态端口。记录PID/进程组及启动身份；取消、超时和恢复仅处理本run的进程。结果未知先核对原run，不重新调用模型。

Mac原生无沙盒不提供操作系统级岗位隔离。岗位边界体现在职责、可信任务、连接及工具权限；它也不会自动取得root、辅助功能或屏幕录制权限。

## 公司技能与职责

Agent的`adapterConfig.paperclipSkillSync.desiredSkills`是唯一分配来源。沿用原生公司Skill导入、Agent同步与Managed岗位文件接口；完整包保留来源、版本、许可证、相对引用和文件摘要，每run固定快照。旧专业包保留并登记到私有库，不能因统一来源丢失当前能力。

首批补齐superpowers的调试/验证/规划/TDD、Vercel React、Supabase Postgres、Trail of Bits差异安全评审/属性测试、OpenAI威胁建模和marketingskills内容/SEO/文案。GitHub Star是仓库级指标；实际导入版本及静态审查结果以本轮清单为准。

所有岗位保留必要Paperclip操作技能，按岗位分配专业方法，React/shadcn/Postgres依项目条件加载。重复名称使用完整来源key区分；PDF默认Anthropic版本。无对应需求、模板和迁移助手不默认开启；缺实际工具或连接的能力标明依赖缺失。

Chief负责团队招募与分派，Architect协调前后端技术任务，其他专业角色执行其职责。Research向PM交接，QA独立向Chief汇报。职责摘要、AGENTS、CAPABILITIES及真实工具权限同步；当前任务已授权动作不因上游Skill通用文字重复要求批准，不执行删除他人代码或强制引入额外工作流的冲突指令。

## 验证与运行记录

完成标准为：11角色配置与Skill文件一致、真实原生CLI参数无冲突、包内引用完整、依赖状态真实、取消/超时/恢复可核对、项目Docker检查按需执行。通过现有测试、文档检查、精确候选独立评审及PR/CI后，在排空窗口更新原实例，保留原配置供回退。

代表性真实验收最多使用6次个人订阅调用，覆盖Research→PM、Frontend→QA、Network和System Resource；其他岗位的配置/物化验证不能冒充其业务验收。验收状态与精确候选另记，本文不将计划标为已部署或PASS。
