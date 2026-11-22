import {createHash} from 'node:crypto';
import {ROLE_KEYS} from './role-labels.mjs';
import {selectRoleKnowledge} from './role-materials.mjs';
import {createProjectCatalog} from './context-projects.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const key=/^[a-z][a-z0-9-]{0,47}$/;
const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const copy=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pmPaths=['README.md','SKILL.md','agents/openai.yaml','references/finance.md','references/modes.md','references/templates.md'];
export const configurationHash=value=>sha(value);

export function contextConfigurationRequest(value){
  if(!object(value)||value.schemaVersion!==1||!uuid.test(value.operationId??'')||!key.test(value.defaultProjectKey??'')||
    !Array.isArray(value.projects)||value.projects.length<1||value.projects.length>32||
    Object.keys(value).some(name=>!['schemaVersion','operationId','defaultProjectKey','projects'].includes(name)))fail('CONTEXT_CONFIG_REQUEST_INVALID');
  const ids=new Set(),keys=new Set(),projects=value.projects.map(p=>{
    if(!object(p)||!key.test(p.key??'')||!uuid.test(p.projectId??'')||p.maximumAction!=='read_only'||
      !Array.isArray(p.aliases)||p.aliases.length>32||p.aliases.some(alias=>typeof alias!=='string'||!/^[\p{L}\p{N}_-]{1,64}$/u.test(alias))||
      p.projectWorkspaceId!==undefined&&!uuid.test(p.projectWorkspaceId)||
      Object.keys(p).some(name=>!['key','projectId','aliases','maximumAction','projectWorkspaceId'].includes(name))||ids.has(p.projectId)||keys.has(p.key))fail('CONTEXT_CONFIG_REQUEST_INVALID');
    ids.add(p.projectId);keys.add(p.key);return copy(p);
  });
  if(!keys.has(value.defaultProjectKey))fail('CONTEXT_CONFIG_REQUEST_INVALID');
  return {schemaVersion:1,operationId:value.operationId,defaultProjectKey:value.defaultProjectKey,projects};
}

export function contextWorkspaceMetadata(project,ownerId){
  return {superAgentProject:{key:project.key,ownerId,delivery:{maximumAction:'artifact'},rules:[],checks:[]}};
}

export function compatibleContextWorkspace(workspace,project,ownerId){
  const meta=workspace?.metadata?.superAgentProject;
  return workspace?.projectId===project.projectId&&workspace.cwd===project.workspaceCwd&&workspace.isPrimary===false&&
    ['local_path','non_git_path'].includes(workspace.sourceType)&&meta?.key===project.key&&meta.ownerId===ownerId&&meta.delivery?.maximumAction==='artifact'&&
    !meta.repository?.hostPath&&!(meta.hostActions?.length)&&!(meta.hostMcpServers?.length);
}

