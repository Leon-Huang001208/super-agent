# Research 与 PM 原生接入

## 当前事实，2026-11-19

源码基线为 c83400cd08c99c28772c97929dfcd5044f2eca8a，非云盘主检出为 /Users/leon/Developer/Super Agent。实现及受管交付工作树在 WorkDisk 的 Projects/SuperAgent 下。WorkDisk APFS UUID 为 2BC466D2-FD62-4395-86AC-45CFF653BC51。

M0 存储迁移已交还：运行 sparsebundle 位于 WorkDisk/Data/SuperAgent，逻辑挂载仍为 /Volumes/SuperAgentDockerData，数据卷 UUID 0A71984A-FF62-4B30-8E23-D91478C246F8。迁移所有者完成1844文件摘要、两库隔离还原及184项日常状态核对；实际重启验收 NOT_RUN。记录保存在 WorkDisk/Data/SuperAgent/migrations/20261119/RESULT.json。旧任务和未知结果均保留，不由本任务接管。

本轮复用 desktop-linux 现有运行镜像 sha256:ce66c5354e5efdd7279953134cba2a43c16b54e618a9e15ca6eb83e6bcae0c6c、Paperclip 2026.1023.0 和 Codex CLI 0.159.0。没有构建或拉取新运行镜像、安装宿主产品依赖、切换 RWB 服务。

## 控制面与执行边界

Paperclip 保留 project、Agent、task、run、session 和订阅身份的唯一归属。原 codex_local 注册表由角色适配器包装，旧 hello/Chief 分支保留。适配层只保存材料、知识投影、精确许可、调用预算和传输回执，不运行第二调度器。

本人已要求开放并测试 shell、文件补丁、Apps 和 Plugins。角色使用 workspace-write，shell/unified_exec/apps/plugins 为 true；不再采用早期关闭工具的方案。工具可见、连接可用、实际调用和业务验收分别留证；缺连接或握手失败不能当通过。

原生 wrapper 把已授权 stdio 交给本任务临时 Docker 容器。任务只挂指定项目工作区、该角色材料及固定 CLI 依赖，不挂应用控制状态、数据库、宿主 HOME、真实订阅授权或 Docker socket。受控 provider broker 持有原 Native 选择的订阅凭据，task 只获得单 run opaque token 和账号标识元数据。固定模型为 gpt-6.1-sol/low，无付费 API 回退。

任务容器使用 UID1000、NoNewPriv、cap-drop ALL 和既有已授权 seccomp。私有 internal 网络与公共 HTTPS CONNECT 分开；CONNECT 拒绝私网 IP。broker 为每 run 签发独立 CA/CA:FALSE provider 证书。客户端显式信任该 CA；不关闭 TLS 验证。Native 不允许 Agent 原始-c配置，可信传输层才施加工具、TLS与网络参数。

模型目录来自原订阅的真实只读 metadata，要求明确包含所选 model；不能用缺少该 model 的 bundled 目录或自行拼造模型能力。真实目录已确认该 model 使用 freeform 补丁工具。材料复制使用与许可 SHA 相同的已验 Buffer。传输不落盘 reasoning 项，输出超限或格式未知保留 UNKNOWN 锁；已确定退出的本任务容器与网络正常收尾。

## 身份、材料与知识

材料预检核对清单、摘要、必需引用、目录链、文件类型、大小及前后 Native inputRevision。知识按 project/role/visibility/version 投影，来源文字不授予权限。PM Skill 原包 SHA256 为 533c4945507b442c0cacec020745b816a8e9c9803381f9a152a4dfc2597fe3ef，六成员白名单与逐文件摘要保存于 assets；它尚不等于真实 PM 已加载证明。

每个成功角色通过 Native service 事务登记精确 run 的最终回复，并交回同一 Native 任务的本人待接手队列。in_review 是阶段交接，不能表示总目标完成。输入、任务归属或 run 改变则拒绝交接并保留未知结果；不让任务缺失 disposition 引起额外模型修复。该新增交接合同已有离线回归，真实运行尚待验证。

## 额度和恢复

原 AdmissionMeter 继续按上海日限10个新任务、全局一个执行租约；每任务六个 Native 外层调用槽，probe/run共用单活调用锁。每工具 run 最多转发64次 responses。Native 的 maxDailyRuns60只是角色调度上限，不替代任务日限和调用槽。session header 不证明请求来自某个工具，计数以 Native 与 broker 回执核对。

原预检任务保留失败记录；本人已允许使用新任务和新会话。现任务为 45441b41-b420-4fb8-b2a0-70bf9b38f928。已核实没有 provider 请求的旧预检失败不能写成真实模型通过；旧许可、预算和核对摘要原样保留。已启动但未知的结果不能自动重试或重发。

