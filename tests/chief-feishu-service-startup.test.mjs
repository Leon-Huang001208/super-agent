import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startChiefFeishuService} from '../bridge/chief-feishu-service.mjs';

test('a bound paused team may initialize the receiver; unknown flags and changed identities still fail before SDK access',async t=>{
 const R='/paperclip/control/research-pm',credentials={appId:'fixture-app',appSecret:'fixture-only'},owner={ownerOpenId:'fixture-owner'};
 let registry,identity;
 const originals={stat:fs.lstatSync,read:fs.readFileSync};
 const values=()=>({[R+'/registry.json']:registry,'/paperclip/feishu/feishu.json':credentials,'/paperclip/feishu/ownership.json':owner,'/chief-feishu-identity/owner-context.json':identity});
 t.mock.method(fs,'lstatSync',function(file,...args){const value=values()[file];return value?{isFile:()=>true,isSymbolicLink:()=>false,nlink:1,uid:process.getuid(),mode:0o100600,size:Buffer.byteLength(JSON.stringify(value))}:originals.stat.call(this,file,...args);});
 t.mock.method(fs,'readFileSync',function(file,...args){const value=values()[file];return value?Buffer.from(JSON.stringify(value)):originals.read.call(this,file,...args);});
 const reset=enabled=>{registry={ownerId:'owner',companyId:'company',team:{enabled,projectId:'project',ids:{chief:'chief'}},context:{enabled:false}};identity={appId:credentials.appId,ownerOpenId:owner.ownerOpenId};};
 const start=()=>startChiefFeishuService({database:async()=>{throw Object.assign(Error('Fixture stops before any Native access or connection'),{code:'FIXTURE_NATIVE_ACCESS_STOP'});}});
 for(const enabled of [true,false]){
  reset(enabled);
  await assert.rejects(start,error=>['MODULE_NOT_FOUND','FIXTURE_NATIVE_ACCESS_STOP'].includes(error.code),String(enabled)+' must pass deployment binding only');
 }
 for(const enabled of [undefined,null,'false',0]){reset(enabled);await assert.rejects(start,/CHIEF_FEISHU_DEPLOYMENT_BINDING_DENIED/);}
 for(const field of ['appId','ownerOpenId']){reset(false);identity[field]='changed';await assert.rejects(start,/CHIEF_FEISHU_DEPLOYMENT_BINDING_DENIED/);}
});
