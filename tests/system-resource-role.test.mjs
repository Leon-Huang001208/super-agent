import test from'node:test';import assert from'node:assert/strict';import{validateResourceScope,RESOURCE_ROLE_INSTRUCTIONS}from'../bridge/system-resource-role.mjs';
test('System Resource Engineer admits physical resource observations, never database or destructive work',()=>{
 assert.equal(validateResourceScope({topics:['internal-disk','external-disks','memory','swap','cpu','io'],actions:['observe','diagnose','report']}).topics.length,6);
 for(const scope of [{topics:['database-schema'],actions:['report']},{topics:['volumes'],actions:['format']},{topics:['caches'],actions:['delete']},{topics:['memory'],actions:['stop-task']}])assert.throws(()=>validateResourceScope(scope),/RESOURCE_ROLE_SCOPE_DENIED/);
 assert.match(RESOURCE_ROLE_INSTRUCTIONS,/2BC466D2-FD62-4395-86AC-45CFF653BC51/);assert.match(RESOURCE_ROLE_INSTRUCTIONS,/不迁移数据库/);
});
