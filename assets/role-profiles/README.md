# 13岗位候选通用职业模板

每个目录只包含当前岗位完整 `AGENTS.md` 与能力说明 `CAPABILITIES.md`，由 `roleInstructions(role)` 与 `renderRoleCapabilitiesMarkdown(role)` 生成，回归逐字核对一致性。此处为可审查源模板，Native实际登记、版本与当前run材料仍由既有受管入口保存和验证。

公共执行说明覆盖分段读完整资料、持续到本岗done或真实blocker、区分实际完成/待做/阻塞及PoC证据范围；默认和task-routing模式都适用。材料完整SHA按本次实际字节重新计算，旧run固定manifest和材料不回写；此修订不改变模型参数、预算、权限或执行器行为。

角色键、英文显示名、Native角色类型和汇报关系维持原合同。项目特定的repository/workspace/rules/checks/stack/services/delivery以及宿主路径、卷身份与预算来自可信 `projectContext`，不把RWB或其他单项目限制写成通用岗位规则。

2026-11-22按用户决定新增Full Stack Engineer（`full-stack-engineer`），作为Architect下属承担有界小功能、简单前后端联动、Bug与测试，原12岗身份/职责/汇报保持。Chief先确定全栈或专业岗的唯一执行范围，再选已验收模型与Runtime；升档/handoff保留同task/root、原产物、累计预算和证据，仍交独立QA。该岗只有前后端开发/测试能力，无发布、网络、资源或root新权限。模板的默认Codex句子只表示初始绑定；任务级Native材料使用`taskRuntimeRouting:true`生成。

这13目录是新候选源码；生产仍为固定旧12岗源码。第13岗Native登记、公司技能、材料、registry/catalog与执行器须在隔离候选同批迁移并另行验收，不能在旧12岗执行器下追加paused占位，也不能把原12岗五次成功运行自动算作新源码通过。

Skills包在独立 `assets/role-skills` 中，其只读入口单独安装到当前任务的 `CODEX_HOME/skills`；不把完整Skill内容塞入Native Managed instruction bundle。

2026-11-22同步Chief调用预算与DevOps项目交付说明：普通原根默认20次，历史显式12次及QA专项由可信绑定保留；RWB普通开发沿项目自身持续授权与受管入口，不另设Agent身份的PR-only限制。生成文本及摘要取自实际文件字节，Skills未改动，不变更Skill bundle摘要。源码模板修正不代表Native已发布；只在排空交接后通过Owner/CAS更新相关材料，保全其他岗位的人工内容和旧run固定快照。
