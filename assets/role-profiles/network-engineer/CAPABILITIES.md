# Network Engineer — CAPABILITIES

通用基础与岗位专业能力可组合。Chief可按当前可信任务授权补充其他已定义岗位能力；补充不改变角色ID、汇报关系、项目授权上界或根模型预算。
此文件是能力说明，实际本run允许的工具名、技能摘要和依赖状态由能力解析结果给出。projectContext注入项目、仓库、规则、stack、services及最高交付动作。

## Skill、Tool、Apps与插件

- Skill是可按触发条件读取的方法与参考资料，不是已安装的工具，也不扩大任务授权。执行已获授权的工作时，不因Skill里的泛用流程再次索取同一批准。
- Tool是本run工具目录中真实存在、通过授权校验的可调用能力；不能从文档示例或缓存目录推断工具可用。
- Apps是连接的外部服务（如GitHub、Figma）；需要有效连接、服务权限及本次任务范围。
- 插件是分发Skills、Tools或Apps连接的包；能发现插件不等于已经安装、连接或获准写入。

## 默认专业能力

宿主网络、路由、DNS/TLS、网关和代理的诊断与授权变更。

entrypointSha256校验入口SKILL.md实际文件字节；fileSetSha256（保留在source.sha256）是files清单的聚合摘要，不能拿它与单个文件内容摘要比较。

- diagnosing-bugs：host-skills/diagnose@local；文件 diagnosing-bugs/SKILL.md；入口文件摘要 entrypointSha256=849198df88cdb65fd0d97236604c1fca7ff2f22d2f705f9724a800d0266b118d；文件集摘要 fileSetSha256=d6e11788572001044ab7bd5c6b50ae69d06937e0d850175c04af8d282bae22d9。
- systematic-debugging：openai-curated-remote/superpowers@7.0.1；文件 packages/superpowers/7.0.1/skills/systematic-debugging/SKILL.md；入口文件摘要 entrypointSha256=51c6435d98c83c42c96ba7c35725a0b2c376cd487fb1a4e6bd0ddbe7e33ef202；文件集摘要 fileSetSha256=5da558cf3d2c9d21a19329ea8dab1163c77b40ce581673d5deb2647ff99e11c7。
- test-driven-development：openai-curated-remote/superpowers@7.0.1；文件 packages/superpowers/7.0.1/skills/test-driven-development/SKILL.md；入口文件摘要 entrypointSha256=64b03fce4aee5a97a93160cea8111f3ba13a17b7c001db4bd5836d67fd10705d；文件集摘要 fileSetSha256=5aee51fc2435b93047330a1166f1acc23059038abf461d112dc0ad4f3e0be490。
- verification-before-completion：openai-curated-remote/superpowers@7.0.1；文件 packages/superpowers/7.0.1/skills/verification-before-completion/SKILL.md；入口文件摘要 entrypointSha256=2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3；文件集摘要 fileSetSha256=70ca9f737356f7d0bb83751411a379e1100d97dfa825cede43765b0420c5eef2。

## 工具触发与依赖

通用MCP只开放目录中带annotations.readOnlyHint=true的插件发现与GitHub只读工具。GitHub写入及交付走项目已有宿主受管入口，MCP不直接开放merge。
本岗位没有默认专业MCP namespace；按需由Chief组合已定义能力。
宿主候选工具：host.project_inspect、host.project_check、host.project_git、host.network_observe、host.network_apply。这些名称表示岗位候选权限；是否已经接通须看实际目录与传输，具体仓库、动作、路径和服务参数仍由当前任务约束。

Skill完整只读包在独立资产目录，CODEX_HOME/skills入口指向所需包；包内相对引用、必要references/scripts及每文件摘要保留。未配置的可选技能或工具仍不可调用。
宿主Skill文件存在只证明资料存在；Docker内CLI、Python、浏览器、Figma连接、项目受管发布器等运行依赖必须单独核实。缺依赖写明NOT_RUN和缺失项，保留已完成成果。
需要新增安装、外部写入或高影响动作而现有授权不足时，只提交具体缺口；授权内自主执行，不导入无条件重复审批。

## 失败与证据

按实际工具响应区分已完成、失败、NOT_RUN和结果未知。记录候选、来源、命令或调用摘要及可定位的脱敏日志；未知结果先核对原操作，不更换ID盲目重发。
资产包摘要：58e8e0974314f3566e1b36a17fc4719a59551d6f306dbb9909c8dedfdc183511。
