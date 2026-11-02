# 自建原型保全检查点

在用户选择 Paperclip 优先验证后停止扩写独立中台，原型代码保持在隔离分支/worktree，不运行、不发布、不删除。

- 初始方案：`codex/personal-automation-v1`，基线 `2fe7c6525397e4c62b21c964ed3d8359f3b6eac8`。
- 核心检查点：`codex/sa-v1-core`，提交 `3367aa3`，worktree `/Users/leon/.codex/worktrees/sa-v1-core-7c6b1f04`。
- 网页检查点：`codex/sa-v1-ui`，提交 `811508b497841d9a8f612f268c1d05f3f33f7d4a`，worktree `/Users/leon/.codex/worktrees/sa-v1-ui-7c6b1f04`。
- 核心 Node 测试：19 通过、0 失败，包含无模型的原生 Codex 沙箱私有读取/只读写入拒绝检查。原日志 SHA-256 `a823225bc3b500da318a0473a5b04c4896982b6e6ef89388f5314154ab3fcabf`。
- UI Node 测试：子代理报告 12 通过；依赖未安装，TypeScript/Vite 构建在缺少 tsc 时退出 127，未进行浏览器验证。

## 仍未完成

核心审查指出的进程组停止与退出等待、Codex 协议异常收口、恢复进程身份、Claude 实际适配仍需补全。HTTP 服务与应用入口尚未交付。原型不具备生产就绪或业务验收资格。

已修复并回归的部分包括旧决策失效后的替代卡片、恢复查询的 500 条上限及 GitHub 必需检查匹配。dotenv 后缀保护和飞书出站消息线程关联已修改，尚未分别进行完整集成验收。

没有安装旧自建依赖，没有模型调用、飞书发送、RWB 改动/PR、服务启动、Tailscale 或开机启动修改。
