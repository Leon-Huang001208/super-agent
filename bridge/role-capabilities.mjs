import {ROLE_KEYS,ROLE_DISPLAY_NAMES} from './role-labels.mjs';
import {resolveRoleSkillBundles,ROLE_SKILL_BUNDLE_SHA256,ROLE_SKILL_BUNDLES} from './role-skill-bundles.mjs';
import {resolveCompanyRoleSkills,roleSkillNames} from './company-role-skills.mjs';

const hostBase=['host.project_inspect','host.project_check','host.project_git','host.github_read'];
const entries={
 chief:{purpose:'目标拆解、分派、依赖、预算和成果收回。',skills:['leader','problem-framing','engineering-delivery'],namespaces:[],hostTools:['host.project_publish']},
 research:{purpose:'公开搜索、官方文档和多源证据比较。',skills:['firecrawl-deep-research','read-docs','solution-comparison'],namespaces:['firecrawl','search_service'],hostTools:[]},
 pm:{purpose:'客户问题、产品需求、优先级、KPI和可观察验收。',skills:['product-manager-coach','design-kpis'],namespaces:['data','codex_document_control'],hostTools:[],serviceMcp:true},
 designer:{purpose:'用户流程、视觉设计、设计审查和Figma交付。',skills:['frontend-design','audit','figma-generate-design','figma-design-to-code'],namespaces:['figma'],hostTools:[],serviceMcp:true},
 architect:{purpose:'领域、模块边界、接口契约、数据模型和可实施方案。',skills:['improve-codebase-architecture','writing-plans'],namespaces:[],hostTools:[]},
 'frontend-engineer':{purpose:'可访问界面、状态、API接入、前端性能和浏览器验证。',skills:['frontend-testing-debugging','test-driven-development'],conditionalSkills:[{name:'react-best-practices',stack:['react','next.js','nextjs']},{name:'shadcn',stack:['shadcn','shadcn/ui']}],namespaces:['browser_use','playwright'],hostTools:[],serviceMcp:true},
 'backend-engineer':{purpose:'API、业务逻辑、权限、后台任务、SQL和事务。',skills:['systematic-debugging','test-driven-development'],conditionalSkills:[{name:'supabase-postgres-best-practices',stack:['postgres','postgresql','supabase'],service:['postgres','postgresql','supabase']}],namespaces:[],hostTools:[],serviceMcp:true},
 qa:{purpose:'独立代码/权限评审、API与浏览器验证和精确候选证据。',skills:['verification-before-completion','frontend-testing-debugging'],namespaces:['browser_use','playwright'],hostTools:[],serviceMcp:true},
 devops:{purpose:'Docker、CI/CD、服务可观测性、备份恢复和已授权发布。',skills:['engineering-delivery','systematic-debugging','read-docs'],namespaces:['firecrawl'],hostTools:['host.project_publish','host.rwb_release']},
 'network-engineer':{purpose:'宿主网络、路由、DNS/TLS、网关和代理的诊断与授权变更。',skills:['diagnosing-bugs','systematic-debugging'],namespaces:[],hostTools:['host.network_observe','host.network_apply']},
 'system-resource-engineer':{purpose:'宿主卷身份、容量、RAM/Swap、CPU/I/O及授权资源治理。',skills:['storage-analyzer','systematic-debugging'],namespaces:[],hostTools:['host.resources_observe','host.resources_apply']},
 'document-specialist':{purpose:'常见文本与数据交换（TXT/LOG、CSV/TSV、JSON/JSONL、YAML/YML、XML、TOML/INI）、Markdown/reST/HTML文档、LaTeX/BibTeX及Excel/Word/PPT/PDF的制作、转换、结构和编译/渲染核验；按实际工具与格式能力保留信息，内容和代码/配置语义交对应负责人。',skills:['verification-before-completion'],namespaces:['codex_document_control'],hostTools:[],serviceMcp:true},
};
for(const [id,value]of Object.entries(entries)){
 value.id=id;value.domain=id;
 for(const child of Object.values(value))if(Array.isArray(child))Object.freeze(child);
 Object.freeze(value);
}
export const CAPABILITY_CATALOG=Object.freeze(entries);
export const ROLE_CAPABILITY_DEFAULTS=Object.freeze(Object.fromEntries(ROLE_KEYS.map(role=>[role,Object.freeze([role])])));
export const CAPABILITY_EVIDENCE_STAGES=Object.freeze(['assigned','materialized','discovered','connected','action-tested','business-accepted']);

