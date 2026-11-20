/** Explicit owner-authorized tier change; no task creation, budget rewrite or model work. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {ROLE_ROOT,readControl,editRoleRegistry} from '../bridge/role-control-store.mjs';
import {grantComplexTaskBudget,rootCallLimit} from '../bridge/task-call-policy.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';

async function main(){
 const args=process.argv.slice(2),apply=args.includes('--apply'),taskId=args[args.indexOf('--task-id')+1],approvalSource=args[args.indexOf('--approval-source')+1];
 if(!args.includes('--task-id')||!args.includes('--approval-source')||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(taskId??'')||
  args.some((arg,i)=>!['--task-id','--approval-source','--apply'].includes(arg)&&args[i-1]!=='--task-id'&&args[i-1]!=='--approval-source'))throw Error('NATIVE_ROLE_TASK_BUDGET_ARGUMENTS_DENIED');
 const before=readControl(ROLE_ROOT+'/registry.json'),api=await createRoleOwnerApi({registry:before,requirePaused:apply});
 try{
  const task=await api.request('/issues/'+taskId),next=grantComplexTaskBudget(before,{task,approvalSource});
  if(apply)editRoleRegistry(current=>{
   if(!isDeepStrictEqual(current,before))throw Error('NATIVE_ROLE_TASK_BUDGET_REGISTRY_CHANGED');
   return next;
  });
  console.log(JSON.stringify({status:apply?'applied':'preview',rootTaskId:taskId,maximum:rootCallLimit(next,taskId),originalCallsPreserved:true,newModelCalls:0}));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({code:/^(?:ROLE|NATIVE_ROLE)_[A-Z_]+$/.test(error?.code??error?.message)?(error.code??error.message):'NATIVE_ROLE_TASK_BUDGET_FAILED'}));process.exitCode=1;});
