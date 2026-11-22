import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';
import {
  RUNTIME_PROFILES,
  DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,
  getRoleRuntimeProfile,
  validateRoleRuntimeBinding,
} from '../bridge/role-runtime-profiles.mjs';

// An example current binding snapshot, not a task selection policy.
const assignment=()=>({...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,research:'deepseek_opencode',designer:'minimax_opencode'});
const binding=(role,profile)=>({
  role,
  adapterType:profile.adapterType,
  model:profile.model,
  reasoningEffort:profile.reasoningEffort,
  heartbeatEnabled:false,
});
const hasCode=code=>error=>error.code===code&&error.message===code;

test('profiles fix the runtime, model, credential kind and official endpoint together',()=>{
  const {codex_subscription:codex,deepseek_opencode:deepseek,minimax_opencode:minimax}=RUNTIME_PROFILES;
  assert.equal(codex.adapterType,'codex_local');
  assert.equal(codex.runtime,'codex');
  assert.equal(codex.model,'gpt-6.1-sol');
  assert.equal(codex.reasoningEffort,'low');
  assert.equal(codex.credentialKind,'chatgpt-subscription');
  assert.equal(codex.wireApi,'codex-responses');
  assert.equal(codex.endpoint,'https://chatgpt.com/backend-api/codex');
  assert.equal(deepseek.model,'deepseek/deepseek-flash');
  assert.equal(deepseek.providerModel,'deepseek-flash');
  assert.equal(deepseek.provider,'deepseek');
  assert.equal(deepseek.credentialKind,'api-key');
  assert.equal(deepseek.wireApi,'chat-completions');
  assert.equal(deepseek.endpoint,'https://api.deepseek.com/v1');
  assert.equal(minimax.model,'minimax-cn-coding-plan/MiniMax-M3.1-Flash');
  assert.equal(minimax.providerModel,'MiniMax-M3.1-Flash');
  assert.equal(minimax.provider,'minimax');
  assert.equal(minimax.credentialKind,'coding-plan-api-key');
  assert.equal(minimax.wireApi,'anthropic-messages');
  assert.equal(minimax.endpoint,'https://api.minimax.cn/anthropic/v1');
  for(const profile of [deepseek,minimax]){
    assert.equal(profile.adapterType,'opencode_local');
    assert.equal(profile.runtime,'opencode');
    assert.equal(profile.reasoningEffort,null);
  }
});

test('omitting assignments preserves all existing roles on the Codex subscription',()=>{
  for(const role of ROLE_KEYS){
    const profile=getRoleRuntimeProfile(role);
    assert.equal(profile,RUNTIME_PROFILES.codex_subscription);
    assert.equal(validateRoleRuntimeBinding(binding(role,profile)),profile);
    assert.throws(()=>validateRoleRuntimeBinding(binding(role,RUNTIME_PROFILES.deepseek_opencode)),hasCode('ROLE_RUNTIME_BINDING_DENIED'));
  }
});

test('Claude profiles bind their bare models to the official Anthropic endpoints independently of OpenCode',()=>{
  for(const [id,provider,model,endpoint]of [
    ['deepseek_claude','deepseek','deepseek-flash','https://api.deepseek.com/anthropic/v1'],
    ['minimax_claude','minimax','MiniMax-M3.1-Flash','https://api.minimax.cn/anthropic/v1'],
  ]){
    const profile=RUNTIME_PROFILES[id];assert.equal(profile.runtime,'claude');assert.equal(profile.adapterType,'claude_local');
    assert.equal(profile.provider,provider);assert.equal(profile.model,model);assert.equal(profile.providerModel,model);
    assert.equal(profile.endpoint,endpoint);assert.equal(profile.wireApi,'anthropic-messages');assert.equal(profile.reasoningEffort,null);
    const assignments={...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,'backend-engineer':id};
    assert.equal(validateRoleRuntimeBinding(binding('backend-engineer',profile),assignments),profile);
  }
});

test('the default snapshot records thirteen initial Codex bindings without selecting task runtimes',()=>{
  assert.equal(ROLE_KEYS.length,13);
  assert.deepEqual(Object.keys(DEFAULT_ROLE_RUNTIME_ASSIGNMENTS).sort(),[...ROLE_KEYS].sort());
  for(const role of ROLE_KEYS){
    assert.equal(DEFAULT_ROLE_RUNTIME_ASSIGNMENTS[role],'codex_subscription');
    assert.equal(getRoleRuntimeProfile(role,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS),RUNTIME_PROFILES.codex_subscription);
    const current=getRoleRuntimeProfile(role,assignment());
    assert.equal(validateRoleRuntimeBinding(binding(role,current),assignment()),current);
  }
  const snapshot={...DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,pm:'minimax_opencode'};
  assert.equal(getRoleRuntimeProfile('pm',snapshot),RUNTIME_PROFILES.minimax_opencode);
});

