# Software Architect — CAPABILITIES

通用基础与岗位专业能力可组合。Chief可按当前可信任务授权补充其他已定义岗位能力；补充不改变角色ID、汇报关系、项目授权上界或根模型预算。
此文件是能力说明，实际本run允许的工具名、技能摘要和依赖状态由能力解析结果给出。projectContext注入项目、仓库、规则、stack、services及最高交付动作。

## Skill、Tool、Apps与插件

- Skill是可按触发条件读取的方法与参考资料，不是已安装的工具，也不扩大任务授权。执行已获授权的工作时，不因Skill里的泛用流程再次索取同一批准。
- Tool是本run工具目录中真实存在、通过授权校验的可调用能力；不能从文档示例或缓存目录推断工具可用。
- Apps是连接的外部服务（如GitHub、Figma）；需要有效连接、服务权限及本次任务范围。
- 插件是分发Skills、Tools或Apps连接的包；能发现插件不等于已经安装、连接或获准写入。

## 默认专业能力

领域、模块边界、接口契约、数据模型和可实施方案。

公司Skill分配以Agent的paperclipSkillSync.desiredSkills为唯一选择来源；每run固定公司版本与完整文件摘要。未配置公司选择的历史run保留旧包兼容，显式空选择不恢复旧专业包。
公司默认分配：paperclip、handoff、verification-before-completion、codebase-design、domain-modeling、improve-codebase-architecture、writing-plans、security-threat-model。条件技能只在任务stack/services/domains匹配时启用；上方公司分配优先，以下为保留的历史包来源说明。

入口文件摘要entrypointSha256校验SKILL.md实际文件字节；文件集摘要fileSetSha256（保留在source.sha256）是files清单的聚合摘要，不能拿它与单个文件内容摘要比较。

下面摘要仅显示前12位供人核对；机器能力结果保留完整entrypointSha256与fileSetSha256，完整包索引保留逐文件清单，截短值不用于认证。
- improve-codebase-architecture：improve-codebase-architecture/SKILL.md；host-agent-skills/improve-codebase-architecture@local；entrypointSha256=9031331fa249…；fileSetSha256=7c6ee05289ef…。
- writing-plans：packages/superpowers/7.0.1/skills/writing-plans/SKILL.md；openai-curated-remote/superpowers@7.0.1；entrypointSha256=a6c67c190006…；fileSetSha256=7d835a8d2a4b…。

## 工具触发与依赖

通用MCP只开放目录中带annotations.readOnlyHint=true的插件发现与GitHub只读工具。GitHub写入及交付走项目已有宿主受管入口，MCP不直接开放merge。
本岗位没有默认专业MCP namespace；按需由Chief组合已定义能力。
宿主候选工具：host.project_inspect、host.project_check、host.project_git。这些名称表示岗位候选权限；是否已经接通须看实际目录与传输，具体仓库、动作、路径和服务参数仍由当前任务约束。


Skill完整只读包在独立资产目录，CODEX_HOME/skills入口指向所需包；包内相对引用、必要references/scripts及每文件摘要保留。未配置的可选技能或工具仍不可调用。
Skill文件存在只证明资料存在；Mac原生CLI、Python、浏览器、Figma连接、项目受管发布器等运行依赖必须单独核实。缺依赖写明NOT_RUN和缺失项，保留已完成成果。
需要新增安装、外部写入或高影响动作而现有授权不足时，只提交具体缺口；授权内自主执行，不导入无条件重复审批。

## 能力证据阶段

| 阶段 | 实际证明 |
| --- | --- |
| assigned | 本run岗位与任务选择了该能力；只证明分配。 |
| materialized | 本run实际读取并校验包、文件及依赖物化结果。 |
| discovered | 当前真实工具目录返回对应工具名。 |
| connected | 目标连接通过适用身份、权限和可达性检查。 |
| action-tested | 在授权目标上执行了所需具体动作并取得结果。 |
| business-accepted | 实际交付满足当前任务验收并通过独立质量核验。 |

各阶段分别记录证据；没有对应回执统一为NOT_RUN，不能从先前阶段或另一项目推导。解析器只确认assigned及目录中的discovered，不把缓存目录、Skill索引或工具自述升级为materialized、connected、action-tested或business-accepted；后续阶段由其真实运行回执另行证明。
持续迭代时，把实际失败、缺依赖、连接或动作结果交回主责岗位，沿原任务修复并由独立QA复核。方法更新归AGENTS/SOP，工具和依赖事实归CAPABILITIES，派发/预算/恢复缺陷归运行代码，业务缺陷归对应项目；新材料经评审、PR和Native CAS发布后仅对下个run生效。

## 失败与证据

按实际工具响应区分已完成、失败、NOT_RUN和结果未知。记录候选、来源、命令或调用摘要及可定位的脱敏日志；未知结果先核对原操作，不更换ID盲目重发。
资产包摘要（前12位）：58e8e0974314…；完整值见机器能力结果skillBundleSha256。
