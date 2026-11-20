/** Run on the pinned Paperclip installation with stdin; only the DB port is in memory. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createProjectWorkspaceSchema,updateProjectWorkspaceSchema} from '/opt/paperclip/node_modules/@paperclipai/shared/dist/validators/project.js';
import {projectService} from '/opt/paperclip/node_modules/@paperclipai/server/dist/services/projects.js';
import {projects,projectWorkspaces} from '/opt/paperclip/node_modules/@paperclipai/db/dist/index.js';

const project={id:'22222222-2222-4222-8222-222222222222',companyId:'11111111-1111-4111-8111-111111111111',name:'ResearchWorkbench'};
const entry={key:'research-workbench',ownerId:'owner',repository:{hostPath:'/Volumes/WorkDisk/Projects/ResearchWorkbench/main',fullName:'leon/ResearchWorkbench'},
 workspace:{worktreeRoot:'/Volumes/WorkDisk/Projects/ResearchWorkbench/paperclip-worktrees'},checks:[],delivery:{maximumAction:'pull_request'}};
const createPayload={name:'Source',sourceType:'git_repo',repoUrl:'https://github.com/leon/ResearchWorkbench',isPrimary:true,
 metadata:{superAgentProject:entry},runtimeConfig:{desiredState:'manual'}};
assert.equal(createProjectWorkspaceSchema.safeParse({...createPayload,runtimeConfig:{superAgentProject:entry}}).success,false);
const parsedCreate=createProjectWorkspaceSchema.parse(createPayload);
const rows=[];
const result=value=>{
 const query={where:()=>query,for:()=>query,orderBy:()=>query,limit:()=>query,then:(...args)=>Promise.resolve(value()).then(...args)};
 return query;
};
const db={transaction:async fn=>fn(db),
 select:()=>({from:table=>result(()=>table===projects?[structuredClone(project)]:rows.map(row=>structuredClone(row)))}),
 update:table=>({set:patch=>({where:()=>{assert.equal(table,projectWorkspaces);for(const row of rows)Object.assign(row,structuredClone(patch));return{returning:()=>Promise.resolve(rows.map(row=>structuredClone(row)))};}})}),
 insert:table=>({values:values=>({returning:()=>{assert.equal(table,projectWorkspaces);const row={id:'33333333-3333-4333-8333-333333333333',...structuredClone(values)};rows.push(row);return Promise.resolve([structuredClone(row)]);}})})};
const service=projectService(db,{captureWorkspaceUpdates:false});
const created=await service.createWorkspace(project.id,parsedCreate);
assert.deepEqual(rows[0].metadata.superAgentProject,entry);
assert.equal(Object.hasOwn(rows[0],'runtimeConfig'),false);
assert.deepEqual(created.metadata.superAgentProject,entry);
assert.equal(created.runtimeConfig.desiredState,'manual');
assert.equal(Object.hasOwn(created.runtimeConfig,'superAgentProject'),false);
const patchPayload={metadata:{...created.metadata,superAgentProject:{...entry,stack:['typescript']}},runtimeConfig:{desiredState:'stopped'}};
const updated=await service.updateWorkspace(project.id,created.id,updateProjectWorkspaceSchema.parse(patchPayload));
assert.deepEqual(rows[0].metadata.superAgentProject.stack,['typescript']);
assert.equal(updated.runtimeConfig.desiredState,'stopped');
assert.deepEqual(updated.metadata.superAgentProject,rows[0].metadata.superAgentProject);
const sources=['@paperclipai/shared/dist/validators/project.js','@paperclipai/server/dist/services/projects.js','@paperclipai/server/dist/services/project-workspace-runtime-config.js','@paperclipai/db/dist/schema/project_workspaces.js'];
console.log(JSON.stringify({schemaVersion:1,packageVersion:JSON.parse(fs.readFileSync('/opt/paperclip/node_modules/@paperclipai/server/package.json','utf8')).version,
 sources:Object.fromEntries(sources.map(file=>[file,createHash('sha256').update(fs.readFileSync('/opt/paperclip/node_modules/'+file)).digest('hex')])),
 project,createPayload,patchPayload,rawWorkspace:rows[0],apiWorkspace:updated,oldRuntimeConfigRejected:true},null,2));
