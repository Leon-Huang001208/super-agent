# Team roles

本人已确认以下11个岗位，显示名使用完整英文、Title Case及空格。复用现有Chief、Research和PM的ID、任务、会话及历史；内部稳定键不因名称变化而重建。不增加CTO、CMO、COO或DBA。

| Display name | Reports to | Deliverable |
|---|---|---|
| Chief Coordinator | none | 目标拆解、分派、依赖/阻塞/预算、结果与具体决策 |
| Research Analyst | Chief Coordinator | 带来源的研究，区分事实/推论/假设 |
| Product Manager | Chief Coordinator | 需求、优先级、范围及可观察验收 |
| Product Designer | Chief Coordinator | 流程、交互、原型、可访问性和设计依据 |
| Software Architect | Chief Coordinator | 技术边界、接口、数据模型方案和取舍 |
| Frontend Engineer | Software Architect | 前端代码、性能与开发侧测试 |
| Backend Engineer | Software Architect | 后端/API/应用存储；SQL、索引、事务、业务迁移 |
| Quality Assurance Engineer | Chief Coordinator | 独立评审和实际验证，精确候选及NOT_RUN |
| Platform Operations Engineer | Chief Coordinator | Docker、服务/CI/CD/监控、持久卷和备份还原 |
| Network Engineer | Chief Coordinator | 网络、设备、网关、DNS/TLS、Tailscale/UpNet/ShadowRocket |
| System Resource Engineer | Chief Coordinator | 内盘/两个外盘、卷身份/容量、RAM/Swap、CPU/I/O及资源预算 |

Research→Product Manager是成果交接，不是上下级关系。跨职责对象由Chief指定唯一执行负责人；小任务不机械经过全部岗位。新增维护职责不授予格式化、删除未知资源、卸载卷、停止其他任务、重启全局服务或数据库迁移权限。

代码清单定义在bridge/team-roles.mjs、bridge/role-labels.mjs；Native实际记录、材料、执行配置和reportsTo必须另行核验。源码和组织图均不能代替角色真实运行、Chief分派、交接或飞书通知。当前Native登记/启用和业务闭环仍在实施，最终按实际回执更新。

取消每日新任务数量硬上限，同时保留全局单任务执行、固定订阅、模型调用/修复预算及未知结果核对。前端和后端分开，向架构岗位汇报；独立质量岗位直接向Chief汇报。
