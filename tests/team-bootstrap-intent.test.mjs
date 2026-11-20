import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';
import {validateTeamBootstrapIntent} from '../scripts/team-bootstrap.mjs';

function fixture(){
 const ids=Object.fromEntries(ROLE_KEYS.map(role=>[role,randomUUID()]));
 const intent={schemaVersion:1,at:'2026-11-20T00:00:00.000Z',roles:Object.fromEntries(ROLE_KEYS.map(role=>[role,{agentId:ids[role],taskId:randomUUID(),operationId:randomUUID()}]))};
 return{ids,intent};
}

test('bootstrap accepts only a complete intent bound to the current twelve registered Agent IDs',()=>{
 const{ids,intent}=fixture(),before=JSON.stringify(intent);
 assert.equal(ROLE_KEYS.length,12);
 assert.equal(validateTeamBootstrapIntent(intent,ids),intent);
 assert.equal(JSON.stringify(intent),before);
 for(const role of ROLE_KEYS){const changed=structuredClone(intent);changed.roles[role].agentId=randomUUID();assert.throws(()=>validateTeamBootstrapIntent(changed,ids),/INTENT_CHANGED/);}
});

test('a historical eleven-role intent fails closed and its saved data is preserved',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bootstrap-intent-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const{ids,intent}=fixture();delete intent.roles['document-specialist'];
 const file=path.join(root,'team-bootstrap.intent.json'),bytes=Buffer.from(JSON.stringify(intent)+'\n');fs.writeFileSync(file,bytes);
 const prior=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.throws(()=>validateTeamBootstrapIntent(prior,ids),/TEAM_BOOTSTRAP_INTENT_CHANGED/);
 assert.deepEqual(fs.readFileSync(file),bytes);
 assert.equal(Object.keys(prior.roles).length,11);
 assert.equal(prior.roles['document-specialist'],undefined);
});

test('unknown role keys cannot replace a missing registered role with the same intent count',()=>{
 const{ids,intent}=fixture();intent.roles.placeholder=intent.roles['document-specialist'];delete intent.roles['document-specialist'];
 assert.equal(Object.keys(intent.roles).length,12);
 assert.throws(()=>validateTeamBootstrapIntent(intent,ids),/INTENT_CHANGED/);
 const current=fixture();current.ids.placeholder=current.ids['document-specialist'];delete current.ids['document-specialist'];
 assert.throws(()=>validateTeamBootstrapIntent(current.intent,current.ids),/SCOPE_CHANGED/);
});

test('the CLI validates persisted data before creating lifecycle services or processing stored receipts',()=>{
 const source=fs.readFileSync(new URL('../scripts/team-bootstrap.mjs',import.meta.url),'utf8');
 const validation=source.indexOf('intent=validateTeamBootstrapIntent(read(intentFile),ids)');
 assert.ok(validation>0);
 assert.ok(validation<source.indexOf("createAgentLifecycle(db)"));
 assert.ok(validation<source.indexOf("team-bootstrap.receipts.json"));
 assert.ok(validation<source.indexOf('for(const[key,setup]of Object.entries(intent.roles))'));
});
