# Research 与 PM 原生能力接入

## M0 现场核查，2026-11-19

实际非云盘主检出为 /Users/leon/Developer/Super Agent，干净提交 c83400cd08c99c28772c97929dfcd5044f2eca8a。独立实现位于 WorkDisk 的 Projects/SuperAgent/research-pm-m1-20261119。WorkDisk APFS UUID 已核对为 2BC466D2-FD62-4395-86AC-45CFF653BC51。

Docker context 为 desktop-linux。评估应用与日常 Chief 应用引用同一镜像 sha256:ce66c5354e5efdd7279953134cba2a43c16b54e618a9e15ca6eb83e6bcae0c6c。评估实例的数据、固定依赖及覆盖层依赖 /Volumes/SuperAgentDockerData，该挂载当前缺失。旧 sparsebundle 位于 My PSSD/SuperAgent/paperclip-data.sparsebundle，但本轮未挂载或修改。评估应用、评估数据库均退出。

日常 Chief 应用也依赖该旧挂载，启动错误明确指出 broker 路径缺失。日常数据库使用独立命名卷，健康且存在一个 in_review 任务 81077116-4bfb-4574-9133-56a76ac2dbdd，不能认定排空。其 heartbeat_runs 查询无记录，不能用此事实证明原任务无外部动作。旧租约、通知、模型会话和评估数据库因挂载缺失保持 UNKNOWN。

## M1 设计与顺序

Paperclip 保留唯一任务、assignment、run 和 session 归属。Research 和 PM 是同一项目的角色。复用现有 projectAdapters、个人订阅、原生 codex_local 及单一飞书监听。旧 wrapper 保留，新增角色需独立受控许可及实际工具校验。

先实现纯读取的材料预检与知识投影。材料由部署方的固定清单提供相对路径、字节摘要和必需引用。目录链拒绝符号链接，读取有界，摘要变化即拒绝。role 私有记录只向对应角色公开，项目记录跨角色可见。确认决定带版本、来源和适用条件；任务状态继续读取 Paperclip。

后续先将上述预检接在实际原生执行器准备入口，再启用一个 Research 与一个 PM。装载失败须阻止模型启动。必须用真实运行证明工具可用和被拒绝情况。当前不能把纯函数验证或旧 JSON 文档 worker 记为业务验收。

PM Skill 的跨设备参考包须先核对声明的 ZIP SHA、六成员白名单及文件指令。本机没有已核实安装副本；传输文本不等于已接入。

## 验收与当前缺口

离线验收覆盖引用缺失、摘要变化、路径穿越、符号链接、材料总量、项目隔离、角色私有隔离和决定版本。实际执行还需原挂载恢复及身份核对、数据库/租约/原操作排空证明、原生适配器源码审计、wrapper 新路径许可、真实技能加载和工具证据。

真实调研、PM 产物、跨新会话记忆召回、真实飞书去重与续接均为 NOT_RUN。新增源码与运行开关分别交付。

只读来源挂载尝试使用本任务 Scratch 的独立 mountpoint，系统返回“权限被拒绝”，未恢复原挂载。M0 因此仍缺外置核心、旧数据库、会话和租约的原件核对。此为当前技术阻塞，不以历史终态覆盖。

离线材料预检及知识读取候选已有 Docker 回归，尚未接到原生适配器。正式任务、模型、飞书、运行切换和业务验收均未开始。

离线 Role preparation 端口核对 task/agent/project/run/owner/inputRevision、前后 Native revision、固定订阅配置、必需材料及角色知识。它只输出待审核准备结果，dispatch 与 toolVerification 明确为 NOT_RUN。现行原生执行器尚未接入此端口，待完整运行包核实后完成装配和真实工具范围验证。

日常数据库的未完任务属于 Chief process Agent，company 为 d79278a0-288f-4ae8-96e9-e39e16ef45d8，project_id 为空，任务更新于 2026-11-09。模型运行表为空，原任务仍 in_review。角色准备端口要求 Native 权威读口确认 projectKey/role 并复制第一次读取的快照，防止缓存原地更新掩盖版本漂移。
