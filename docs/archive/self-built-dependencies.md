# 历史：自建依赖清单与用途

以下是旧自建计划，不是当前安装清单。当前依赖身份见 [开发地图](../development-map.md) 和候选锁文件；新增安装另须授权。

以下版本通过 npm 官方 registry 的只读元数据查询确认。本文件与 package.json 是安装前的具体审阅清单；尚未安装依赖。

| 依赖 | 固定版本 | 用途 |
|---|---|---|
| fastify | 5.12.7 | 本地 HTTP API、请求校验与错误处理 |
| @fastify/static | 10.1.8 | 提供构建后的网页静态资源 |
| @larksuiteoapi/node-sdk | 1.76.0 | 飞书长连接、消息与卡片回调 |
| react / react-dom | 19.3.1 | 管理面板 |
| vite | 8.3.5 | 网页开发和构建 |
| typescript | 7.0.2 | 静态类型检查 |
| @types/node | 26.6.6 | Node 类型声明，类型检查不能代替本机 Node 运行测试 |
| @types/react / @types/react-dom | 19.3.0 | 网页类型声明 |

SQLite、测试、密码派生、日志和进程控制使用 Node 标准库，不增加 Python 依赖。

安装不启用模型、飞书通知、开机启动或 Tailscale 配置。安装后执行测试与构建；安装失败保留真实错误及锁文件，不自动更换版本。
