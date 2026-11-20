# 跨项目、续接与记忆 M2

`host.github_read`只读Native登记的repository.fullName，可在hostPath为空时使用；read_only项目保留该只读工具，代码路径、发布和服务动作继续收窄。原任务质量预算阻断后的显式owner续接见[运维入口](operations.md#github只读通道与原质量任务续接)，不改变输入版本、项目边界或原累计调用。

原任务调用分档沿`task-call-policy.mjs`统一计算：默认6次，已授权且可信控制面登记的复杂原任务12次。补充、继续、重规划、QA返修和Native失败重试均保留原预算文件；提示或输入正文不能改变上限。`scripts/task-call-budget.mjs --task-id <原root> --approval-source <已有授权来源>`默认只预览，`--apply`要求现有Owner会话、关闭派发且无在途run/call锁；不新建目标、不运行模型、不退款。原有第七次QA专项仍独立绑定其历史证据，不转为普遍额度。

Mac原生与公司Skill的当次运行快照见[当前合同](plans/native-skills-20261120.md)。项目stack/services及domains用于按需选择已分配技能；它们只描述技术或业务领域，不能授予额外操作权限。旧项目catalog的动作上界和历史任务保持原约束。

## 范围与当前证据

M2复用唯一的本人飞书 `/chief` 入口、Paperclip Native事务/activity与现有11角色，不增加调度器、任务库、数据库schema、依赖或第二条长连接。项目选择和owner输入以Native为准，部署catalog只缩小允许项目、workspace、角色和动作范围。

M2关联由真实Native control及显式`operation.contextVersion=1`共同识别；全局开关不会把旧RWB primary或第三项目的普通Native任务强收进catalog。无M2关联沿原portable路径，有畸形M2标记或Native/operation关联不一致则拒绝降级。

2026-11-20首轮**本地Docker**回归为515/515，零失败/跳过，见私有`logs/m2-full-first.log`及同名receipt。该轮未包含后加的`context-configure`，不是最终候选总数，也不是Mini或真实模型证据。**Mini配置apply、M2激活、本人飞书多轮/冷启动记忆和跨项目真实业务均为NOT_RUN**。合入后续通用角色能力/Managed指令合同的组合候选仍须单独验证。

## 飞书命令

以下为启用M2后的命令合同。`--project <key或别名>`放在动词之前；未指定时使用该本人会话中持久选择的项目。切换项目恢复该项目原已选择的任务；新建或成功执行add/pause/continue后保存任务选择。显式`status <任务号>`只查询该任务，不暗中切换当前任务。

| 命令示例 | 行为 |
| --- | --- |
| `/chief projects` | 列出已注册项目，不建任务、不调用模型。 |
| `/chief project rwb` | 持久选择项目，恢复其所选任务；不唤醒模型。 |
| `/chief status`、`/chief status LEO-28` | 查询所选或指定Native任务及待应用补充。 |
| `/chief new 梳理本次需求` | 在当前项目创建新目标；`/chief <目标>`仍可用，目标首词碰到命令时使用new。 |
| `/chief --project rwb new 梳理本次需求` | 显式绑定注册项目，不能通过正文指定任意路径/权限。 |
| `/chief add LEO-28 补充验收要求` | 记录同根补充并暂停后续派发，旧运行终态明确后应用新输入版本；可不写任务号使用所选任务。 |
| `/chief pause LEO-28` | 暂停后续派发，保留在途运行、原操作和累计预算。 |
| `/chief continue LEO-28` | 继续原根；同版本未完成计划直接复用，新输入按最新要求重建计划。未知结果先对账。 |
| `/chief followup LEO-28 整理下一项独立目标` | 仅对done根的明确新目标创建关联新根，记录前驱而不用parentId。失败、修正及UNKNOWN不借此重置预算。 |
| `/chief --plan-first new 先形成计划` | 本人可选的一次计划后暂停；收到计划后用continue继续，不要求复制64位SHA。 |

中文别名包括项目列表/项目/状态/补充/暂停/继续/后续/新建。普通目标默认直接按既有授权执行，不增加计划审阅门；选择plan-first后补充再continue也不会为新计划重复加门。原项目正式发布权限仍按原合同核对。

## 同根续接与预算

同一根的Chief计划、子任务、QA和汇总共用原六次角色外层调用额度；补充、暂停、重启、输入改版及新session均不清零。先核对已登记dispatch/run，再判断新调用额度，不能因缺少本地回执换operation重发。UNKNOWN只沿原operation核对。

add先持久保存pending输入。在途run未明确终态前不改其绑定输入；provider启动前与pending应用共用Native根的短事务守卫，模型执行在事务外。输入变化后保留旧flow、计划、summary和原SHA，新代际产物名含稳定operation/run关联，不覆盖同hash的旧文件。

同任务继续使用全新模型session，从原Native授权输入和已绑定产物重建上下文，不伪造provider/session/lease身份。普通暂停且同版本仍有计划时不多起一次计划调用；已收尾的blocked阶段收到未消费continue时，先对账原操作，仅明确无在途/未知结果且至少剩余三次调用才新规划。额度不足明确停住，不花最后槽或重发旧summary。done旧根及其六次账本保留，followup新根不冒充旧根子任务。

## 项目绑定与执行材料

部署配置为`registry.context={schemaVersion:1,enabled:true,catalog,materials,legacyKnowledge}`。catalog把key/别名映射到已存在的company/owner/project、规范workspace和可选`projectWorkspaceId`；配置ID时Native task必须严格匹配。个人项目原本没有workspace行时保留implicit默认方式。flow/operation/child/permit均保存同一项目绑定，不改Agent全局ID或`registry.team.projectId`。

M2新任务使用规范Native项目cwd。RWB如需workspace，仅创建/复用专用non-primary项；旧primary、`/workspaces/rwb-pilot`、callback、旧任务与历史保持原归属，M2不恢复旧执行队列。旧任务可按Native元数据查状态，不因此获得M2执行权。

`materials[projectId][role]`登记完整作用域manifest。原岗位/Skill来源摘要继续校验，项目共享引用另行登记；跨项目复用旧manifest必须显式`scope:'generic'`，不把旧项目私有资料带入新项目。通用岗位能力、完整Skill包、Managed指令工作副本及项目交付仍沿原合同，不用M2配置覆盖它们。

初次generic分类须完整核对公开岗位、CAPABILITIES及所需公共资产；以后本人经Native认证保存的全局role指令继承generic语义。执行以当次Native prepared copy为主，项目overlay只装载项目事实/PM公共引用；配置时复制的旧AGENTS/CAPABILITIES仅供来源对账，不再作为现役指令重喂。来源可沿同Agent已保全的generic材料历史核对，旧run继续固定原副本。

最终能力取Native项目与catalog动作上限交集。`read_only`映射artifact，去除宿主代码写入路径、checks、写动作和未证明只读的MCP；broker工具目录同时取本run静态准入、动态岗位发现和实际readOnlyHint交集。不能因Native metadata已有host repo或动作ID提高M2权限，完整Skill方法包仍可读取。

每run固定只读materialSnapshot，将company/owner/project/projectKey/role/run及manifest摘要与permit绑定，只投射本次材料，不挂整个materials根。HOME与材料目录没有可写别名；其他项目/角色私有文件、宿主HOME、Docker socket和App数据库秘密不进入模型容器。日志仅保存ID、版本、摘要与来源引用，不保存完整prompt或知识正文。实际Skill读取及工具调用仍需原始执行证据，材料存在不能替代调用成功。

## 本人确认记忆

默认记忆是**当前项目共享**；`--role pm`等合法角色键写入该项目的角色私有分区。只有真实本人来源的remember/correct/share才产生确认；模型总结、历史导入或查询不自动确认。

| 命令示例 | 行为 |
| --- | --- |
| `/chief remember 报告规范 先结论，再列证据` | 当前项目创建确认版本1，来源绑定本人消息。 |
| `/chief remember --role pm 验收要求 区分真实数据和示例` | 仅当前项目PM私有。 |
| `/chief memory 报告规范` | 查看当前版本；无key时查询当前项目记忆。 |
| `/chief correct --version 1 报告规范 先结论，保留未验证项` | 在期望版本上追加更正，保留旧版本；省略version时在Native意图内绑定当时版本。 |
| `/chief memory-history 报告规范` | 查看版本及来源历史；角色私有查询同样加`--role`。 |
| `/chief share 报告规范 rwb` | 本人显式把当前项目共享记录复制到目标注册项目，保留原版本/摘要和分享来源；不自动共享私有分区。 |

新任务/新session先按company/owner/project和本角色隔离，再取当前owner-confirmed版本，最多检索32条，不注入其他任务对话历史或预填旧答案。进行中的run保留已固定版本，后续任务读取更正版本。query未入选不代表记录不存在：旧legacy补入前另查该授权分区身份history，已有任何确认记录便不退回旧值。

新知识根为`/paperclip/control/research-pm/context/knowledge`。`legacyKnowledge[projectId][role]`仅指向`context/legacy`下带SHA的只读授权投影，逐条验证项目/visibility/role并标historical-reference；M2不读全局旧knowledge.json，也不把历史记录伪称为本人确认。原全局文件仅保留给旧M1路径。记忆内容本身不授予工具权限或替代Native任务状态。

## 配置预览与应用

配置工具在既有受控运行环境中执行，默认preview零配置写入。部署请求文件示意（真实ID由私有配置提供）：

```json
{
  "schemaVersion": 1,
  "operationId": "<稳定UUID>",
  "defaultProjectKey": "personal",
  "projects": [
    {"key": "personal", "projectId": "<Native项目UUID>", "aliases": ["个人"], "maximumAction": "read_only"},
    {"key": "rwb", "projectId": "<Native项目UUID>", "aliases": [], "maximumAction": "read_only"}
  ]
}
```

```sh
node /opt/super-agent/role/scripts/context-configure.mjs --request /paperclip/control/research-pm/context-request.json
node /opt/super-agent/role/scripts/context-configure.mjs --request /paperclip/control/research-pm/context-request.json --apply
```

company/owner/Agent IDs从原registry和Native核对，不由request替换。apply前核对team派发关闭、无活动run/租约/call.lock；preview不写配置。工具保全本次原registry/manifest，按稳定operation保存intent/receipt；部分结果沿原操作对账，不盲建第二个workspace。回退只恢复本次context绑定配置，已创建workspace、材料与来源历史保留，不全局删资源。部署apply及真实返回须另行记录，以上命令示例不表示已经运行。

验收逐项见[真实运行手册](acceptance-runbook.md#m2-跨项目续接与记忆)，源码职责与测试入口见[开发地图](development-map.md)，实施和未完成项见[M2计划](plans/cross-project-context-m2.md)。

本人已发送但维护期间未入站的 new 原目标可经[官方消息补收](operations.md#已知本人消息补收)恢复。默认 preview，显式 apply；原 ID/正文摘要和来源保留，不要求重发、不伪装 SDK 事件、不另建恢复调度器。API 补收不开放 `remember/correct/share/continue`，不会把过去未确认的内容自动写入长期记忆。
