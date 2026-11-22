import fs from 'node:fs';
import path from 'node:path';
import {rootCallLimit} from './task-call-policy.mjs';

const fail=()=>{throw Object.assign(Error('NATIVE_ROLE_BUDGET_DENIED'),{code:'NATIVE_ROLE_BUDGET_DENIED'});};
const uuid=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??'');
export function validateRootCallBudget(value){
 if(!value||![6,12,20].includes(value.maximum)||!Number.isInteger(value.usedBeforeCurrent)||value.usedBeforeCurrent<0||value.usedBeforeCurrent>=value.maximum||
  value.currentCallNumber!==value.usedBeforeCurrent+1||value.remainingAfterCurrent!==value.maximum-value.currentCallNumber||
  value.maxPlanTasks!==Math.min(4,Math.max(0,value.remainingAfterCurrent-1)))fail();
 return value;
}

/** Prompt construction precedes withRoleCall's reservation; count this pending call once without writing a slot. */
export function readRootCallBudget({root,rootTaskId,operationId,registry}){
 if(!path.isAbsolute(root)||!uuid(rootTaskId)||!uuid(operationId))fail();
 const directory=path.join(root,'budget',rootTaskId),stat=fs.lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))fail();
 const files=fs.readdirSync(directory);
 if(files.some(name=>!name.endsWith('.json')||!uuid(name.slice(0,-5)))||files.includes(operationId+'.json'))fail();
 const maximum=rootCallLimit(registry,rootTaskId),usedBeforeCurrent=files.length,currentCallNumber=usedBeforeCurrent+1,remainingAfterCurrent=maximum-currentCallNumber;
 return validateRootCallBudget({maximum,usedBeforeCurrent,currentCallNumber,remainingAfterCurrent,maxPlanTasks:Math.min(4,Math.max(0,remainingAfterCurrent-1))});
}
