import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLE_KEYS} from '../bridge/role-labels.mjs';
import {RUNTIME_PROFILES,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS,getRoleRuntimeProfile} from '../bridge/role-runtime-profiles.mjs';
import {selectTaskRuntimeProfile} from '../bridge/task-runtime-policy.mjs';

const routine=role=>({role,complexity:'routine',risk:'low',purpose:'execution'});
const hasCode=code=>error=>error.code===code&&error.message===code;

test('Chief, PM, Architect and independent QA stay on Codex for all task classifications',()=>{
 for(const role of ['chief','pm','architect','qa']){
  for(const purpose of ['execution','research','cross-check']){
   const chosen=selectTaskRuntimeProfile({...routine(role),purpose});
   assert.equal(chosen.profile,RUNTIME_PROFILES.codex_subscription);assert.equal(chosen.reason,'core_role');
   for(const profileId of ['deepseek_opencode','minimax_opencode'])assert.throws(()=>selectTaskRuntimeProfile({...routine(role),purpose,profileId}),hasCode('TASK_RUNTIME_PROFILE_CONFLICT'));
  }
 }
});

test('execution roles choose by the task instead of their initial binding snapshot',()=>{
 for(const role of ROLE_KEYS.filter(value=>!['chief','pm','architect','qa'].includes(value))){
  assert.equal(getRoleRuntimeProfile(role,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS),RUNTIME_PROFILES.codex_subscription);
  assert.equal(selectTaskRuntimeProfile(routine(role)).profile,RUNTIME_PROFILES.minimax_opencode);
  assert.equal(selectTaskRuntimeProfile({...routine(role),purpose:'research'}).profile,RUNTIME_PROFILES.deepseek_opencode);
  assert.equal(selectTaskRuntimeProfile({...routine(role),purpose:'cross-check'}).profile,RUNTIME_PROFILES.deepseek_opencode);
  assert.equal(selectTaskRuntimeProfile({...routine(role),complexity:'complex'}).profile,RUNTIME_PROFILES.codex_subscription);
  assert.equal(getRoleRuntimeProfile(role,DEFAULT_ROLE_RUNTIME_ASSIGNMENTS),RUNTIME_PROFILES.codex_subscription);
 }
 assert.equal(selectTaskRuntimeProfile(routine('backend-engineer')).reason,'routine_execution');
 assert.equal(selectTaskRuntimeProfile({...routine('research'),purpose:'research'}).reason,'routine_research');
 assert.equal(selectTaskRuntimeProfile({...routine('document-specialist'),purpose:'cross-check'}).reason,'routine_cross_check');
});

test('complex, high-risk and unknown classifications conservatively select Codex',()=>{
 for(const change of [{complexity:'complex'},{risk:'high'},{complexity:'unknown'},{risk:'unknown'},
  {complexity:undefined},{risk:undefined}]){
  const task={...routine('backend-engineer'),...change};
  assert.equal(selectTaskRuntimeProfile(task).profile,RUNTIME_PROFILES.codex_subscription);
  for(const profileId of ['deepseek_opencode','minimax_opencode'])assert.throws(()=>selectTaskRuntimeProfile({...task,profileId}),hasCode('TASK_RUNTIME_PROFILE_CONFLICT'));
 }
 assert.equal(selectTaskRuntimeProfile({role:'designer'}).profile,RUNTIME_PROFILES.codex_subscription);
 assert.equal(selectTaskRuntimeProfile({...routine('devops'),risk:'high'}).reason,'high_risk');
 assert.equal(selectTaskRuntimeProfile({...routine('frontend-engineer'),complexity:'complex'}).reason,'complex_task');
 assert.equal(selectTaskRuntimeProfile({...routine('network-engineer'),risk:'unknown'}).reason,'unknown_task');
});

test('explicit safe selections are canonical and conflicts never silently fall back',()=>{
 for(const profileId of Object.keys(RUNTIME_PROFILES)){
  const chosen=selectTaskRuntimeProfile({...routine('backend-engineer'),profileId});
  assert.equal(chosen.profile,RUNTIME_PROFILES[profileId]);assert.equal(chosen.reason,'explicit_profile');
 }
 assert.equal(selectTaskRuntimeProfile({...routine('qa'),profileId:'codex_subscription'}).reason,'core_role');
 assert.throws(()=>selectTaskRuntimeProfile({...routine('qa'),profileId:'minimax_opencode'}),hasCode('TASK_RUNTIME_PROFILE_CONFLICT'));
 for(const profileId of ['',null,'__proto__','constructor','unknown-profile',{}])assert.throws(()=>selectTaskRuntimeProfile({...routine('research'),profileId}),hasCode('TASK_RUNTIME_PROFILE_DENIED'));
});

test('the policy returns only immutable canonical data and a bounded reason code',()=>{
 const input=routine('document-specialist'),before=structuredClone(input),chosen=selectTaskRuntimeProfile(input);
 assert.deepEqual(input,before);assert.deepEqual(Object.keys(chosen).sort(),['profile','reason']);
 assert.ok(Object.isFrozen(chosen));assert.ok(Object.isFrozen(chosen.profile));
 for(const key of ['session','sessionId','budget','callBudget','taskId','permissions','tools','handoff']){
  assert.equal(Object.hasOwn(chosen,key),false);assert.equal(Object.hasOwn(chosen.profile,key),false);
  assert.throws(()=>selectTaskRuntimeProfile({...input,[key]:'untrusted'}),hasCode('TASK_RUNTIME_POLICY_INVALID'));
 }
});

test('malformed policy metadata fails with stable codes without echoing arbitrary input',()=>{
 for(const input of [null,undefined,[],false])assert.throws(()=>selectTaskRuntimeProfile(input),hasCode('TASK_RUNTIME_POLICY_INVALID'));
 for(const role of ['unknown','general','__proto__',null])assert.throws(()=>selectTaskRuntimeProfile({...routine('research'),role}),hasCode('TASK_RUNTIME_ROLE_UNKNOWN'));
 const secret='PRIVATE_INPUT_DO_NOT_LOG';
 for(const field of ['complexity','risk','purpose'])assert.throws(()=>selectTaskRuntimeProfile({...routine('research'),[field]:secret}),error=>hasCode('TASK_RUNTIME_POLICY_INVALID')(error)&&!JSON.stringify(error).includes(secret));
 assert.throws(()=>selectTaskRuntimeProfile({...routine('research'),profileId:secret}),error=>hasCode('TASK_RUNTIME_PROFILE_DENIED')(error)&&!error.message.includes(secret));
});
