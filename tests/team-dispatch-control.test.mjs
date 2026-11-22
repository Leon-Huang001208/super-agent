import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchControlArgs,planDispatchControl} from '../bridge/team-dispatch-control.mjs';

const fixture=()=>({registry:{ownerId:'owner',companyId:'company',team:{enabled:true,ids:{chief:'chief'}},operations:[{id:'spent'}]},activeRuns:[],leases:[],callLock:false});
test('owner maintenance changes only the dispatch boolean and preserves spent operations',()=>{
 const input=fixture(),before=structuredClone(input.registry);
 const paused=planDispatchControl({...input,expectedRegistry:before,enabled:false});
 assert.equal(paused.team.enabled,false);assert.deepEqual({...paused,team:{...paused.team,enabled:true}},before);assert.deepEqual(input.registry,before);
 assert.deepEqual(planDispatchControl({...input,registry:paused,expectedRegistry:paused,enabled:true}),before);
});
test('running, queued, unknown lease, call lock and changed registry all deny a write',()=>{
 const input=fixture();
 for(const patch of [{activeRuns:[{id:'queued'}]},{callLock:true},{leases:[{status:'active'}]},
  {leases:[{status:'released',releasedAt:'now',cleanupStatus:'failed'}]},{expectedRegistry:{...input.registry,ownerId:'other'}}]){
  assert.throws(()=>planDispatchControl({...input,expectedRegistry:input.registry,enabled:false,...patch}),/TEAM_DISPATCH_CONTROL_/);
 }
 assert.equal(planDispatchControl({...input,expectedRegistry:input.registry,enabled:false,leases:[{status:'released',releasedAt:'now'}]}).team.enabled,false);
});
test('apply requires a stable operation, exact state hash and explicit owner authorization source',()=>{
 const valid=['--action','pause','--operation-id','11111111-1111-1111-1111-111111111111','--expected-registry-sha256','a'.repeat(64),'--approval-source','owner budget20','--apply'];
 assert.equal(dispatchControlArgs(valid).apply,true);assert.equal(dispatchControlArgs(['--action','status']).apply,false);
 for(const args of [['--action','status','--apply'],['--action','pause','--apply'],[...valid,'--apply'],[...valid,'--arbitrary','value']])assert.throws(()=>dispatchControlArgs(args),/ARGUMENTS_INVALID/);
});
