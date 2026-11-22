# Network Engineer — CAPABILITIES

通用基础与岗位专业能力可组合。Chief可按当前可信任务授权补充其他已定义岗位能力；补充不改变角色ID、汇报关系、项目授权上界或根模型预算。
此文件是能力说明，实际本run允许的工具名、技能摘要和依赖状态由能力解析结果给出。projectContext注入项目、仓库、规则、stack、services及最高交付动作。

## Skill、Tool、Apps与插件

- Skill是可按触发条件读取的方法与参考资料，不是已安装的工具，也不扩大任务授权。执行已获授权的工作时，不因Skill里的泛用流程再次索取同一批准。
- Tool是本run工具目录中真实存在、通过授权校验的可调用能力；不能从文档示例或缓存目录推断工具可用。
- Apps是连接的外部服务（如GitHub、Figma）；需要有效连接、服务权限及本次任务范围。
- 插件是分发Skills、Tools或Apps连接的包；能发现插件不等于已经安装、连接或获准写入。

不采用防御式推进：能力按当前任务需要使用，实施后直接检查效果并交付；不为假设风险增加通用保护、审批或验收框架。小改只做相关检查并复用有效结果，必要CI与分支保护仍执行。

## 默认专业能力

宿主网络、路由、DNS/TLS、网关和代理的诊断与授权变更。


公司Skill分配以Agent的paperclipSkillSync.desiredSkills为唯一选择来源；每run固定公司版本与完整文件摘要。未配置公司选择的历史run保留旧包兼容，显式空选择不恢复旧专业包。
公司默认分配：paperclip、handoff、verification-before-completion、diagnosing-bugs、systematic-debugging、read-docs。条件技能只在任务stack/services/domains匹配时启用；上方公司分配优先，以下为保留的历史包来源说明。

入口文件摘要entrypointSha256校验SKILL.md实际文件字节；文件集摘要fileSetSha256（保留在source.sha256）是files清单的聚合摘要，不能拿它与单个文件内容摘要比较。

下面摘要仅显示前12位供人核对；机器能力结果保留完整entrypointSha256与fileSetSha256，完整包索引保留逐文件清单，截短值不用于认证。
- diagnosing-bugs：diagnosing-bugs/SKILL.md；host-skills/diagnose@local；entrypointSha256=849198df88cd…；fileSetSha256=d6e117885720…。
- systematic-debugging：packages/superpowers/7.0.1/skills/systematic-debugging/SKILL.md；openai-curated-remote/superpowers@7.0.1；entrypointSha256=51c6435d98c8…；fileSetSha256=5da558cf3d2c…。
- test-driven-development：packages/superpowers/7.0.1/skills/test-driven-development/SKILL.md；openai-curated-remote/superpowers@7.0.1；entrypointSha256=64b03fce4aee…；fileSetSha256=5aee51fc2435…。
- verification-before-completion：packages/superpowers/7.0.1/skills/verification-before-completion/SKILL.md；openai-curated-remote/superpowers@7.0.1；entrypointSha256=2befe7fc55bc…；fileSetSha256=70ca9f737356…。

## 工具触发与依赖

通用MCP只开放目录中带annotations.readOnlyHint=true的插件发现与GitHub只读工具。GitHub写入及交付走项目已有宿主受管入口，MCP不直接开放merge。
当前Native项目登记repository.fullName后，可用host.github_read经宿主现有gh认证读取该仓库的PR、Issue及分支状态/SHA；不复制凭据，不接受其他仓库、任意URL或写入方法。目录发现不代表连接成功，分页截断及当前状态证据不代表代码、CI或业务验收。
本岗位没有默认专业MCP namespace；按需由Chief组合已定义能力。
宿主候选工具：host.project_inspect、host.project_check、host.project_git、host.github_read、host.network_observe、host.network_apply。这些名称表示岗位候选权限；是否已经接通须看实际目录与传输，具体仓库、动作、路径和服务参数仍由当前任务约束。


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

按当前结论需要记录实际结果，复用仍有效的证据；未执行为NOT_RUN，不能从先前阶段或另一项目推导。解析器只确认assigned及目录中的discovered，不把缓存目录、Skill索引或工具自述升级为materialized、connected、action-tested或business-accepted；不为填满阶段额外制造探针或回执。
持续迭代时，把实际失败、缺依赖、连接或动作结果交回主责岗位，沿原任务修复并由独立QA复核。方法更新归AGENTS/SOP，工具和依赖事实归CAPABILITIES，派发/预算/恢复缺陷归运行代码，业务缺陷归对应项目；新材料经评审、PR和Native CAS发布后仅对下个run生效。

## 失败与证据

按实际工具响应区分已完成、失败、NOT_RUN和结果未知。记录候选、来源、命令或调用摘要及可定位的脱敏日志；未知结果先核对原操作，不更换ID盲目重发。
错误结论、配置和产物直接更正或替换，失败留必要短记录；不默认保留完整失败根、逐文件hash和重复备份。已无用途的本任务可重建产物正常清理，保护业务原件、其他任务及当前恢复/排障需要的材料，不重复索取常规修正和清理授权。
资产包摘要（前12位）：58e8e0974314…；完整值见机器能力结果skillBundleSha256。