function evidenceStages({discovered=false}={}){
 // Assignment and the current directory are the only evidence owned by this resolver.
 // Materialization, connection and execution receipts belong to their actual runtime steps.
 return Object.fromEntries(CAPABILITY_EVIDENCE_STAGES.map(stage=>[stage,stage==='assigned'||(stage==='discovered'&&discovered)?'PASS':'NOT_RUN']));
}

function namespaceMatches(name,namespace){
 return name.startsWith(`${namespace}.`)||name.startsWith(`mcp__codex_apps__${namespace}__`)||name.startsWith(`mcp__${namespace}__`);
}
function serviceNames(projectContext){
 const services=projectContext.services??{};
 return (Array.isArray(services)?services:Object.keys(services).filter(key=>services[key]!==false&&services[key]?.enabled!==false)).map(x=>String(x).toLowerCase());
}
function conditionMatches(condition,projectContext){
 const stack=(projectContext.stack??[]).map(x=>String(x).toLowerCase());
 return condition.stack?.some(x=>stack.includes(x))||condition.service?.some(x=>serviceNames(projectContext).includes(x));
}
export function resolveRoleCapabilities({role,additionalCapabilities=[],projectContext={},toolCatalog=[],agent,companySkills,companySkillVersions}){
 if(!ROLE_KEYS.includes(role))throw Error('TEAM_ROLE_UNKNOWN');
 if(!Array.isArray(additionalCapabilities)||additionalCapabilities.some(x=>!ROLE_KEYS.includes(x)))throw Error('ROLE_CAPABILITY_UNKNOWN');
 if(!Array.isArray(toolCatalog)||toolCatalog.some(x=>!x||typeof x.name!=='string'))throw Error('ROLE_TOOL_CATALOG_INVALID');
 const capabilityIds=[...new Set([role,...additionalCapabilities])],capabilities=capabilityIds.map(id=>CAPABILITY_CATALOG[id]);
 const namespaces=[...new Set(capabilities.flatMap(x=>x.namespaces))];
 const mcpAllowedTools=[...new Set(toolCatalog.filter(tool=>{
  if(namespaceMatches(tool.name,'plugin_management')||namespaceMatches(tool.name,'github'))return tool.annotations?.readOnlyHint===true;
  return namespaces.some(namespace=>namespaceMatches(tool.name,namespace));
 }).map(x=>x.name))];
 const registeredMcp=(projectContext.hostMcpServers??[]).some(server=>server&&Array.isArray(server.tools)&&server.tools.length&&(!server.allowedRoles||server.allowedRoles.includes(role)));
 const hostAllowedTools=[...new Set([...hostBase,...capabilities.flatMap(x=>x.hostTools),...(capabilities.some(x=>x.serviceMcp)&&registeredMcp?['host.mcp_call']:[])])].filter(name=>name!=='host.rwb_release'||role==='devops');
 const skillNames=capabilities.flatMap(capability=>[...capability.skills,...(capability.conditionalSkills??[]).filter(x=>conditionMatches(x,projectContext)).map(x=>x.name)]);
 const company=resolveCompanyRoleSkills({agent,role,projectContext,companySkills,companySkillVersions,bundledSkills:ROLE_SKILL_BUNDLES});
 const dependencyStatus=dependency=>({...dependency,status:dependency.kind==='mcp'?(toolCatalog.some(tool=>namespaceMatches(tool.name,dependency.namespace))?'discovered':'not-discovered'):(toolCatalog.some(tool=>tool.name===dependency.tool)?'discovered':'requires-host-transport')});
 const skills=company?company.skills.map(skill=>({...skill,availability:{bundle:'company-version',dependencies:skill.runtimeDependencies.map(dependencyStatus)}})):resolveRoleSkillBundles(skillNames).map(skill=>({name:skill.name,path:`${skill.directory}/SKILL.md`,entrypointSha256:skill.files.find(file=>file.path==='SKILL.md').sha256,fileSetSha256:skill.source.sha256,source:skill.source,dependencies:skill.dependencies,
  availability:{bundle:'bundled',dependencies:skill.runtimeDependencies.map(dependency=>({...dependency,status:dependency.kind==='mcp'?(toolCatalog.some(tool=>namespaceMatches(tool.name,dependency.namespace))?'discovered':'not-discovered'):(toolCatalog.some(tool=>tool.name===dependency.tool)?'discovered':'requires-host-transport')}))},
 }));
 return {schemaVersion:1,role,capabilityIds,skills,mcpAllowedTools,hostAllowedTools,skillBundleSha256:ROLE_SKILL_BUNDLE_SHA256,
  ...(company?{skillSelectionSource:'company',companySkillSnapshot:company.companySkillSnapshot}:{}),
  evidence:{schemaVersion:1,stages:[...CAPABILITY_EVIDENCE_STAGES],skills:skills.map(skill=>({name:skill.name,stages:evidenceStages()})),
   tools:[...mcpAllowedTools,...hostAllowedTools].map(name=>({name,stages:evidenceStages({discovered:toolCatalog.some(tool=>tool.name===name)})}))},
  availability:{mcpTools:toolCatalog.length?'discovered':'not-discovered',hostTools:hostAllowedTools.map(name=>({name,status:toolCatalog.some(tool=>tool.name===name)?'discovered':'requires-host-transport'})),missingNamespaces:namespaces.filter(namespace=>!toolCatalog.some(tool=>namespaceMatches(tool.name,namespace)))},
 };
}

