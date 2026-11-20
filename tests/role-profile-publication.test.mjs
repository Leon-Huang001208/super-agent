import test from 'node:test';
import assert from 'node:assert/strict';
import {publishRoleProfiles} from '../scripts/publish-role-profiles.mjs';
test('role publication uses Managed compare-and-save, adds capability notes and preserves replayed content',async()=>{
 const files=new Map([['backend-engineer/AGENTS.md',{content:'old role',revision:{id:'old-revision'}}]]),writes=[];
 const role={profile:{role:'backend-engineer',agentId:'agent'},manifest:{instructionsFilePath:'backend-engineer/AGENTS.md'}};
 const ports={readFile:async(_id,path)=>files.get(path)??null,writeFile:async input=>{writes.push(input);files.set(input.path,{content:input.content,revision:{id:'new-'+writes.length},contentHash:'hash-'+writes.length});}};
 const result=await publishRoleProfiles({roles:[role],...ports,log(){}});
 assert.equal(result.roles,1);assert.equal(result.changedFiles,2);
 assert.equal(writes[0].path,'backend-engineer/CAPABILITIES.md');assert.equal(writes[0].baseHash,null);
 assert.equal(writes[1].baseRevisionId,'old-revision');
 assert.match(writes[1].content,/Backend Engineer/);assert.ok(!writes[1].content.includes('不合并或部署RWB'));
 assert.equal((await publishRoleProfiles({roles:[role],...ports,log(){}})).changedFiles,0);
});
test('a real save conflict stops publication without claiming remaining roles were updated',async()=>{
 const role={profile:{role:'qa',agentId:'agent'},manifest:{instructionsFilePath:'qa/AGENTS.md'}};
 await assert.rejects(publishRoleProfiles({roles:[role],readFile:async()=>null,writeFile:async()=>{throw Object.assign(Error('conflict'),{code:'ROLE_PROFILE_HTTP_409'});},log(){}}),error=>error.code==='ROLE_PROFILE_HTTP_409');
});
