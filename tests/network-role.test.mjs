import test from'node:test';import assert from'node:assert/strict';import{NETWORK_ROLE_INSTRUCTIONS,validateNetworkScope}from'../bridge/network-role.mjs';import{selectRoleKnowledge}from'../bridge/role-materials.mjs';
test('dedicated network role accepts task-scoped network actions and rejects arbitrary commands',()=>{
 assert.deepEqual(validateNetworkScope({topics:['tailscale','upnet','shadowrocket','gateway'],actions:['observe','diagnose','report']}).actions,['observe','diagnose','report']);
 for(const scope of [{topics:['rwb-code'],actions:['report']},{topics:['routing'],actions:['change']},{topics:['gateway'],actions:['restart']},{topics:[],actions:['observe']}])assert.throws(()=>validateNetworkScope(scope),/NETWORK_ROLE_SCOPE_DENIED/);
 assert.deepEqual(validateNetworkScope({topics:['routing'],actions:['apply','verify','rollback']}).actions,['apply','verify','rollback']);
 assert.match(NETWORK_ROLE_INSTRUCTIONS,/可信networkScope/);assert.match(NETWORK_ROLE_INSTRUCTIONS,/已授权且登记的动作/);assert.match(NETWORK_ROLE_INSTRUCTIONS,/随任务提供/);
});
test('network role knowledge excludes research-private and other projects',()=>{
 const record={id:'policy',version:1,kind:'decision',condition:'network tasks',source:'owner-chat:2026-11-19',project:'personal-network',visibility:'project',text:'network only'};
 const result=selectRoleKnowledge({project:'personal-network',role:'network-engineer',records:[record,{...record,project:'research',text:'foreign'},{...record,id:'private',visibility:'private',role:'research',text:'research-private'}]});assert.deepEqual(result.map(x=>x.text),['network only']);
});