export function renderRoleCapabilitiesMarkdown(role){
 if(!ROLE_KEYS.includes(role))throw Error('TEAM_ROLE_UNKNOWN');
 const capability=CAPABILITY_CATALOG[role],resolved=resolveRoleCapabilities({role});
 const lines=[`# ${ROLE_DISPLAY_NAMES[role]} — CAPABILITIES`,'',
  '通用基础与岗位专业能力可组合。Chief可按当前可信任务授权补充其他已定义岗位能力；补充不改变角色ID、汇报关系、项目授权上界或根模型预算。',
  '此文件是能力说明，实际本run允许的工具名、技能摘要和依赖状态由能力解析结果给出。projectContext注入项目、仓库、规则、stack、services及最高交付动作。','',
  '## Skill、Tool、Apps与插件','',
  '- Skill是可按触发条件读取的方法与参考资料，不是已安装的工具，也不扩大任务授权。执行已获授权的工作时，不因Skill里的泛用流程再次索取同一批准。',
  '- Tool是本run工具目录中真实存在、通过授权校验的可调用能力；不能从文档示例或缓存目录推断工具可用。',
  '- Apps是连接的外部服务（如GitHub、Figma）；需要有效连接、服务权限及本次任务范围。',
  '- 插件是分发Skills、Tools或Apps连接的包；能发现插件不等于已经安装、连接或获准写入。','',
  '## 默认专业能力','',capability.purpose,'',
  '公司Skill分配以Agent的paperclipSkillSync.desiredSkills为唯一选择来源；每run固定公司版本与完整文件摘要。未配置公司选择的历史run保留旧包兼容，显式空选择不恢复旧专业包。',
  `公司默认分配：${roleSkillNames({role}).join('、')}。条件技能只在任务stack/services/domains匹配时启用；上方公司分配优先，以下为保留的历史包来源说明。`,'',
  '入口文件摘要entrypointSha256校验SKILL.md实际文件字节；文件集摘要fileSetSha256（保留在source.sha256）是files清单的聚合摘要，不能拿它与单个文件内容摘要比较。','',
  '下面摘要仅显示前12位供人核对；机器能力结果保留完整entrypointSha256与fileSetSha256，完整包索引保留逐文件清单，截短值不用于认证。',
  ...resolved.skills.map(skill=>`- ${skill.name}：${skill.path}；${skill.source.origin}@${skill.source.version}；entrypointSha256=${skill.entrypointSha256.slice(0,12)}…；fileSetSha256=${skill.fileSetSha256.slice(0,12)}…。`),
  ...(capability.conditionalSkills??[]).map(skill=>`- ${skill.name}：仅projectContext确认stack/services匹配${[...(skill.stack??[]),...(skill.service??[])].join(' / ')}时加载。`),'',
  '## 工具触发与依赖','',
  '通用MCP只开放目录中带annotations.readOnlyHint=true的插件发现与GitHub只读工具。GitHub写入及交付走项目已有宿主受管入口，MCP不直接开放merge。',
  '当前Native项目登记repository.fullName后，可用host.github_read经宿主现有gh认证读取该仓库的PR、Issue及分支状态/SHA；不复制凭据，不接受其他仓库、任意URL或写入方法。目录发现不代表连接成功，分页截断及当前状态证据不代表代码、CI或业务验收。',
  capability.namespaces.length?`岗位按真实目录匹配MCP namespace：${capability.namespaces.join('、')}；调用前检查具体方法、输入、连接和范围。`:'本岗位没有默认专业MCP namespace；按需由Chief组合已定义能力。',
  `宿主候选工具：${resolved.hostAllowedTools.join('、')}。这些名称表示岗位候选权限；是否已经接通须看实际目录与传输，具体仓库、动作、路径和服务参数仍由当前任务约束。`,
  role==='devops'?'host.rwb_release仅是DevOps岗位候选，Chief组合其他能力不能继承；必须另经可信projectContext及受管操作身份校验。普通交付按当前projectContext.delivery、项目持续授权及受管检查执行，不因Agent身份额外限定为PR；该工具不提高项目最高动作，未登记对应发布权限和精确操作时不可调用。':'',
  capability.serviceMcp?'projectContext.hostMcpServers登记本岗位可用的服务和方法时，才能提供host.mcp_call；services仅描述项目服务，不能替代具体MCP登记。':'',
  'Skill完整只读包在独立资产目录，CODEX_HOME/skills入口指向所需包；包内相对引用、必要references/scripts及每文件摘要保留。未配置的可选技能或工具仍不可调用。',
  'Skill文件存在只证明资料存在；Mac原生CLI、Python、浏览器、Figma连接、项目受管发布器等运行依赖必须单独核实。缺依赖写明NOT_RUN和缺失项，保留已完成成果。',
  '需要新增安装、外部写入或高影响动作而现有授权不足时，只提交具体缺口；授权内自主执行，不导入无条件重复审批。','',
  '## 能力证据阶段','',
  '| 阶段 | 实际证明 |',
  '| --- | --- |',
  '| assigned | 本run岗位与任务选择了该能力；只证明分配。 |',
  '| materialized | 本run实际读取并校验包、文件及依赖物化结果。 |',
  '| discovered | 当前真实工具目录返回对应工具名。 |',
  '| connected | 目标连接通过适用身份、权限和可达性检查。 |',
  '| action-tested | 在授权目标上执行了所需具体动作并取得结果。 |',
  '| business-accepted | 实际交付满足当前任务验收并通过独立质量核验。 |','',
  '各阶段分别记录证据；没有对应回执统一为NOT_RUN，不能从先前阶段或另一项目推导。解析器只确认assigned及目录中的discovered，不把缓存目录、Skill索引或工具自述升级为materialized、connected、action-tested或business-accepted；后续阶段由其真实运行回执另行证明。',
  '持续迭代时，把实际失败、缺依赖、连接或动作结果交回主责岗位，沿原任务修复并由独立QA复核。方法更新归AGENTS/SOP，工具和依赖事实归CAPABILITIES，派发/预算/恢复缺陷归运行代码，业务缺陷归对应项目；新材料经评审、PR和Native CAS发布后仅对下个run生效。','',
  '## 失败与证据','',
  '按实际工具响应区分已完成、失败、NOT_RUN和结果未知。记录候选、来源、命令或调用摘要及可定位的脱敏日志；未知结果先核对原操作，不更换ID盲目重发。',
  `资产包摘要（前12位）：${ROLE_SKILL_BUNDLE_SHA256.slice(0,12)}…；完整值见机器能力结果skillBundleSha256。`,''
 ];
 return lines.filter(x=>x!==undefined).join('\n');
}
