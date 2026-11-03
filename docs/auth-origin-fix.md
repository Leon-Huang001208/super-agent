# 本机邀请注册 Invalid origin 修复

> 本文件记录原候选的来源修复；当前运行配置须按 [运维核查](operations.md) 确认，不能从旧入口推断部署。

## 原因

浏览器入口为 `http://127.0.0.1:8097`（或 localhost:8097），容器服务监听3100。CLI初始化配置的认证模式默认为auto；该发布版本还会把loopback认证URL的端口改为实际listenPort，因此只设置公开URL不足以让8097进入有效可信来源。

## 修改

Compose明确设置认证base URL为本机8097、模式explicit，并使用该版本支持的 `BETTER_AUTH_TRUSTED_ORIGINS` 精确加入127.0.0.1:8097和localhost:8097。没有通配符，没有关闭来源校验。Bootstrap配置模板也固定显式认证地址。

## 已观察验证

- 修改前：127.0.0.1:8097、localhost:8097的合成登录请求均403 INVALID_ORIGIN。
- 修改后：这两个来源返回401 INVALID_EMAIL_OR_PASSWORD，说明来源已通过，而不存在的测试账号正常被拒绝。
- http://untrusted.invalid仍为403 INVALID_ORIGIN。
- 容器健康；21项容器内测试通过。
- 修复验证当时，原bootstrap邀请仍有1条有效待接受记录；未重新生成邀请、未读取用户密码。

回执写入专用卷logs下不可变 `paperclip-auth-origin-fix-*.json`，latest文件只保存引用。随后用户已完成注册，订阅hello与新手向导也已完成；当前进展见 delivery-status.md。来源探测仍不能替代业务验收。
