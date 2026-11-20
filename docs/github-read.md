# Native任务的GitHub只读连接

Mac原生Codex使用本run独立HOME与CODEX_HOME。宿主`gh`登录可用，不表示独立任务HOME中存在同一连接；匿名公共API还受到独立额度限制。连接故障先由Network Engineer核对实际通道，不能把匿名403当作仓库不存在或模型失败，也不为此换模型、重放Native传输或复制宿主凭据。

`host.github_read`在现有host executor/queue中使用宿主已装`gh`及原有登录。项目必须在可信Native workspace的`metadata.superAgentProject.repository`登记`fullName`，例如`owner/repository`；可同时登记匹配的GitHub URL，`hostPath`仍可为null。登记远端身份不创建代码工作区，不提高`delivery.maximumAction`，read_only项目仍保留原上界。

工具只接受`operation`及适用的`number`或`ref`：

| operation | 实际读取 |
| --- | --- |
| pull_requests | 当前开放PR的第一页、状态及完整head SHA |
| issues | 当前开放Issue的第一页，排除PR |
| pull_request | 一个PR的状态、完整head、分支、merge信息 |
| issue | 一个Issue的状态 |
| branch | 登记仓库中一个分支的完整SHA |

每次固定`gh api --method GET --hostname github.com`及登记仓库路径，不接受原始URL、命令、方法、环境或认证参数。列表最多100项，原API页达到100项时保留`truncated=true`，不能把过滤后的少量Issue误称完整列表。返回来源与实际观察时间；这些metadata不证明CI、patch等价、测试或部署通过。

认证配置和token不进入任务HOME、提示或工具结果，不创建匿名fallback。缺CLI、连接失败、响应格式不符明确报错；结果未知沿原host操作核对，不盲目重复副作用。岗位候选、工具目录发现与成功动作/业务验收仍是不同证据。

宿主命令仅沿既有可信代理设置执行；任务不能指定代理或改变全局网络。普通工具及Native HOME策略保持。代理诊断、GET工具回归、真实连接和真实任务质量结论分别留证。
