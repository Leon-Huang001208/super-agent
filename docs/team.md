# Team roles

## 通用岗位说明与默认能力

本人于2026-11-20明确后续网络问题交由Network Engineer牵头。Chief将DNS、代理/VPN、TLS/HTTPS、证书、路由、网关及连接故障交该岗负责；需要应用协议或代码改动时，网络岗协调Architect及对应开发岗，交独立QA验收。此分工不改变原汇报关系、项目权限或根调用预算，源码模板与Native材料发布分别验证。

现役材料的岗位修订以`assets/role-profiles/<role>/AGENTS.md`和`CAPABILITIES.md`为可审查模板，专业Skill通过带摘要的方法包提供。各岗说明完整列出输入、职责、协作、步骤、工具触发、交付物和完成/失败标准；Tool即工具，Skill是方法，Apps/插件提供连接与能力。

共同基础能力包含项目材料读取、shell/patch、公开来源读取与证据记录。Research优先检索/文档，PM优先产品/KPI，Designer优先Figma/设计审查，Architect负责边界与取舍，前后端分别实现，QA独立评审，Ops使用受管交付及服务工具，Network/Resources使用真实宿主工具。Chief可随已授权任务补充其他岗位能力，项目和任务约束继续适用。

通用正文不写某个业务仓库或主机磁盘身份。RWB限制随对应项目加载；宿主身份、路径和可用工具随宿主上下文提供。模型权限由Native许可、broker及宿主执行入口实施，不由AGENTS自授。源码模板、磁盘发布、新任务加载、真实调用分别验收，见[能力实施计划](plans/role-capabilities.md)。下方带日期的M1登记/验证保留原时点含义。

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

## Native登记及环境验证，2026-11-19

配置已实际完成：11条Native记录、完整英文名称与reportsTo逐项一致。复用原Chief/Research/Product Manager三个ID，新增8条初始paused；登记本身新增run/model均为0。此后8个新岗位通过真实订阅hello验证，原Research/Product Manager复用已有成功证据，Chief恢复Native既有ready而未计新hello。当前11条均ready/idle。原始配置、职责材料历史和运行证据保留。

私有权威回执：control/research-pm/team-configuration.receipt.json、team-bootstrap.intent.json、team-bootstrap.receipts.json。源定义dc6a45445e329e9821a9e7e5fa5c955087ce7495已绑定评估App；image仍为原ce66。角色名配置与环境ready均不等于Chief业务分派通过。

## Native分派及结果收存合同

新Chief入口只接受原生已认证本人创建/发起、默认个人项目内的正式任务。角色、任务、run、会话、上下级与状态仍由Paperclip保存。控制层仅记录授权绑定、计划/副作用意图、Native对象映射及回执，不维护竞争任务库。

Chief产出带输入版本的结构化计划，控制器按实际run/文件摘要验证后，用Native服务事务创建子任务。最多4项，依赖必须成无环图；如有Quality Assurance Engineer，必须在所审全部工作之后，绑定实际Native run与产物SHA，不能提前PASS。代码类任务必须含独立质量岗位；开发和独评角色、会话不得相同。

父任务和子任务共享原根任务六次角色外层调用预算，不因子任务ID重置；每run64次responses上限及全局单模型执行租约保留。取消的是每日新任务数量硬上限。修改目标、owner、project、取消或blocked会阻止旧计划继续。观察数据与成果通过受管输入追加，不反复改任务description；全局槽等待不修改目标。

收回成果时，精确run/摘要marker与Native状态同一事务提交；文件回执丢失只能由这些Native证据恢复。派发返回未知时只读核对原operation，不换ID重发。Native完成状态与通知发出分开，飞书outbox绑定正式任务、summary SHA和source run；unknown不得重发。

## Docker与宿主边界

产品协调器在既有Docker App中，通过原Native服务调度；只在serve主进程启用，CLI/gate子进程不能启动另一控制器。既有宿主Node仅运行Docker stdio传输及只读宿主快照，不安装产品依赖、不挂Docker socket或整个宿主HOME给模型。

Network Engineer/System Resource Engineer使用带时间/来源的Mac宿主快照，覆盖卷UUID/文件系统/容量、RAM/Swap、CPU与现有网络App/网关/Tailscale状态；容器内df、DNS或网络不能冒充宿主事实。未执行I/O压测、代理切换、全局服务重启或数据库迁移必须明确NOT_RUN。

传输代码可在同一个临时QA容器中，以相同UID1000执行确定性OS写拒绝探针；此证据属于外层容器管理探针，不冒充Codex工具本身执行了越界写。私有读取负例使用已确认存在的非敏感合成夹具，区分路径隐藏的ENOENT与EACCES。

Chief控制器、自动宿主传输、真实分派/收回/质量核对/最终飞书通知仍待本候选联合验收。现有登录启动脚本未为新传输安装服务；不能据当前进程运行声称重启后自动恢复已通过。
