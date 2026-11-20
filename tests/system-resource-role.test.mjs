import test from'node:test';import assert from'node:assert/strict';import{validateResourceScope,RESOURCE_ROLE_INSTRUCTIONS}from'../bridge/system-resource-role.mjs';
test('System Resource Engineer accepts scoped resource actions and resolves host identity at task time',()=>{
 assert.equal(validateResourceScope({topics:['internal-disk','external-disks','memory','swap','cpu','io'],actions:['observe','diagnose','report']}).topics.length,6);
 for(const scope of [{topics:['database-schema'],actions:['report']},{topics:['volumes'],actions:['format']},{topics:['caches'],actions:['delete']},{topics:['memory'],actions:['stop-task']}])assert.throws(()=>validateResourceScope(scope),/RESOURCE_ROLE_SCOPE_DENIED/);
 assert.deepEqual(validateResourceScope({topics:['volumes'],actions:['apply','verify','rollback']}).actions,['apply','verify','rollback']);
 assert.match(RESOURCE_ROLE_INSTRUCTIONS,/真实宿主工具/);assert.match(RESOURCE_ROLE_INSTRUCTIONS,/身份.*随宿主上下文/);assert.match(RESOURCE_ROLE_INSTRUCTIONS,/已登记资源动作/);
 assert.doesNotMatch(RESOURCE_ROLE_INSTRUCTIONS,/2BC466D2|ResearchWorkbench|RWB/);
});
