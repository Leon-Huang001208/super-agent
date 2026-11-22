# 已知本人飞书消息补收

2026-11-22额度说明：下文六次预算记录2026-11-20该恢复方案的原合同。当前补收后的执行由原根可信上限核算，普通默认20次，历史显式12次及QA专项按绑定保留；本页不改变旧记录，见[当前额度合同](../agent-iteration.md)。

2026-11-20。原 A 消息平台存在，Owner、tenant 和正文前缀已核；发送时并发部署关闭接收器，Native 未登记。修复先恢复同源运行开关和安全交接，不回退 Native Skills，不要求本人重发。

增加只供受管操作者执行的单消息恢复入口。输入仅原 message ID 和预期正文 SHA；由既有固定 app SDK 的官方 message.get 重新取得原消息，校验固定 Owner、既有 SDK 已认证单聊、原消息 ID、text 类型、原时间和正文 SHA。只接纳 new goal，不开放记忆、共享或任意历史操作补执行。

经验证的 API 来源使用明确 recovery origin，不伪造 SDK event/eventId。复用 M2 的 Native intent、原 message-ID 去重、ACK 和项目权限；CLI 不调用 drain，不直接 wake/run，不绕过暂停/未知结果。后续执行仍由既有 Native 协调器和原根六次预算承担。

不加依赖、凭据、调度器、数据库迁移、后台轮询或系统服务。日志不含原文、私聊列表或秘密。先建立原消息从未登记的只读反馈；源码验证用脱敏官方返回结构与 stub Native/SDK，不触实机消息。

回归：真实结构验证成功仅登记一次/ACK一次；同消息重复不增；错 Owner/chat/app/tenant/body/id、bot/post、伪造输入、API失败和非 new 命令均零登记/零发送；API recovery 与后续 SDK 同 message ID 仍复用原 Native 记录。合并候选完整 Docker 回归、文档、独立评审与 PR CI 后才部署；最终只补收原 A 并记录真实来源与结果。业务 A–E 未执行项不升级通过。
