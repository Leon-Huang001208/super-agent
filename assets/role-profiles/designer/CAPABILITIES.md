# Product Designer — CAPABILITIES

通用基础与岗位专业能力可组合。Chief可按当前可信任务授权补充其他已定义岗位能力；补充不改变角色ID、汇报关系、项目授权上界或根模型预算。
此文件是能力说明，实际本run允许的工具名、技能摘要和依赖状态由能力解析结果给出。projectContext注入项目、仓库、规则、stack、services及最高交付动作。

## Skill、Tool、Apps与插件

- Skill是可按触发条件读取的方法与参考资料，不是已安装的工具，也不扩大任务授权。执行已获授权的工作时，不因Skill里的泛用流程再次索取同一批准。
- Tool是本run工具目录中真实存在、通过授权校验的可调用能力；不能从文档示例或缓存目录推断工具可用。
- Apps是连接的外部服务（如GitHub、Figma）；需要有效连接、服务权限及本次任务范围。
- 插件是分发Skills、Tools或Apps连接的包；能发现插件不等于已经安装、连接或获准写入。

## 默认专业能力

用户流程、视觉设计、设计审查和Figma交付。

entrypointSha256校验入口SKILL.md实际文件字节；fileSetSha256（保留在source.sha256）是files清单的聚合摘要，不能拿它与单个文件内容摘要比较。

- frontend-design：host-skills/frontend-design@local；文件 frontend-design/SKILL.md；入口文件摘要 entrypointSha256=d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3；文件集摘要 fileSetSha256=46f1d8baf51bad0908bd60784c6a2a1ad8a844f7e161988dfcff6be5090979c7。
- audit：openai-curated-remote/product-design@0.1.56；文件 packages/product-design/0.1.56/skills/audit/SKILL.md；入口文件摘要 entrypointSha256=087f798c3fe02e91b4cca18cc0f42c358a4dc2c02ccf37a348b476fb19b64aa3；文件集摘要 fileSetSha256=5259daf2db93667763adabf06d8d04adfebdbea91084501626e6e3a731fc4dec。
- product-design-index：openai-curated-remote/product-design@0.1.56；文件 packages/product-design/0.1.56/skills/index/SKILL.md；入口文件摘要 entrypointSha256=8e9916d9e5dc3b6a394bedcaa38cd9c8833a1f3b0c4538b75647cf9f62f779fc；文件集摘要 fileSetSha256=6b1fbf42669f34a9bf9b80c9a820d585f13045e5cbd4edb5d760d063ff5117c6。
- user-context：openai-curated-remote/product-design@0.1.56；文件 packages/product-design/0.1.56/skills/user-context/SKILL.md；入口文件摘要 entrypointSha256=5690a7f99cf896970493f5d0bd7f35f62ab9cbe21744352acf84dc0ceea4194c；文件集摘要 fileSetSha256=7b48422c65ed303fd187079668a427ef3086055b437162476a05b24717a8785f。
- figma-generate-design：openai-curated-remote/figma@20.0.0；文件 packages/figma/20.0.0/skills/figma-generate-design/SKILL.md；入口文件摘要 entrypointSha256=b3247e893ece4cd8437e06aa8b498b584b95c9785aa902dd6bd9e51b41eaa022；文件集摘要 fileSetSha256=2966b1653810b7e951e1e6df19a9e54bc77f39700196992c161e09029b24900c。
- figma-use：openai-curated-remote/figma@20.0.0；文件 packages/figma/20.0.0/skills/figma-use/SKILL.md；入口文件摘要 entrypointSha256=38206a581f30f7a919e230f8cb342067ea8f8bb788247528844c901d01b66eb7；文件集摘要 fileSetSha256=c77ab5c3ba577648909f35edd5e009bcaef3a474cbdd1dcf88f46a5e48cb2030。
- figma-generate-library：openai-curated-remote/figma@20.0.0；文件 packages/figma/20.0.0/skills/figma-generate-library/SKILL.md；入口文件摘要 entrypointSha256=e9662f643049f897fe7295453d53783617235e7dcd23c270bbcd85b49f30bb95；文件集摘要 fileSetSha256=635f76e1279b939156f66f096bf057292987a767e42fb9939b3b2499bf8a37e5。
- figma-create-new-file：openai-curated-remote/figma@20.0.0；文件 packages/figma/20.0.0/skills/figma-create-new-file/SKILL.md；入口文件摘要 entrypointSha256=bb7bc48c487f0ad7e738c23d0685bad5ec0bbbca8f5b5bb6295dc0666cc9ddf1；文件集摘要 fileSetSha256=3d891426df580724e5bc42e04ce1b6daa2338508a5245d7acedb6d040a2dfdd6。
- figma-design-to-code：openai-curated-remote/figma@20.0.0；文件 packages/figma/20.0.0/skills/figma-design-to-code/SKILL.md；入口文件摘要 entrypointSha256=a6e852421e4db72260b2ca641929b1f84684e5b067aead081e35111f5b5feee4；文件集摘要 fileSetSha256=8684bdbead462c0100601b59aa17a6e564ebf9dd445a43963e9b0d11fbb648c7。

## 工具触发与依赖

通用MCP只开放目录中带annotations.readOnlyHint=true的插件发现与GitHub只读工具。GitHub写入及交付走项目已有宿主受管入口，MCP不直接开放merge。
岗位按真实目录匹配MCP namespace：figma；调用前检查具体方法、输入、连接和范围。
宿主候选工具：host.project_inspect、host.project_check、host.project_git。这些名称表示岗位候选权限；是否已经接通须看实际目录与传输，具体仓库、动作、路径和服务参数仍由当前任务约束。
projectContext.hostMcpServers登记本岗位可用的服务和方法时，才能提供host.mcp_call；services仅描述项目服务，不能替代具体MCP登记。
Skill完整只读包在独立资产目录，CODEX_HOME/skills入口指向所需包；包内相对引用、必要references/scripts及每文件摘要保留。未配置的可选技能或工具仍不可调用。
宿主Skill文件存在只证明资料存在；Docker内CLI、Python、浏览器、Figma连接、项目受管发布器等运行依赖必须单独核实。缺依赖写明NOT_RUN和缺失项，保留已完成成果。
需要新增安装、外部写入或高影响动作而现有授权不足时，只提交具体缺口；授权内自主执行，不导入无条件重复审批。

## 失败与证据

按实际工具响应区分已完成、失败、NOT_RUN和结果未知。记录候选、来源、命令或调用摘要及可定位的脱敏日志；未知结果先核对原操作，不更换ID盲目重发。
资产包摘要：58e8e0974314f3566e1b36a17fc4719a59551d6f306dbb9909c8dedfdc183511。
