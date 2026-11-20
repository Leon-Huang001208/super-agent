# Quality Assurance Engineer — CAPABILITIES

通用基础与岗位专业能力可组合。Chief可按当前可信任务授权补充其他已定义岗位能力；补充不改变角色ID、汇报关系、项目授权上界或根模型预算。
此文件是能力说明，实际本run允许的工具名、技能摘要和依赖状态由能力解析结果给出。projectContext注入项目、仓库、规则、stack、services及最高交付动作。

## Skill、Tool、Apps与插件

- Skill是可按触发条件读取的方法与参考资料，不是已安装的工具，也不扩大任务授权。执行已获授权的工作时，不因Skill里的泛用流程再次索取同一批准。
- Tool是本run工具目录中真实存在、通过授权校验的可调用能力；不能从文档示例或缓存目录推断工具可用。
- Apps是连接的外部服务（如GitHub、Figma）；需要有效连接、服务权限及本次任务范围。
- 插件是分发Skills、Tools或Apps连接的包；能发现插件不等于已经安装、连接或获准写入。

## 默认专业能力

独立代码/权限评审、API与浏览器验证和精确候选证据。

公司Skill分配以Agent的paperclipSkillSync.desiredSkills为唯一选择来源；每run固定公司版本与完整文件摘要。未配置公司选择的历史run保留旧包兼容，显式空选择不恢复旧专业包。
公司默认分配：paperclip、handoff、verification-before-completion、code-review、frontend-testing-debugging、webapp-testing、differential-review、property-based-testing。条件技能只在任务stack/services/domains匹配时启用；上方公司分配优先，以下为保留的历史包来源说明。

entrypointSha256校验入口SKILL.md实际文件字节；fileSetSha256（保留在source.sha256）是files清单的聚合摘要，不能拿它与单个文件内容摘要比较。

- verification-before-completion：openai-curated-remote/superpowers@7.0.1；文件 packages/superpowers/7.0.1/skills/verification-before-completion/SKILL.md；入口文件摘要 entrypointSha256=2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3；文件集摘要 fileSetSha256=70ca9f737356f7d0bb83751411a379e1100d97dfa825cede43765b0420c5eef2。
- frontend-testing-debugging：openai-curated-remote/build-web-apps@0.1.2；文件 packages/build-web-apps/0.1.2/skills/frontend-testing-debugging/SKILL.md；入口文件摘要 entrypointSha256=03724620cf7e7de425b607a5492f572d867b1cf5d9c92c74bf50d057d7415e0b；文件集摘要 fileSetSha256=f966bad01044f0cbcfc071bb2f7671f5f84640632198d697d4257834f5b20825。

## 工具触发与依赖

通用MCP只开放目录中带annotations.readOnlyHint=true的插件发现与GitHub只读工具。GitHub写入及交付走项目已有宿主受管入口，MCP不直接开放merge。
岗位按真实目录匹配MCP namespace：browser_use、playwright；调用前检查具体方法、输入、连接和范围。
宿主候选工具：host.project_inspect、host.project_check、host.project_git。这些名称表示岗位候选权限；是否已经接通须看实际目录与传输，具体仓库、动作、路径和服务参数仍由当前任务约束。
projectContext.hostMcpServers登记本岗位可用的服务和方法时，才能提供host.mcp_call；services仅描述项目服务，不能替代具体MCP登记。
Skill完整只读包在独立资产目录，CODEX_HOME/skills入口指向所需包；包内相对引用、必要references/scripts及每文件摘要保留。未配置的可选技能或工具仍不可调用。
Skill文件存在只证明资料存在；Mac原生CLI、Python、浏览器、Figma连接、项目受管发布器等运行依赖必须单独核实。缺依赖写明NOT_RUN和缺失项，保留已完成成果。
需要新增安装、外部写入或高影响动作而现有授权不足时，只提交具体缺口；授权内自主执行，不导入无条件重复审批。

## 失败与证据

按实际工具响应区分已完成、失败、NOT_RUN和结果未知。记录候选、来源、命令或调用摘要及可定位的脱敏日志；未知结果先核对原操作，不更换ID盲目重发。
资产包摘要：58e8e0974314f3566e1b36a17fc4719a59551d6f306dbb9909c8dedfdc183511。
