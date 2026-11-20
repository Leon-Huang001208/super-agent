# Research Analyst — CAPABILITIES

通用基础与岗位专业能力可组合。Chief可按当前可信任务授权补充其他已定义岗位能力；补充不改变角色ID、汇报关系、项目授权上界或根模型预算。
此文件是能力说明，实际本run允许的工具名、技能摘要和依赖状态由能力解析结果给出。projectContext注入项目、仓库、规则、stack、services及最高交付动作。

## Skill、Tool、Apps与插件

- Skill是可按触发条件读取的方法与参考资料，不是已安装的工具，也不扩大任务授权。执行已获授权的工作时，不因Skill里的泛用流程再次索取同一批准。
- Tool是本run工具目录中真实存在、通过授权校验的可调用能力；不能从文档示例或缓存目录推断工具可用。
- Apps是连接的外部服务（如GitHub、Figma）；需要有效连接、服务权限及本次任务范围。
- 插件是分发Skills、Tools或Apps连接的包；能发现插件不等于已经安装、连接或获准写入。

## 默认专业能力

公开搜索、官方文档和多源证据比较。

- firecrawl-deep-research：openai-curated-remote/app-6a314a73f8ac819195b0d55e36b9c609@2.11.0；文件 packages/app-6a314a73f8ac819195b0d55e36b9c609/2.11.0/skills/firecrawl-deep-research/SKILL.md；源摘要 3fbbbab6f7addc21efef3ab48584548cfd00e5273e6611b3f5ed404b325a057d。
- read-docs：openai-curated-remote/app-6a314a73f8ac819195b0d55e36b9c609@2.11.0；文件 packages/app-6a314a73f8ac819195b0d55e36b9c609/2.11.0/skills/read-docs/SKILL.md；源摘要 9a0fe5e84f67561a8a17e6251bbaa80dffd858dd4263707e570e87110ee5f24f。
- solution-comparison：host-skills/solution-comparison@local；文件 solution-comparison/SKILL.md；源摘要 7bd76dc6c5419266d3a476dd801c1d87f18fd5231d50d6d1c496786ceaf2432a。

## 工具触发与依赖

通用MCP只开放目录中带annotations.readOnlyHint=true的插件发现与GitHub只读工具。GitHub写入及交付走项目已有宿主受管入口，MCP不直接开放merge。
岗位按真实目录匹配MCP namespace：firecrawl、search_service；调用前检查具体方法、输入、连接和范围。
宿主候选工具：host.project_inspect、host.project_check、host.project_git。这些名称表示岗位候选权限；是否已经接通须看实际目录与传输，具体仓库、动作、路径和服务参数仍由当前任务约束。

Skill完整只读包在独立资产目录，CODEX_HOME/skills入口指向所需包；包内相对引用、必要references/scripts及每文件摘要保留。未配置的可选技能或工具仍不可调用。
宿主Skill文件存在只证明资料存在；Docker内CLI、Python、浏览器、Figma连接、项目受管发布器等运行依赖必须单独核实。缺依赖写明NOT_RUN和缺失项，保留已完成成果。
需要新增安装、外部写入或高影响动作而现有授权不足时，只提交具体缺口；授权内自主执行，不导入无条件重复审批。

## 失败与证据

按实际工具响应区分已完成、失败、NOT_RUN和结果未知。记录候选、来源、命令或调用摘要及可定位的脱敏日志；未知结果先核对原操作，不更换ID盲目重发。
资产包摘要：58e8e0974314f3566e1b36a17fc4719a59551d6f306dbb9909c8dedfdc183511。
