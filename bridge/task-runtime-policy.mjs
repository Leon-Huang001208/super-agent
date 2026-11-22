import {ROLE_KEYS} from './role-labels.mjs';
import {RUNTIME_PROFILES} from './role-runtime-profiles.mjs';

const CORE_ROLES=new Set(['chief','pm','architect','qa']);
const FIELDS=new Set(['role','complexity','risk','purpose','profileId']);
const COMPLEXITIES=new Set(['routine','complex','unknown']);
const RISKS=new Set(['low','high','unknown']);
const PURPOSES=new Set(['execution','research','cross-check']);
const fail=code=>{throw Object.assign(Error(code),{code});};

/**
 * Pure selection for trusted Controller/Chief plan metadata. The result grants no
 * permission and applies no binding; callers enforce task-start/handoff, identity,
 * evidence, accumulated budgets and existing session contracts separately.
 */
export function selectTaskRuntimeProfile(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(input))||
      Object.keys(input).some(key=>!FIELDS.has(key)))fail('TASK_RUNTIME_POLICY_INVALID');
  const {role,profileId}=input;
  if(!ROLE_KEYS.includes(role))fail('TASK_RUNTIME_ROLE_UNKNOWN');
  const complexity=input.complexity===undefined?'unknown':input.complexity;
  const risk=input.risk===undefined?'unknown':input.risk;
  const purpose=input.purpose===undefined?'execution':input.purpose;
  if(!COMPLEXITIES.has(complexity)||!RISKS.has(risk)||!PURPOSES.has(purpose))fail('TASK_RUNTIME_POLICY_INVALID');
  if(profileId!==undefined&&(typeof profileId!=='string'||!Object.hasOwn(RUNTIME_PROFILES,profileId)))fail('TASK_RUNTIME_PROFILE_DENIED');

  let profile=RUNTIME_PROFILES.codex_subscription,reason;
  if(CORE_ROLES.has(role))reason='core_role';
  else if(risk==='high')reason='high_risk';
  else if(complexity==='complex')reason='complex_task';
  else if(complexity==='unknown'||risk==='unknown')reason='unknown_task';
  else if(purpose==='research'){
    profile=RUNTIME_PROFILES.deepseek_opencode;reason='routine_research';
  }else if(purpose==='cross-check'){
    profile=RUNTIME_PROFILES.deepseek_opencode;reason='routine_cross_check';
  }else{
    profile=RUNTIME_PROFILES.minimax_opencode;reason='routine_execution';
  }

  if(profileId!==undefined){
    const selected=RUNTIME_PROFILES[profileId];
    if(profile===RUNTIME_PROFILES.codex_subscription&&selected!==profile)fail('TASK_RUNTIME_PROFILE_CONFLICT');
    if(profile!==RUNTIME_PROFILES.codex_subscription)reason='explicit_profile';
    profile=selected;
  }
  return Object.freeze({profile,reason});
}
