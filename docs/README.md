# Super Agent 文档索引

## 现行规则与设计

- [项目规则](../AGENTS.md)：代理入口、权限与安全边界。
- [产品目标与验收](product.md)：目标、非目标、两条闭环的完成标准。
- [架构](architecture.md)：Paperclip 主线、组件、数据流与失败边界。
- [开发地图](development-map.md)：代码归属、验证入口及证据范围。
- [开发交付流程](agent-workflow.md)：Harness、worktree、评审、PR、CI、合并及收尾。
- [文档治理](documentation-governance.md)：权威关系、同步映射、免更新与检查。
- [运行维护与恢复](operations.md)：存储、候选识别、启动边界和恢复步骤。
- [验收运行手册](acceptance-runbook.md)：受控真实任务与证据契约。
- [架构决策](decisions/0001-paperclip-and-delivery.md)：路线选择、权限分层和重开条件。

## 带日期的状态与证据

- [治理建设状态](governance-status-20261104.md)：本轮源码、远端、运行与验收分别记录。
- [交付快照](delivery-status.md)、[交接快照](current-handoff.md)：2026-11-02 观察记录，不能覆盖更新的运行证据。
- [Paperclip 验证基线](paperclip-evaluation.md)、[订阅 hello](subscription-hello.md)、[来源修复](auth-origin-fix.md)：原候选的设计或验证记录，不自动证明当前部署。

## 历史资料

- [旧自建架构](archive/self-built-architecture.md)、[旧实施计划](archive/self-built-implementation-plan.md)、[旧依赖清单](archive/self-built-dependencies.md)。
- [原型保全](prototype-checkpoint.md)、[选型分析](paperclip-assessment.md)。

当前规范以项目规则及现行专题文档为准；代码证明实现，精确候选的回执证明验证，实时活动观察证明可否运行。冲突时记录未知并追查拥有该事实的来源，不把计划或旧 PASS 提升为现状。
