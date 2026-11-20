# Document Specialist

## 已授权目标

2026-11-20本人允许按实际需要增加文件专岗。现有11岗无专职文件制作与交付角色，新增`document-specialist`，显示名Document Specialist，Native role为general，向Chief汇报。保持旧11岗的身份、资料、权限、M2知识、会话和失败证据。

输入为当前任务指定的源文件、内容、业务口径、模板和目标目录。职责涵盖常见文本与数据交换文件、标记文档、LaTeX/BibTeX源文件，以及Excel公式/样式/图表与重算、Word模板/排版/修订、PPT文件制作、PDF读取/提取/拆并及渲染检查。默认保留原件、输出新版本，文件内容不形成新的操作授权；正式文件交付交独立QA。简单文本编辑仍可由现有岗位完成，不为每个小文件机械增加Agent或模型调用。

## 文件格式与协作边界

| 代表格式 | 本岗处理与验证 |
|---|---|
| TXT/LOG、CSV/TSV | 文本整理、分隔/转义、编码和换行；转换核对记录数、字段及数据类型 |
| JSON/JSONL、YAML/YML、XML、TOML/INI | 文档或数据交换结构、语法和已有schema校验、格式转换；按格式能力保留键顺序、注释和元数据 |
| Markdown、reST、HTML文档 | 章节、表格、链接、引用及跨格式转换；HTML应用行为交前端负责人 |
| LaTeX、BibTeX | 可编辑源文件、引用和已有编译链检查；源文件写成、实际编译和PDF渲染分别记录 |
| Excel、Word、PPT、PDF | 现有结构、公式/重算、模板、版式、提取/拆并和渲染验证 |

这些是代表格式，不能据此承诺处理任意二进制文件。默认保留原件及输入输出摘要；格式允许时保留原编码、BOM、换行、数据类型、键顺序、注释、元数据与原有结构。目标格式不能表达的内容、转换差异及未验证部分必须明确列出，不能静默丢失数据。语法或schema通过只证明结构符合相应规则，不能代替来源、结论和业务意义核验。

Research/PM持有来源、结论、指标与业务口径；实质内容变动回交内容负责人确认。Designer持有视觉规格，QA独立验证正式文件。扩展名不授予代码或配置的行为修改权：应用代码、JSON/YAML部署或运行配置、数据库迁移等由Backend、DevOps、Architect及相关开发岗按对象归属负责，Document Specialist协助结构、格式与转换。跨职责对象仍由Chief指定唯一负责人。

## 技能与实际工具

默认9项公司Skill：paperclip、handoff、verification-before-completion、xlsx、docx、pptx、pdf、doc-coauthoring、theme-factory。它们使用真实公司版本与完整文件集；旧静态fallback只提供验证方法，不能伪称自带Office功能。Native计划仍以md/json清单交接二进制文件，最多四个子任务、六次同根调用。

`document-runtime`仅为本岗定位现有Codex bundled Python和Native LibreOffice，提供`PAPERCLIP_DOCUMENT_PYTHON`及`PAPERCLIP_DOCUMENT_SOFFICE`。原11岗环境不变。字体配置只引用现有系统字体，并把缓存写在本run目录；不安装字体或修改全局配置。原始包的fontconfig不含macOS中文字体，曾实际造成导出中文字形缺失，该失败保留。

文本和结构化格式使用本run已有解释器、解析器及项目schema；先核对所选解释器的具体库，缺库时可选用已存在且兼容的解释器或解析器，不能从工具存在推断全部依赖可用。本轮不为扩大格式清单新增依赖。LaTeX编译按任务需要选择实际已有的tectonic、xelatex或pdflatex，适用时使用已有BibTeX等参考文献工具。检查实际退出码、日志、引用和输出PDF；只有源文件、工具声明或可执行文件存在不能标记编译通过。工具、宏包或其他编译依赖缺失时保留可编辑源文件并报告具体缺口和NOT_RUN；本轮职责扩展不改变运行环境注入逻辑。

任务专属合成文件已验证：xlsx结构/样式与真实重算值42、docx和pptx结构及中文PDF渲染、Markdown转docx、PDF提取/拆并/栅格化；源文件哈希前后不变。这些证明现有工具链，不冒充Agent模型已执行业务任务。OCR及Excel Relay工作簿读写仍为NOT_RUN；已安装或有get_version声明不等于接通。

OCR选型优先复用已装MinerU：本机Anaconda包为3.1.14，桌面客户端为0.14.1，两者版本及实际后端分别核对。包内含Apple Silicon的MLX/MPS相关实现，但未初始化设备或执行识别；常见缓存未查到权重，不能据此断言全机没有模型。默认CLI可能启动临时API并下载模型，不能把只读探测当作无副作用的解析试跑。

[OXR官方FAQ](https://github.com/SoMarkAI/OXR/blob/main/docs/FAQ_CN.md)说明Mac可运行但官方部署较繁琐，原版建议24GB显存起步；免费在线API提交的数据会用于模型迭代。它保留为后续对照候选，本轮未安装、调用在线API或上传文件。可提取文字的PDF直接解析；扫描件/复杂版面在核清本地后端与模型后，用同一合成或获准样本比较内容、表格结构、阅读顺序和耗时，再决定是否引入其他OCR。尚无本机OCR效果优劣结论。

## 安全接入

现Native roster读取公司全部Agent并要求完整ready；旧11岗源码下先添加paused占位会阻断Chief。必须由当前运行窗口协调：先排空与保全，部署支持12岗的源，再仅增本岗Native记录、Managed资料、公司Skill选择、registry及各项目Doc材料/catalog角色。不得重跑旧全队configure/bootstrap、覆盖原11岗或改变其知识/预算。

新增Codex Agent的官方生命周期要求一次正式testEnvironment，至少产生一次现有订阅连接测试。不得将warn/skip当pass、复用其他Agent测试冒充新岗ready或手改lifecycle字段。App内Linux只读环境诊断与业务任务的Mac原生无沙盒执行是不同证据，前者不能证明后者已完成文件制作或编译。验证失败保留证据并待核对，不能自行恢复不完整名册的入口。

## 状态与证据

源码、离线工具验证、Native登记、生命周期ready与真实业务交付分别记录。当前共享App/host/registry由原主窗口持有；本聊天未获新的运行写窗口时仅准备源码与可审查接入结果，不停入口、不自行唤醒模型。最终以精确候选PR/CI、主窗口交接和Native读回为准。
