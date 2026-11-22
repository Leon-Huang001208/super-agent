import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';
import {CAPABILITY_CATALOG, ROLE_CAPABILITY_DEFAULTS, resolveRoleCapabilities, renderRoleCapabilitiesMarkdown} from '../bridge/role-capabilities.mjs';
import {DEFAULT_ROLE_SKILL_ASSET_ROOT,resolveRoleSkillBundles} from '../bridge/role-skill-bundles.mjs';

test('skill entrypoint bytes and file-set manifests have separately labelled hashes',()=>{
 const skill=resolveRoleCapabilities({role:'backend-engineer'}).skills.find(value=>value.name==='systematic-debugging');
 const [bundle]=resolveRoleSkillBundles([skill.name]),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(skill.entrypointSha256,sha(readFileSync(path.join(DEFAULT_ROLE_SKILL_ASSET_ROOT,skill.path))));
 assert.equal(skill.fileSetSha256,sha(JSON.stringify(bundle.files)));
 assert.equal(skill.source.sha256,skill.fileSetSha256);
 assert.notEqual(skill.entrypointSha256,skill.fileSetSha256);
 const text=renderRoleCapabilitiesMarkdown('backend-engineer');
 assert.match(text,/入口文件摘要.*entrypointSha256/);assert.match(text,/文件集摘要.*fileSetSha256/);
 assert.doesNotMatch(text,/；源摘要 /);
});

const toolCatalog = [
  {name:'mcp__codex_apps__plugin_management__list_plugins',annotations:{readOnlyHint:true}},
  {name:'mcp__codex_apps__plugin_management__install_plugin',annotations:{readOnlyHint:false}},
  {name:'mcp__codex_apps__github__get_pull_request',annotations:{readOnlyHint:true}},
  {name:'mcp__codex_apps__github__merge_pull_request',annotations:{readOnlyHint:false}},
  {name:'mcp__codex_apps__github__ambiguous_tool'},
  {name:'mcp__codex_apps__firecrawl__search',annotations:{readOnlyHint:true}},
  {name:'mcp__codex_apps__figma__use_figma',annotations:{readOnlyHint:false}},
  {name:'mcp__playwright__browser_snapshot',annotations:{readOnlyHint:true}},
  {name:'mcp__playwright__browser_click',annotations:{readOnlyHint:false}},
  {name:'mcp__codex_apps__gmail__send_email',annotations:{readOnlyHint:false}},
];

test('actual Apps dot namespaces expose role tools and annotated common readonly tools',()=>{
  // Names and readOnlyHint values observed in the installed apps-tool-catalog.json.
  const actualCatalog=[
    {name:'plugin_management.search_plugins',annotations:{readOnlyHint:true}},
    {name:'github.get_repo',annotations:{readOnlyHint:true}},
    {name:'figma.get_screenshot',annotations:{readOnlyHint:true}},
    {name:'firecrawl.firecrawl_search',annotations:{readOnlyHint:true}},
    {name:'github.merge_pull_request',annotations:{readOnlyHint:false}},
    {name:'github.get_pull_request'},
    {name:'plugin_management.install_plugin',annotations:{readOnlyHint:false}},
    {name:'plugin_management.list_plugins'},
  ];
  const chief=resolveRoleCapabilities({role:'chief',toolCatalog:actualCatalog});
  assert.deepEqual(chief.mcpAllowedTools,['plugin_management.search_plugins','github.get_repo']);
  const research=resolveRoleCapabilities({role:'research',toolCatalog:actualCatalog});
  assert.deepEqual(research.mcpAllowedTools,['plugin_management.search_plugins','github.get_repo','firecrawl.firecrawl_search']);
  assert.ok(!research.availability.missingNamespaces.includes('firecrawl'));
  assert.equal(research.skills.find(x=>x.name==='firecrawl-deep-research').availability.dependencies[0].status,'discovered');
  const designer=resolveRoleCapabilities({role:'designer',toolCatalog:actualCatalog});
  assert.deepEqual(designer.mcpAllowedTools,['plugin_management.search_plugins','github.get_repo','figma.get_screenshot']);
  assert.ok(!designer.availability.missingNamespaces.includes('figma'));
  assert.deepEqual(resolveRoleCapabilities({role:'chief',toolCatalog:actualCatalog.map(({name})=>({name}))}).mcpAllowedTools,[]);
});

