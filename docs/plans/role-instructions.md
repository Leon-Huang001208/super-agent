# 角色指令目录与网页保存修复

## 目标与设计

本人于2026-11-20授权：每个角色独立目录、文件名可读，网页编辑保存后用于后续执行；同步登记和执行校验，保留现有角色配置和历史记录。

复用Paperclip原生Managed bundle与其认证、内容冲突检查。每个Agent的原生Managed根中只放本角色的`<role>/AGENTS.md`及登记引用，不把旧共享materials目录整体导入。Agent ID、名称、汇报关系、模型、工具、工作区、任务和订阅配置保持原值；旧UUID文件、manifest、许可、claim、运行和会话保留。

现有进程内源码装配机制扩展到原生文件服务，固定源摘要和精确标记；不修改已安装包。保存前持久保全旧字节，保存成功后在原registry控制锁下只更新该角色材料登记及历史。跨数据库与文件系统失败保留恢复意图；pending或摘要不一致时拒绝新执行。未登记角色和旧hello/Chief接口维持原生行为。

不采用只隐藏红字或只改文件名的方案，前者无法证明生效，后者与原校验不兼容。原生Managed目录的身份父路径仍由Paperclip管理；可读角色目录和入口位于每个bundle内。

## 实施计划

### 1. 保存及迁移合同

- [ ] 在`bridge/role-instruction-store.mjs`实现角色绑定、不可变快照、pending恢复、manifest和历史同步；复用`role-control-store.mjs`锁。
- [ ] 在`scripts/migrate-role-instructions.mjs`实现排空检查、精确文件集合迁移、原配置合并、幂等续接及回执。
- [ ] 测试覆盖：保存后新摘要、旧字节可恢复、失败可见、并发登记保留、未登记透传、部分迁移续接、跨角色/路径拒绝。

### 2. 原生写入与执行接线

- [ ] `docker/role-instruction-hook.mjs`包装原生entry commit/restore/reset及文件write/remove/apply；在`role-preload.mjs`最早安装。
- [ ] `native-role-runtime.mjs`使用登记的材料根并拒绝pending；新run固定材料快照，保存不改在途run绑定。
- [ ] 更新`role-codex-gate.mjs`与`role-container-transport.mjs`，按company/agent/role/run精确验证Managed及快照路径，保留旧许可兼容与原摘要校验。
- [ ] 相关测试先复现缺口再实现；全套离线测试与文档检查通过后，独立评审精确候选。

### 3. 交付与现场验收

- [ ] 受管PR、必需CI和独立评审通过，核对远端包含候选。
- [ ] 实查Native run、租约、模型进程、现有运行配置和宿主容量，在排空窗口切换本项目专用候选及原传输入口；复用精确镜像，不重启Docker Desktop。
- [ ] 迁移11角色，验证旧材料、角色配置及历史身份保持；使用已认证Chrome验证列表、保存、刷新读回及新内容预检。
- [ ] 验证执行材料快照与新摘要；真实模型运行与非模型预检分别记录，不能互相代替。
- [ ] 保存恢复入口、实际结果与剩余未验项；只回收本任务无引用临时容器。

## 主要回归风险

保存与执行同时发生时必须使用已绑定快照；注册表并发操作不得被迁移覆盖；Native写入后同步失败不得静默成功；旧共享目录不得跨角色复制；原始历史与既有授权不得重建、清零或扩大。
