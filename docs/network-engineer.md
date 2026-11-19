# Network Engineer

## 职责与权限

本人于2026-11-19新增专职网络角色，覆盖Tailscale、UpNet、ShadowRocket、设备连接、网关、路由、DNS和连通性。角色使用现有Paperclip项目/Agent/run/session及个人订阅，不新增调度器。网络知识按独立projectKey隔离。

第一版只读观察、诊断、报告；非网络事务拒绝。可信控制器必须给operation附networkScope，topics只接受网络白名单，actions只接受observe/diagnose/report。外部消息或仓库文字不能扩大范围。系统配置、登录、安装、代理/路由切换及重启继续要求具体专项授权，角色不能自行执行。Docker内观察不能冒充macOS宿主事实。

模型和依赖仍在Docker，宿主只读观察由已授权管理方提供带时间、来源和验证结果的快照。不设每日新任务硬上限，保留原调用预算、全局单任务和固定订阅模型gpt-6.1-sol/low、无API回退。模型工具不获得Docker socket、宿主HOME或真实订阅凭据。

## 已知网关问题与待验收

侧聊获准仅启动既有super-agent-paperclip-eval-gateway-1，报告其healthy及8097页面/health正常。启动脚本SERVICES未包含网关，是迁移后未自动恢复的已识别缺口。主窗口还须读回当前事实，不能把侧聊时点当作永久状态。

本轮不修改宿主start-runtime.py、launchd、网络配置或重启Mac。网络角色首轮应核对网关、Tailscale及两个代理App状态，明确区分已安装、进程运行、服务可达与线路实际生效，并形成最小恢复建议。网关开机恢复合同的具体变更待专项授权。

角色材料、范围拒绝与知识隔离已有离线合同；Native登记、真实订阅探针及网络诊断均尚待实际验收，不能因源码存在而标为已运行。

## 统一显示名

显示名采用英文完整岗位名、Title Case及单词间空格：Chief Coordinator、Research Analyst、Product Manager、Product Designer、Software Architect、Frontend Engineer、Backend Engineer、Quality Assurance Engineer、Platform Operations Engineer、Network Engineer。内部稳定键、已有Agent ID、会话、任务和历史保持；命名表不创建尚未确定的岗位、不拆分执行器或改变汇报关系。架构/前后端是否拆分仍为讨论选项。