test('all registered roles resolve common readonly tools and only their professional namespaces',()=>{
  assert.deepEqual(Object.keys(CAPABILITY_CATALOG),ROLE_KEYS);
  assert.deepEqual(Object.keys(ROLE_CAPABILITY_DEFAULTS),ROLE_KEYS);
  const research=resolveRoleCapabilities({role:'research',toolCatalog});
  assert.equal(research.schemaVersion,1);
  assert.deepEqual(research.capabilityIds,['research']);
  assert.deepEqual(research.mcpAllowedTools,[
    'mcp__codex_apps__plugin_management__list_plugins',
    'mcp__codex_apps__github__get_pull_request',
    'mcp__codex_apps__firecrawl__search',
  ]);
  assert.ok(research.skills.some(x=>x.name==='firecrawl-deep-research'&&x.source.sha256));
  const designer=resolveRoleCapabilities({role:'designer',toolCatalog});
  assert.ok(designer.mcpAllowedTools.includes('mcp__codex_apps__figma__use_figma'));
  assert.ok(!designer.mcpAllowedTools.some(x=>/merge|install|send_email|ambiguous/.test(x)));
});

test('Chief can combine only defined role capabilities without broadening Github writes',()=>{
  const result=resolveRoleCapabilities({role:'pm',additionalCapabilities:['research','designer','research'],toolCatalog});
  assert.deepEqual(result.capabilityIds,['pm','research','designer']);
  assert.ok(result.mcpAllowedTools.includes('mcp__codex_apps__firecrawl__search'));
  assert.ok(result.mcpAllowedTools.includes('mcp__codex_apps__figma__use_figma'));
  assert.ok(!result.mcpAllowedTools.includes('mcp__codex_apps__github__merge_pull_request'));
  assert.equal(new Set(result.skills.map(x=>x.name)).size,result.skills.length);
  assert.throws(()=>resolveRoleCapabilities({role:'pm',additionalCapabilities:['mcp__codex_apps__gmail__send_email']}),/ROLE_CAPABILITY_UNKNOWN/);
  assert.throws(()=>resolveRoleCapabilities({role:'unknown'}),/TEAM_ROLE_UNKNOWN/);
});

test('host work is enabled by role and registered MCP methods while availability distinguishes policy from installed tools',()=>{
  const network=resolveRoleCapabilities({role:'network-engineer'});
  assert.ok(network.hostAllowedTools.includes('host.network_observe'));
  assert.ok(network.hostAllowedTools.includes('host.network_apply'));
  assert.ok(!network.hostAllowedTools.includes('host.resources_apply'));
  const resources=resolveRoleCapabilities({role:'system-resource-engineer'});
  assert.ok(resources.hostAllowedTools.includes('host.resources_apply'));
  const backend=resolveRoleCapabilities({role:'backend-engineer',projectContext:{hostMcpServers:[{id:'excel-relay-dev',tools:['get_version'],allowedRoles:['backend-engineer']}]},toolCatalog});
  assert.ok(backend.hostAllowedTools.includes('host.mcp_call'));
  assert.ok(!resolveRoleCapabilities({role:'backend-engineer'}).hostAllowedTools.includes('host.mcp_call'));
  assert.ok(!resolveRoleCapabilities({role:'backend-engineer',projectContext:{services:{postgres:{}}}}).hostAllowedTools.includes('host.mcp_call'));
  assert.ok(!resolveRoleCapabilities({role:'backend-engineer',projectContext:{hostMcpServers:[{id:'other',tools:['query'],allowedRoles:['qa']}]}}).hostAllowedTools.includes('host.mcp_call'));
  assert.ok(resolveRoleCapabilities({role:'devops'}).hostAllowedTools.includes('host.project_publish'));
  assert.ok(!resolveRoleCapabilities({role:'qa'}).hostAllowedTools.includes('host.project_publish'));
  assert.equal(network.availability.mcpTools,'not-discovered');
  assert.ok(network.skills.every(x=>x.availability.bundle==='bundled'));
  assert.ok(network.availability.hostTools.every(x=>x.status==='requires-host-transport'));
});