/** Pure planning only; source buffers and Native-visible rows are supplied by the operator adapter. */
export function planContextConfiguration({request:raw,registry,projects,agents,roleBundles,publicRoles,pmAssets,legacyKnowledge,root}){
  const request=contextConfigurationRequest(raw);
  if(!object(registry)||!uuid.test(registry.companyId??'')||typeof registry.ownerId!=='string'||!registry.ownerId||
    !object(registry.team?.ids)||!Array.isArray(registry.agents)||!Array.isArray(projects)||!Array.isArray(agents)||
    typeof root!=='string'||!root.startsWith('/')||root.endsWith('/'))fail('CONTEXT_CONFIG_SOURCE_INVALID');
  const roles=Object.keys(registry.team.ids);
  if(roles.length!==ROLE_KEYS.length||roles.some(role=>!ROLE_KEYS.includes(role))||new Set(Object.values(registry.team.ids)).size!==roles.length)fail('CONTEXT_CONFIG_ROLE_IDENTITY_CHANGED');
  const files=[],materials={},legacy={},roleUpdates=[],roleSources=[];
  const assetMap=new Map((pmAssets?.files??[]).map(file=>[file.path,file]));
  if(assetMap.size!==pmPaths.length||pmPaths.some(name=>!assetMap.has(name)))fail('CONTEXT_CONFIG_PM_ASSETS_INVALID');
  for(const file of assetMap.values())if(sha(Buffer.from(file.contentBase64??'','base64'))!==file.sha256)fail('CONTEXT_CONFIG_PM_ASSETS_INVALID');
  const add=(area,relative,bytes)=>{const content=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),value={area,path:relative,sha256:sha(content),bytes:content.length,contentBase64:content.toString('base64')};
    const prior=files.find(file=>file.area===area&&file.path===relative);if(prior&&prior.sha256!==value.sha256)fail('CONTEXT_CONFIG_FILE_CONFLICT');if(!prior)files.push(value);return {path:relative,sha256:value.sha256};};
  for(const role of roles){
    const id=registry.team.ids[role],entry=registry.agents.find(value=>value.profile?.agentId===id&&value.profile.role===role),bundle=roleBundles?.[role],source=publicRoles?.[role];
    if(!entry||!agents.some(agent=>agent.id===id&&agent.companyId===registry.companyId)||entry.instructionMutation||entry.instructionMigration?.state==='pending'||
      !bundle||!source||!Array.isArray(bundle.files)||!Array.isArray(entry.manifest?.files)||bundle.files.length!==entry.manifest.files.length)fail('CONTEXT_CONFIG_ROLE_SOURCE_INVALID');
    const seen=new Set();
    for(const file of bundle.files){const expected=entry.manifest.files.find(value=>value.path===file.path);
      if(!expected||seen.has(file.path)||file.path.includes('..')||file.path.startsWith('/')||file.path.includes('\\')||sha(Buffer.from(file.contentBase64,'base64'))!==expected.sha256)fail('CONTEXT_CONFIG_ROLE_SOURCE_INVALID');seen.add(file.path);}
    const exact=entry.manifest.instructionsFilePath===role+'/AGENTS.md'&&bundle.files.length===2&&bundle.files.every(file=>file.path===role+'/AGENTS.md'?file.sha256===sha(source.instructions):file.path===role+'/CAPABILITIES.md'&&file.sha256===sha(source.capabilities));
    if(entry.manifest.scope!=='generic'&&!exact)fail('CONTEXT_CONFIG_ROLE_NOT_PUBLIC');
    if(entry.manifest.scope!=='generic')roleUpdates.push({agentId:id,role,manifest:copy(entry.manifest)});
    roleSources.push({agentId:id,role,materialRoot:entry.materialRoot??root+'/materials',manifest:copy(entry.manifest)});
  }
  const planned=request.projects.map(input=>{
    const project=projects.find(value=>value.id===input.projectId);
    if(!project||project.companyId!==registry.companyId||
      [project.personalOwnerUserId,project.privacyOwnerUserId].some(owner=>owner!==undefined&&owner!==null&&owner!==registry.ownerId))fail('CONTEXT_CONFIG_PROJECT_SCOPE_DENIED');
    if(project.id===registry.team.projectId&&registry.agents.some(entry=>entry.profile?.projectId===project.id&&entry.profile.projectKey!==input.key))fail('CONTEXT_CONFIG_PERSONAL_KEY_CHANGED');
    const workspaceCwd=`/paperclip/instances/default/projects/${registry.companyId}/${project.id}/_default`;
    const p={...copy(input),companyId:registry.companyId,ownerId:registry.ownerId,adapterKey:project.id===registry.team.projectId?'native-docs':'rwb-docs',allowedRoles:[...roles],workspaceCwd};
    const workspaces=project.workspaces??[];
    if(!Array.isArray(workspaces))fail('CONTEXT_CONFIG_WORKSPACES_INVALID');
    let workspace;
    if(project.id===registry.team.projectId&&!workspaces.length&&!input.projectWorkspaceId)workspace={kind:'implicit'};
    else{
      const matching=workspaces.filter(w=>input.projectWorkspaceId?w.id===input.projectWorkspaceId:w.cwd===workspaceCwd&&w.isPrimary===false);
      if(matching.length>1)fail('CONTEXT_CONFIG_WORKSPACE_AMBIGUOUS');
      if(matching.length){if(!compatibleContextWorkspace(matching[0],p,registry.ownerId))fail('CONTEXT_CONFIG_WORKSPACE_METADATA_CHANGED');workspace={kind:'reuse',id:matching[0].id};p.projectWorkspaceId=matching[0].id;}
      else{if(input.projectWorkspaceId||!workspaces.length)fail('CONTEXT_CONFIG_NONPRIMARY_UNAVAILABLE');workspace={kind:'create',name:'M2 Context '+p.key,metadata:contextWorkspaceMetadata(p,registry.ownerId)};}
    }
    materials[project.id]={};legacy[project.id]={};
    const facts=`# Project context snapshot\n\nNative project: ${project.id}\nProject key: ${p.key}\nName: ${project.name??project.id}\nDescription: ${project.description??''}\nMaximum action: artifact/read_only. No old execution callback or stage/production handoff is enabled by this snapshot.\n`;
    for(const role of roles){
      const entry=registry.agents.find(value=>value.profile?.agentId===registry.team.ids[role]),bundle=roleBundles[role],mapping=new Map(),manifestFiles=[];
      for(const file of bundle.files){const target=`context/${project.id}/${role}/${file.sha256}/${file.path}`;const ref=add('materials',target,Buffer.from(file.contentBase64,'base64'));mapping.set(file.path,ref.path);manifestFiles.push(ref);}
      const projectRef=add('materials',`context/${project.id}/${role}/PROJECT-${sha(facts)}.md`,facts);manifestFiles.push(projectRef);
      const references=[...(entry.manifest.requiredReferences??[]).map(name=>mapping.get(name)),mapping.get(role+'/CAPABILITIES.md'),projectRef.path];
      if(role==='pm')for(const name of pmPaths){const asset=assetMap.get(name),ref=add('materials',`context/${project.id}/${role}/product-manager-coach/${asset.sha256}/${name}`,Buffer.from(asset.contentBase64,'base64'));manifestFiles.push(ref);references.push(ref.path);}
      if(references.some(name=>typeof name!=='string')||!mapping.has(entry.manifest.instructionsFilePath)||manifestFiles.length>32)fail('CONTEXT_CONFIG_ROLE_REFERENCES_INVALID');
      materials[project.id][role]={...copy(entry.manifest),schemaVersion:1,scope:'generic',project:p.key,role,
        instructionsFilePath:mapping.get(entry.manifest.instructionsFilePath),requiredReferences:[...new Set(references)],files:manifestFiles,
        publicSource:{kind:'native-registered-generic',role,agentId:registry.team.ids[role],sourceManifestSha256:sha({...entry.manifest,scope:'generic'}),instructionsSha256:bundle.files.find(f=>f.path===entry.manifest.instructionsFilePath).sha256}};
      const records=(legacyKnowledge?.records??[]).filter(record=>record?.project===p.key&&
        (record.visibility==='project'&&(record.role===undefined||record.role===null||record.role===role)||record.visibility==='private'&&record.role===role));
      selectRoleKnowledge({project:p.key,role,records});
      const payload=JSON.stringify({schemaVersion:1,provenance:{kind:'legacy-source',ownerConfirmed:false,sourceSha256:legacyKnowledge?.sha256??sha('[]')},records})+'\n';
      const ref=add('legacy',`${project.id}/${role}-${sha(payload)}.json`,payload);
      legacy[project.id][role]={path:root+'/context/legacy/'+ref.path,sha256:ref.sha256};
    }
    return {project:p,workspace};
  });
  const base={schemaVersion:1,enabled:true,catalog:{schemaVersion:1,defaultProjectKey:request.defaultProjectKey,projects:planned.map(value=>value.project)},materials,legacyKnowledge:legacy};
  try{createProjectCatalog({registry:base.catalog,authority:{companyId:registry.companyId,ownerId:registry.ownerId,agentIds:registry.team.ids},log:()=>undefined});}
  catch{fail('CONTEXT_CONFIG_CATALOG_INVALID');}
  // Workspace IDs created by Native and operation IDs are outcomes, not desired configuration identity.
  const semantic=copy(base);for(const p of semantic.catalog.projects)delete p.projectWorkspaceId;
  return {schemaVersion:1,operationId:request.operationId,requestSha256:sha(request),configurationHash:sha(semantic),companyId:registry.companyId,ownerId:registry.ownerId,
    context:base,projects:planned,files,roleUpdates,roleSources,beforeContext:copy(registry.context??null)};
}
