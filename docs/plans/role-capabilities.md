# 11角色专业能力与跨项目执行

## 已确认目标

本人于2026-11-20确认：岗位说明、真实能力、跨项目和现有Mac宿主执行一起完善。采用通用基础能力、各岗默认专业组合、Chief随任务补充；普通已授权动作自主完成。保留11角色身份、汇报关系、模型、预算、原任务/会话及材料历史。

RWB特定边界移至对应项目上下文。通用岗位正文解释目标、输入、职责、协作、方法、技能和工具触发、交付物及完成/失败标准。专业方法参考既有Skill和agency-agents职责素材，任务/运行控制仍由Paperclip负责。

## 2026-11-22职责与执行方式修订

现役Architect只读核对为idle，实际选择的paperclip、handoff、verification-before-completion、codebase-design、domain-modeling、improve-codebase-architecture、writing-plans、security-threat-model共8项均compatible且有当前版本；AGENTS/CAPABILITIES与已部署模板一致。这证明分配与材料状态，不证明所有工具已连接或业务验收通过。本次复用已有方法，不安装重复Skill。

生成源补强Architect的技术选型与可执行规格：Research检索证据，Architect基于代码和项目约束比较必要方案、作出取舍，并按PM目标交接接口、数据、错误/权限、负责人和可观察验收。任务相关时才展开迁移回滚等细节；专业分工见[团队职责](../team.md)，不把架构岗变成所有专业工具的重复执行者。

所有岗位通用SOP明确“不采用防御式推进”：实现后直接检查效果并交付，小改做相关检查、复用有效结果；错误直接修正、失败留短记录，本任务无用可重建产物正常清理。真实业务权限与必要CI保持，不新增通用兜底、保护层、审批或验收框架。源码生成材料同步后通过既有发布入口更新，仅下个run使用；Doc/QA人工定制需局部更新，不用模板整体覆盖。本次只检查相关角色/能力合同与生成一致性，不为材料修订制造模型探针；真实选型和规格效果由后续业务任务检验。

## 实施合同

1. `role-capabilities`是岗位默认、任务补充和实际工具目录的同一能力事实。Skill是方法包，Tools是可调用函数，Apps/插件是连接与能力包。工具发现只展示当前允许的能力；缺依赖/连接如实显示。
2. Native project/workspace提供projectContext：项目、源仓库、任务隔离代码工作树、项目规则入口、已登记checks/交付命令及宿主服务。角色材料与项目知识分开。本人明确项目优先，其次当前/父任务项目，有歧义才询问。
3. 模型artifact cwd保留Native项目默认目录；代码工作树额外挂载到`/workspace/project`。Git/check/publish经现有宿主传输执行，不把宿主HOME、Git认证或Docker socket交给模型。
4. provider broker按同一岗位/任务能力过滤MCP目录及调用，GitHub绑定目标仓库。宿主能力通过本run既有transport中的host-calls传递；实际执行只接受当前Native许可、已登记项目命令/动作及选定本地MCP。凭据仍留原连接或宿主。
5. Skills以带来源和文件摘要的项目能力包提供，只读挂载；保留包内引用，不将大量Skill正文塞入AGENTS。Managed指令包保留可读AGENTS/CAPABILITIES，保存继续同步摘要和历史。
6. 工作候选由实际Git操作记录；QA绑定该候选并独立运行，发布仅接受Native QA记录及当前真实HEAD，使用项目原受管交付入口和允许动作。

## 实施与验收

- [x] 11角色职业说明、能力矩阵、完整Skill包及依赖索引。
- [x] 跨项目解析、Native派发/知识作用域、能力及候选绑定的源码实现与回归。
- [x] broker目录过滤、实际调用与宿主Git/check/MCP接线的源码实现与合同验证。
- [x] 正常保存/冲突恢复/旧历史、Native工作副本回归。
- [ ] 两个不同项目的上下文/工作区/规则/check实测；选定专业能力的实际通路测试。
- [ ] 现有测试、精确候选独立评审及PR/CI，再更新专用运行候选并保留原记录。

源码检查为478/478、文档288份零错误；实际安装版Native workspace与CLI MCP配置合同通过。真实运行切换和跨项目业务任务仍按上方待办独立记录。

全局AGENTS与leon-engineering同步为独立委托，等待另一个窗口的统一候选和hash；不修改本项目固定工程运行时。宿主重启和其他运行项目不属于角色能力更新动作。
