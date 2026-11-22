import {ROLE_KEYS} from './role-labels.mjs';

const fail=code=>{throw Object.assign(Error(code),{code});};
const plainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));

/** Fixed routing data only. Permissions, budgets and session policy remain owned by their existing contracts. */
export const RUNTIME_PROFILES=Object.freeze({
  codex_subscription:Object.freeze({
    id:'codex_subscription',adapterType:'codex_local',runtime:'codex',provider:'openai',
    model:'gpt-6.1-sol',providerModel:'gpt-6.1-sol',reasoningEffort:'low',
    credentialKind:'chatgpt-subscription',wireApi:'codex-responses',
    endpoint:'https://chatgpt.com/backend-api/codex',
  }),
  deepseek_opencode:Object.freeze({
    id:'deepseek_opencode',adapterType:'opencode_local',runtime:'opencode',provider:'deepseek',
    model:'deepseek/deepseek-flash',providerModel:'deepseek-flash',reasoningEffort:null,
    credentialKind:'api-key',wireApi:'chat-completions',
    endpoint:'https://api.deepseek.com/v1',
  }),
  minimax_opencode:Object.freeze({
    id:'minimax_opencode',adapterType:'opencode_local',runtime:'opencode',provider:'minimax',
    model:'minimax-cn-coding-plan/MiniMax-M3.1-Flash',providerModel:'MiniMax-M3.1-Flash',reasoningEffort:null,
    credentialKind:'coding-plan-api-key',wireApi:'anthropic-messages',
    endpoint:'https://api.minimax.cn/anthropic/v1',
  }),
  deepseek_claude:Object.freeze({
    id:'deepseek_claude',adapterType:'claude_local',runtime:'claude',provider:'deepseek',
    model:'deepseek-flash',providerModel:'deepseek-flash',reasoningEffort:null,
    credentialKind:'api-key',wireApi:'anthropic-messages',
    // The official Anthropic SDK base /anthropic appends /v1/messages.
    endpoint:'https://api.deepseek.com/anthropic/v1',
  }),
  minimax_claude:Object.freeze({
    id:'minimax_claude',adapterType:'claude_local',runtime:'claude',provider:'minimax',
    model:'MiniMax-M3.1-Flash',providerModel:'MiniMax-M3.1-Flash',reasoningEffort:null,
    credentialKind:'coding-plan-api-key',wireApi:'anthropic-messages',
    endpoint:'https://api.minimax.cn/anthropic/v1',
  }),
});

/** Initial/legacy current-binding snapshot only; task-runtime-policy selects each new task's runtime. */
export const DEFAULT_ROLE_RUNTIME_ASSIGNMENTS=Object.freeze(Object.fromEntries(ROLE_KEYS.map(role=>[role,'codex_subscription'])));

function validateAssignments(assignments){
  if(!plainObject(assignments)||Object.keys(assignments).length!==ROLE_KEYS.length||
      ROLE_KEYS.some(role=>!Object.hasOwn(assignments,role)||typeof assignments[role]!=='string'||
        !Object.hasOwn(RUNTIME_PROFILES,assignments[role])))fail('ROLE_RUNTIME_ASSIGNMENTS_INVALID');
}

/** Validate a trusted current-binding snapshot, not a role's permanent model preference or a new task's selection. */
export function getRoleRuntimeProfile(role,assignments){
  if(!ROLE_KEYS.includes(role))fail('ROLE_RUNTIME_ROLE_UNKNOWN');
  if(assignments===undefined)return RUNTIME_PROFILES.codex_subscription;
  validateAssignments(assignments);
  return RUNTIME_PROFILES[assignments[role]];
}

/** Return canonical routing metadata; callers log the stable error code without echoing supplied config. */
export function validateRoleRuntimeBinding(binding,assignments){
  if(!plainObject(binding))fail('ROLE_RUNTIME_BINDING_DENIED');
  const profile=getRoleRuntimeProfile(binding.role,assignments);
  if(binding.adapterType!==profile.adapterType||binding.model!==profile.model||binding.heartbeatEnabled!==false||
      (profile.reasoningEffort===null?binding.reasoningEffort!=null:binding.reasoningEffort!==profile.reasoningEffort)){
    fail('ROLE_RUNTIME_BINDING_DENIED');
  }
  for(const field of ['runtime','provider','providerModel','credentialKind','wireApi','endpoint']){
    if(Object.hasOwn(binding,field)&&binding[field]!==profile[field])fail('ROLE_RUNTIME_BINDING_DENIED');
  }
  return profile;
}
