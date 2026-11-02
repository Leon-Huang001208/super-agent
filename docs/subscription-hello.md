# 订阅 hello 与保护入口

本候选使用gpt-6.1-sol订阅时要求Codex CLI至少0.159.0；初装0.154.0被后端拒绝，现已在Docker内固定0.159.0并真实hello通过。主机Codex未改动。正常业务Agent另行固定CLI引擎，不能用ACP环境元数据冒充其实际执行成功。

EVALUATION_AUTH_ONLY来自本项目保护脚本，不是OpenAI认证错误。登录/配额检查不等于模型推理成功。该Paperclip版本若ACP只完成环境检查，会再调用CLI真实hello。

许可在/paperclip/evaluation/hello-permit.json，绑定company/grant/model和最多15分钟有效期，固定输入Respond with hello.、工作目录/opt/paperclip、该grant临时CODEX_HOME。未指定模型时使用许可明确模型，并记录defaultModelApplied；显式不匹配直接拒绝。

真实CLI固定只读sandbox、approval never、禁用shell/search/plugin、ephemeral和ignore-user-config；只接受个人订阅token文件，不用APIkey、宿主认证或RWB目录。向导bypass默认参数不进入真实执行。此hello不代表业务Agent已采用安全配置。

独占claim文件及父目录fsync后才启动；失败/超时/重启/回执丢失不能自动重用。独立进程组40秒超时TERM，4秒后KILL整组；取消及EPIPE也进入终止流程。元数据写入/paperclip/logs/hello-probes.jsonl，不写prompt、token或模型推理。

官方OAuth normalizer可能省略auth_mode；必须接受有效tokens格式，不能据此要求用户重新登录。启动前拒绝与模型已启动但结果未知分开记录。公司暂停、调度关闭是额外保护。

许可耗尽后不能无限点击或自动补发。先核查原回执，下一项已授权配置操作再设明确许可。hello通过只证明本次连接，不替代Skills、业务任务、权限、限额、恢复、CI或RWB验收。