取消行不证明环境租约释放。一次无进程、无 session、无角色许可的 Native 自动补偿调用已被取消；其 local lease 通过原环境服务正常释放，原恢复动作及待续接输入仍由 Native 管理，不能手改数据库解除。新的角色交接合同用于避免再次产生无 disposition 的自动补偿。

## 实际验收

| 层次 | 结果 |
|---|---|
| 离线组合回归 | 284/284，零跳过；当前新增交接合同包含变更输入与失败负例 |
| 独立评审 | ce0f079至1dce438未发现P1/P2；其后两项P2已修复，最新增量仍需最终复核 |
| Native 订阅 hello | Research、PM各一次真实通过；不代表业务完成 |
| Research | run 046bd42a-1c09-4390-bb9f-f884def3f7f7 succeeded；session 01a1f3f6-812a-7c33-9e68-a921a6b2ec17。实际读取三份官方来源并产出报告 |
| shell | 首次真实调用被 bwrap uid-map阻断；同镜像非模型UID1000沙箱探针exit0，角色内重验 NOT_RUN |
| 文件补丁 | 首次模型目录不含所选model而工具未出现；真实订阅目录确认freeform，实际补丁调用 NOT_RUN |
| Plugins | 真实建议/已装/list metadata接口200；插件实际调用尚未验证，未安装新增插件 |
| Apps | MCP资源与模板返回空，内置MCP握手被403阻断；不能记为可用或通过 |
| PM、跨新会话记忆、PR/CI、飞书结果 | 本轮真实业务验收 NOT_RUN |

Research 报告明确区分官方事实、推论、假设和未执行项，没有虚构访谈。三个官方来源为 Paperclip README、docs/start/what-is-paperclip.md 和 doc/PRODUCT.md，读取浮动 master，未固定版本，不用它们证明当前部署能力。

## 启停、回退与收尾

运行候选以完整提交保存于 WorkDisk/Data/SuperAgent/runtime-candidates，App 当前源绑定与宿主单次传输候选分别记录在私有 activation 清单；源码 head 不等于已运行 head。更新前核对 Native run、进程、环境租约、共享租约及外部结果，保留精确镜像、原 Compose 与数据库备份。

旧执行/定时/GitHub/Chief 自动开关保持关闭；角色只接受精确 operation 和 task 许可。停止新派发后先排空已知运行，UNKNOWN保留原锁与回执。回退复用原 ce66 镜像和已保存的 Compose 源绑定，不覆盖数据库或恢复旧任务。宿主启动仅复用已授权的工程管理工具，不新增开机服务。

临时 model/provider 容器正常退出后删除、internal 网络按身份移除。已确认本任务结束的输出错误同样收尾资源，显式失败回执保留 UNKNOWN 调用锁。没有全局 prune、删未知锁、合并或部署 RWB。运行候选归档及原历史证据继续保留，资源最终收尾还需随真实验收完成核对。

## 真实交接与工具接入后续

PR #20候选745893a已通过三项必需检查并合入Super Agent，merge SHA为79750d812d49ce49517481daa606f21b1c6c0909。App角色源绑定已更新到该已审候选；运行镜像仍为原ce66。

Research工具复验run 6fd73827-13e8-4119-80ca-77af128ec021 succeeded，实际UID1000 shell、Node v24.22.1、proof写入读回、独立apply_patch及材料SHA均成功，Native正式保存completion并交回本人in_review。PM独立run 30be1ee8-3a02-4e79-a444-9b9e2234bdcf succeeded，读取Research两文件、PM Skill材料并写出pm-requirements.md，复述docker-dependencies/v1/owner-chat知识来源。仅此证明角色交接和本次记忆读取；版本更正、隔离负例及产品自身未实现用例不升级为通过。

Apps原失败定位到CLI专用CODEX_CONNECTORS_TOKEN缺失：用无真实凭据探针确认设置opaque token后MCP实际请求带Bearer；原订阅只读initialize和tools/list均200，共778条工具目录。新传输只把per-run opaque key交给此环境变量，真实授权仍留broker，不新增授权、账号或连接。MCP目录/初始化可用；本轮tools/call严格限定两个已核对的安全只读动作sites.check_slug_availability和plugin_management.search_plugins，其他业务动作须其具体任务授权，不能把开启工具类别当成发信、部署或安装授权。代理同时限制MCP调用数64。最终角色内Apps/Plugins调用仍须实际验证。

新增网络角色单独见[网络工程师](../network-engineer.md)。不改变RWB动作边界。
