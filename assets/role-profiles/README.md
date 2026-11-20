# 11岗位通用职业模板

每个目录只包含当前岗位完整 `AGENTS.md` 与能力说明 `CAPABILITIES.md`，由 `roleInstructions(role)` 与 `renderRoleCapabilitiesMarkdown(role)` 生成，回归逐字核对一致性。此处为可审查源模板，Native实际登记、版本与当前run材料仍由既有受管入口保存和验证。

角色键、英文显示名、Native角色类型和汇报关系维持原合同。项目特定的repository/workspace/rules/checks/stack/services/delivery以及宿主路径、卷身份与预算来自可信 `projectContext`，不把RWB或其他单项目限制写成通用岗位规则。

Skills包在独立 `assets/role-skills` 中，其只读入口单独安装到当前任务的 `CODEX_HOME/skills`；不把完整Skill内容塞入Native Managed instruction bundle。