test('stack-dependent skills are selected by actual project context and absent dependencies remain explicit',()=>{
  const generic=resolveRoleCapabilities({role:'frontend-engineer'});
  assert.ok(!generic.skills.some(x=>x.name==='react-best-practices'||x.name==='shadcn'));
  const react=resolveRoleCapabilities({role:'frontend-engineer',projectContext:{stack:['React','shadcn/ui']}});
  assert.ok(react.skills.some(x=>x.name==='react-best-practices'));
  assert.ok(react.skills.some(x=>x.name==='shadcn'));
  assert.ok(react.skills.find(x=>x.name==='frontend-testing-debugging').availability.dependencies.some(x=>x.status==='not-discovered'));
  const pg=resolveRoleCapabilities({role:'backend-engineer',projectContext:{stack:['PostgreSQL']}});
  assert.ok(pg.skills.some(x=>x.name==='supabase-postgres-best-practices'));
});

test('capability documents explain Skills, Tools, Apps, Plugins and task-bound authorization',()=>{
  for(const role of ROLE_KEYS){
    const markdown=renderRoleCapabilitiesMarkdown(role);
    for(const text of ['Skill','Tool','Apps','插件','依赖','projectContext','Chief'])assert.ok(markdown.includes(text),`${role}: ${text}`);
    assert.ok(!markdown.includes('leonjia0117/SuperAgent'));
  }
});
test('operations documentation skill has its actual read-docs tool route',()=>{
 const result=resolveRoleCapabilities({role:'devops',toolCatalog:[{name:'firecrawl.firecrawl_search',annotations:{readOnlyHint:true}}]});
 assert.ok(result.mcpAllowedTools.includes('firecrawl.firecrawl_search'));
});

test('catalog discovery cannot certify connection, action or business acceptance',()=>{
 const result=resolveRoleCapabilities({role:'research',toolCatalog:[
  {name:'firecrawl.firecrawl_search',connected:true,actionTested:true,businessAccepted:true},
  {name:'host.project_inspect',connected:true},
 ]});
 const stages=['assigned','materialized','discovered','connected','action-tested','business-accepted'];
 assert.deepEqual(result.evidence.stages,stages);
 for(const tool of result.evidence.tools){
  assert.deepEqual(Object.keys(tool.stages),stages);
  assert.equal(tool.stages.assigned,'PASS');
  assert.equal(tool.stages.materialized,'NOT_RUN');
  assert.equal(tool.stages.discovered,['firecrawl.firecrawl_search','host.project_inspect'].includes(tool.name)?'PASS':'NOT_RUN');
  for(const stage of ['connected','action-tested','business-accepted'])assert.equal(tool.stages[stage],'NOT_RUN');
 }
 assert.ok(result.evidence.skills.every(skill=>skill.stages.assigned==='PASS'&&stages.slice(1).every(stage=>skill.stages[stage]==='NOT_RUN')));
 assert.ok(result.evidence.tools.some(tool=>tool.name==='firecrawl.firecrawl_search'));
 assert.ok(!result.evidence.tools.some(tool=>tool.name==='github.merge_pull_request'));
});

test('RWB release is a DevOps candidate and is never inherited through role composition',()=>{
 assert.ok(resolveRoleCapabilities({role:'devops'}).hostAllowedTools.includes('host.rwb_release'));
 for(const role of ROLE_KEYS.filter(role=>role!=='devops')){
  if(role==='full-stack-engineer'){
   assert.throws(()=>resolveRoleCapabilities({role,additionalCapabilities:['devops'],toolCatalog:[{name:'host.rwb_release'}]}),/ROLE_CAPABILITY_SCOPE_DENIED/);
   continue;
  }
  const result=resolveRoleCapabilities({role,additionalCapabilities:['devops'],toolCatalog:[{name:'host.rwb_release'}]});
  assert.ok(!result.hostAllowedTools.includes('host.rwb_release'),role);
  assert.ok(!result.evidence.tools.some(tool=>tool.name==='host.rwb_release'),role);
 }
 assert.equal(resolveRoleCapabilities({role:'devops'}).evidence.tools.find(tool=>tool.name==='host.rwb_release').stages.discovered,'NOT_RUN');
});
