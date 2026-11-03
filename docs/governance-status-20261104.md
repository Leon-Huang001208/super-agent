# 治理建设状态 · 2026-11-04

此文件是日期观察和本轮证据摘要，不是永久运行配置。源码、运行、业务和资源状态分别记录。

## 初始基线与首次发布

主工作区基线 `4e3e0c124391010587cd0a3d713266c5d705554a`，原分支保留。主线 5 个提交、56 个历史 blob 已做路径和秘密特征检查；两项匹配分别是数据库连接字符串的变量插值和脱敏测试假密码，核对后不属于实际凭据。其他实验分支未上传，历史未重写。

已建立私有仓库 `Leon-Huang001208/super-agent`，默认分支 main。分支保护 PUT 实测 HTTP 403：当前账号需 GitHub Pro 或公开仓库才可启用。保持私有，不自动合并，不直接推送业务改动绕过；PR、CI 和独立评审可先交付。

## 实际运行观察

系统盘观察可用约 19 GiB，专用卷约 51 GiB，仅代表观察时点。Paperclip、db、gateway 健康，feishu-connection 运行。

inspect 显示 Compose 来源为 `/Users/leon/.codex/worktrees/sa-unified-integration-20261103` 的多份配置，运行依赖为 `dependencies-paperclip-taskguard3`，含独立 executor-sessions、bridge 状态和 RWB 试点 worktree 挂载。该来源独立仓库 HEAD 为 `3995ddf`，存在多项未提交执行/恢复改动，不等于当前已发布主线。

该来源记录了进行中的 Task A 及受管准备/占用恢复，不能从健康或旧暂停快照推断排空。本轮不修改该目录、不重启容器、不接管其任务、锁或许可，不把其历史试点当作本轮 low 档位验收。

随后直接只读查询数据库：公司 paused 1、Agent paused 1，Native run succeeded 14、failed 16，无 queued/running。容器进程列表未见 Codex 模型进程。这仅证明 Native 与进程观察时点，不证明原任务的 prepared 结果、worktree 占用、租约和恢复流程均已收口；并发脏源码仍受保护。

## 本轮本地验证与独立评审

固定 Node 镜像、Node v24.22.1，Mac Docker、网络关闭、workspace 只读，完整回归 54/54 PASS、0 fail、0 skip，测试报告耗时 436.934 ms。治理检查覆盖 23 份 Markdown、31 条变更路径，结构和同步映射通过；这不是 Linux CI 或真实业务证据。

独立只读 JavaScript/CI 评审发现快捷引用漏检、治理清单放松原映射，以及普通评论覆盖批准的语义问题；新增失败用例后修复，并复审无剩余具体代码阻断项。原映射现在从 Git base 的治理清单读取，工作流和检查器本身仍需独立审查。

候选和预检已固定 low 并回归拒绝旧 xhigh，未修改运行 Agent、未调用模型。完整本地输出及审计日志在本任务外置 `logs/sa-governance-20261104/`；远端 CI 与 PR 状态以实际 GitHub 回执为准。

私有仓库 draft PR #1 已建立。首次 CI run 41686793101 失败：既有镜像是 ARM64，AMD64 runner 无法执行；runner 上 gh 不支持 slurp 与 jq 同时使用。按真实错误将 runner 改为原生 ARM64，分页响应交由 Node 归并，保留原失败记录；最终 CI 以修复后精确 head 的回执为准。

## 本轮交付与阻塞

- 源码：文档、治理检查与 CI 在本任务隔离分支实现；最终验证和 PR 以本轮回执为准。
- 自动合并：BLOCKED，私有仓库分支保护套餐限制。
- 运行升级：BLOCKED，实际运行来源为其他任务的脏集成候选，活动归属与排空尚未建立。
- 本项目真实闭环：NOT_RUN，受保护合并及安全运行前置条件未满足。
- 飞书 RWB 真实闭环：NOT_RUN，不重复发送其他进行中试点或复用旧模型会话冒充本轮。
- 资源收尾：仅在本任务归并与退休后进行；未归并 worktree、实验分支、运行数据、旧许可和恢复材料均保留。

持续任务 Harness ID 为 `sa-governance-20261104`；任务会话及日志保存在受管 Git common dir，秘密不入仓库。解除阻塞后先复核实际事实，继续原账本，不重复创建任务或模型调用。
