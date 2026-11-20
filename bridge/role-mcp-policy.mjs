const fail=code=>{throw Object.assign(new Error(code),{code});};
const repoKeys=['repository_full_name','repo_full_name','repositoryFullName','repository'];
const repositoryName=context=>context?.repository?.fullName?.toLowerCase();
const githubTool=name=>name.startsWith('github.')||/^mcp__(?:codex_apps__)?github(?:__|_)/.test(name);

export function assertRoleMcpCall({name,args={},allowedTools=[],projectContext={}}){
 if(!allowedTools.includes(name))fail('ROLE_PROXY_MCP_ACTION_DENIED');
 if(!args||typeof args!=='object'||Array.isArray(args))fail('ROLE_PROXY_MCP_ARGUMENTS_DENIED');
 if(!githubTool(name))return;
 const expected=repositoryName(projectContext);
 const values=repoKeys.filter(k=>typeof args[k]==='string').map(k=>args[k].replace(/\.git$/,'').toLowerCase());
 if(typeof args.owner==='string'&&typeof args.repo==='string')values.push((args.owner+'/'+args.repo).toLowerCase());
 if(!expected||!values.length||values.some(value=>value!==expected))fail('ROLE_PROXY_MCP_REPOSITORY_DENIED');
}

/** The directory and the call gate consume the same resolved permission set. */
export function filterMcpTools(tools,{allowedTools=[],projectContext={},hostTools=[]}={}){
 const allowed=new Set(allowedTools),seen=new Set();
 const selected=tools.filter(tool=>{
  if(!tool||typeof tool.name!=='string'||tool.name.startsWith('host.')||!allowed.has(tool.name)||seen.has(tool.name))return false;
  if(githubTool(tool.name)){
   const props=tool.inputSchema?.properties??{};
   if(!repositoryName(projectContext)||!repoKeys.some(k=>Object.hasOwn(props,k))&&!(props.owner&&props.repo))return false;
  }
  seen.add(tool.name);return true;
 });
 for(const tool of hostTools)if(tool.name.startsWith('host.')&&!seen.has(tool.name)){selected.push(tool);seen.add(tool.name);}
 return selected;
}

/** The provider currently supports JSON and SSE JSON-RPC directory responses. */
export function transformMcpCatalogBody(text,contentType,transform){
 if(contentType?.includes('text/event-stream'))return text.split('\n').map(line=>{
  if(!line.startsWith('data:'))return line;
  const value=line.slice(5).trim();
  if(!value||value==='[DONE]')return line;
  try{return 'data: '+JSON.stringify(transform(JSON.parse(value)));}catch{fail('ROLE_PROXY_MCP_CATALOG_INVALID');}
 }).join('\n');
 try{return JSON.stringify(transform(JSON.parse(text)));}catch{fail('ROLE_PROXY_MCP_CATALOG_INVALID');}
}
