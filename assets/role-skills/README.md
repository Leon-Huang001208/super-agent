# 岗位 Skills 只读资产包

`shared/engineering.md`保存经用户双端协调提供的共同工程方法。角色只在编码、脚本、测试或评审任务中按需读取，不复制整段进每份岗位正文；工具路径仍须按当前平台及项目环境核验。该文件同样纳入`index.json`支持文件摘要。

共同工程方法采用实现→直接检查效果→交付，不采用防御式推进。Skill中的计划审批、TDD重写、全量fresh验证等泛用步骤按当前任务裁剪，已有授权与有效结果继续使用；第三方包保留来源内容，不将其泛用流程当成新的权限或验收门。

本目录保存已选定方法的完整目录，包括必要 references、scripts、规则和资料。原宿主 Skills、全局配置及原插件缓存均未修改。此包不携带工具连接、认证、产品依赖或外部服务权限。

`index.json` 是独立资产索引：`skills` 以稳定名称索引，每项记录原来源 `origin`、版本、目录、文件字节数/摘要及依赖；`supportFiles` 记录必要共享参考资料。整体 `sha256` 由规范化后的 `{skills,supportFiles}` JSON 计算，单项 `source.sha256` 由该项 `files` JSON 计算。大部分文件保留选定来源字节；必要的便携性适配在下节说明，索引同时保留原始摘要和当前打包摘要。

## 便携性适配

Data 包只选择 `design-kpis`、其 index 与必要共享指导，不包含其他分析/报告/导出/表单运行时。原 index 和共享指导中的未打包链接已明确改为可选且未提供的路径；KPI 定义、证据、目标和校验方法完整保留，当前任务按其真实 artifact 合同交付，不因可选 Data app/Pages 流程缺失而停止。需要其他工作流时先发现真实能力，不能把该索引视作安装证明。

Figma 中真实存在的错误相对路径和过期标题锚点已修正；变量 API 使用的 `motion-easing.md` 作为单独支持文件补齐，没有导入 Motion/3D 工作流。未打包的可选 3D 流程明确标注。架构 Skill 的宿主来源本就缺少 `grill-with-docs` 格式参考，已改为保留项目现有 glossary/ADR 格式及其最小内容要求。

发生正文适配的 Skill 在 `source.originalFilesSha256` 和 `source.adaptations` 中保留原始文件集摘要、每个原始文件摘要及原因；每文件 `sha256` 和 `source.sha256` 始终描述实际打包内容。支持文件的适配使用 `originalSha256` 和 `adaptation`，新增支持文件记录原插件来源。这些改动只影响本任务的资产副本。

来源为任务已确认的本机 `openai-curated-remote` 缓存（各插件与版本见索引）、宿主 `~/.codex/skills`、`~/.agents/skills`，以及本项目原有 `assets/product-manager-coach`。索引 `directory` 对远端插件保留 `packages/<插件>/<版本>/skills/<原目录>` 布局；例如 Figma 同级 Skill 引用、Data `../../shared/` 和 Product Design `../../references/` 均继续可读。只打包明确选择的 Skills 及其必要支持文件，没有复制全部插件缓存。

方法需要的不同职责分别是：Chief 任务拆解/交付；Research 来源研究/官方文档/比较；PM 产品规格/KPI；Designer 交互审查/Figma；Architect 架构/规划；Frontend 按项目 stack 选择 React/shadcn 并做界面验证；Backend 回归/诊断及条件 Postgres；QA 独立验证；DevOps 交付/诊断/文档；Network 宿主网络诊断；Resources 磁盘分析/故障诊断。默认组合由 `bridge/role-capabilities.mjs` 定义，依赖不等于所有技能都在每次任务中加载。

## 安装与调用

由运行方把本目录作为只读包挂载，例如 `/opt/role-skill-packages`。`materializeRoleSkillBundle({codexHome,skillNames,assetRoot,packageRoot})` 先校验本包的每文件摘要，再只为当前角色所需 Skills 及依赖在 `CODEX_HOME/skills/` 创建入口符号链接；目标是相同只读包。`packageRoot` 是执行环境中的实际包根，默认等于 `assetRoot`。已有入口只在同一目标时复用，冲突明确失败，不覆盖其他 Skill。

原 Skills 中的链接相对于真实包内文件读取，不能把单个 `SKILL.md` 抽出或按 basename 重新拼装。Native Managed instruction bundle 只装该岗位 `AGENTS.md` 与 `CAPABILITIES.md`，本资产包不消耗其32份材料上限。

宿主文件存在不证明 Docker 内工具、Python、浏览器、Figma或其他Apps连接可用。`resolveRoleCapabilities` 返回逐项依赖状态，缺失依赖继续标记 `not-discovered` 或 `requires-host-transport`；不得把存在 Skill 包当业务执行通过。可选的其他插件工作流未打包时，按实际缺项处理，不调用其工具或自行安装。

Skills 提供方法，不授予新权限。当前可信任务、projectContext和已有授权决定可执行范围；已确认的选择与授权无需因通用 Skill 流程重复审批。外部写入、真实迁移、发布等动作仍以当前任务和项目允许的具体操作为准。

## 岗位说明来源

完整岗位正文由 `bridge/team-roles.mjs` 生成。专业职责和产物参考本机 `agency-agents` 的 Frontend Developer、Backend Architect、Software Architect、UX Architect、Product Manager、Reality Checker 与 DevOps Automator；保留本项目本人确认的11岗位、原键和汇报关系，没有导入其pipeline、固定问题数量、模型、重试次数或默认部署权限。
