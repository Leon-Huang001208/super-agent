/** Explicit owner-authorized allocation; no task creation, spent-call rewrite or model work. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {ROLE_ROOT,readControl,editRoleRegistry} from '../bridge/role-control-store.mjs';
import {grantComplexTaskBudget,rootCallLimit} from '../bridge/task-call-policy.mjs';
import {createRoleOwnerApi} from './role-owner-api.mjs';

export function parseTaskCallBudgetArguments(args){
 const fail=()=>{throw Error('NATIVE_ROLE_TASK_BUDGET_ARGUMENTS_DENIED');};
 if(!Array.isArray(args))fail();
 const values=new Map();let apply=false;
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(key==='--apply'){if(apply)fail();apply=true;continue;}
  if(!['--task-id','--approval-source','--maximum'].includes(key)||values.has(key)||typeof args[i+1]!=='string'||args[i+1].startsWith('--'))fail();
  values.set(key,args[++i]);
 }
 const taskId=values.get('--task-id'),approvalSource=values.get('--approval-source');
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(taskId??'')||typeof approvalSource!=='string'||!approvalSource.trim()||(values.get('--maximum')??'20')!=='20')fail();
 return{apply,taskId,approvalSource,maximum:20};
}

async function main(){
 const {apply,taskId,approvalSource,maximum}=parseTaskCallBudgetArguments(process.argv.slice(2));
 const before=readControl(ROLE_ROOT+'/registry.json'),api=await createRoleOwnerApi({registry:before,requirePaused:apply});
 try{
  const task=await api.request('/issues/'+taskId),next=grantComplexTaskBudget(before,{task,approvalSource,maximum});
  if(apply)editRoleRegistry(current=>{
   if(!isDeepStrictEqual(current,before))throw Error('NATIVE_ROLE_TASK_BUDGET_REGISTRY_CHANGED');
   return next;
  });
  console.log(JSON.stringify({status:apply?'applied':'preview',rootTaskId:taskId,maximum:rootCallLimit(next,taskId),originalCallsPreserved:true,newModelCalls:0}));
 }finally{await api.close();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({code:/^(?:ROLE|NATIVE_ROLE)_[A-Z_]+$/.test(error?.code??error?.message)?(error.code??error.message):'NATIVE_ROLE_TASK_BUDGET_FAILED'}));process.exitCode=1;});