test('an explicit assignment must be a complete known-role to known-profile map',()=>{
  const missing=assignment();delete missing.qa;
  const extra={...assignment(),cto:'codex_subscription'};
  const inherited=Object.create(assignment());
  const nullPrototype=Object.assign(Object.create(null),assignment());
  assert.equal(getRoleRuntimeProfile('designer',nullPrototype),RUNTIME_PROFILES.minimax_opencode);
  for(const value of [null,[],{},missing,extra,inherited,
    {...assignment(),qa:'__proto__'},
    {...assignment(),qa:'constructor'},
    {...assignment(),qa:{model:'untrusted-model'}},
  ])assert.throws(()=>getRoleRuntimeProfile('chief',value),hasCode('ROLE_RUNTIME_ASSIGNMENTS_INVALID'));
});

test('profile changes require matching Native adapter and runtime model, without stale Codex effort',()=>{
  for(const role of ROLE_KEYS){
    const profile=getRoleRuntimeProfile(role,assignment());
    const valid=binding(role,profile);
    for(const change of [{adapterType:'process'},{model:'another-model'},{heartbeatEnabled:true},{heartbeatEnabled:undefined}]){
      assert.throws(()=>validateRoleRuntimeBinding({...valid,...change},assignment()),hasCode('ROLE_RUNTIME_BINDING_DENIED'));
    }
    if(profile.runtime==='opencode'){
      assert.equal(validateRoleRuntimeBinding({...valid,reasoningEffort:undefined},assignment()),profile);
      assert.throws(()=>validateRoleRuntimeBinding({...valid,reasoningEffort:'low'},assignment()),hasCode('ROLE_RUNTIME_BINDING_DENIED'));
      assert.throws(()=>validateRoleRuntimeBinding({...valid,model:profile.providerModel},assignment()),hasCode('ROLE_RUNTIME_BINDING_DENIED'));
    }else{
      for(const reasoningEffort of [undefined,null,'high'])assert.throws(()=>validateRoleRuntimeBinding({...valid,reasoningEffort},assignment()),hasCode('ROLE_RUNTIME_BINDING_DENIED'));
    }
  }
});

test('optional routing metadata cannot override the fixed profile or switch credential kinds',()=>{
  for(const role of ['architect','research','designer']){
    const profile=getRoleRuntimeProfile(role,assignment());
    const valid={...binding(role,profile),runtime:profile.runtime,provider:profile.provider,
      providerModel:profile.providerModel,credentialKind:profile.credentialKind,
      wireApi:profile.wireApi,endpoint:profile.endpoint};
    assert.equal(validateRoleRuntimeBinding(valid,assignment()),profile);
    for(const field of ['runtime','provider','providerModel','credentialKind','wireApi','endpoint']){
      assert.throws(()=>validateRoleRuntimeBinding({...valid,[field]:'untrusted-value'},assignment()),hasCode('ROLE_RUNTIME_BINDING_DENIED'));
    }
  }
});

test('routing data are immutable and contain no execution permissions or credentials',()=>{
  assert.ok(Object.isFrozen(RUNTIME_PROFILES));
  assert.ok(Object.isFrozen(DEFAULT_ROLE_RUNTIME_ASSIGNMENTS));
  for(const profile of Object.values(RUNTIME_PROFILES)){
    assert.ok(Object.isFrozen(profile));
    for(const key of ['apiKey','auth','token','permissions','tools','sandbox','approvalPolicy','budget','session'])assert.equal(Object.hasOwn(profile,key),false);
    assert.throws(()=>{profile.endpoint='https://example.invalid';},TypeError);
  }
  const selected=assignment(),before=structuredClone(selected);
  getRoleRuntimeProfile('designer',selected);
  validateRoleRuntimeBinding(binding('designer',RUNTIME_PROFILES.minimax_opencode),selected);
  assert.deepEqual(selected,before);
  assert.throws(()=>{DEFAULT_ROLE_RUNTIME_ASSIGNMENTS.qa='deepseek_opencode';},TypeError);
});

test('unknown input fails with stable codes and never includes supplied values',()=>{
  for(const role of ['__proto__','constructor','unknown',null])assert.throws(()=>getRoleRuntimeProfile(role),hasCode('ROLE_RUNTIME_ROLE_UNKNOWN'));
  for(const value of [null,undefined,[],false])assert.throws(()=>validateRoleRuntimeBinding(value),hasCode('ROLE_RUNTIME_BINDING_DENIED'));
  const secret='PRIVATE_VALUE_DO_NOT_LOG';
  assert.throws(()=>getRoleRuntimeProfile('pm',{...assignment(),pm:secret}),error=>hasCode('ROLE_RUNTIME_ASSIGNMENTS_INVALID')(error)&&!JSON.stringify(error).includes(secret));
  assert.throws(()=>validateRoleRuntimeBinding({...binding('designer',RUNTIME_PROFILES.minimax_opencode),endpoint:'https://example.invalid/'+secret},assignment()),error=>hasCode('ROLE_RUNTIME_BINDING_DENIED')(error)&&!error.message.includes(secret));
});
