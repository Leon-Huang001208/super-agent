import fs from 'node:fs';
import path from 'node:path';

const fail=()=>{throw Object.assign(Error('NATIVE_ROLE_BUDGET_DENIED'),{code:'NATIVE_ROLE_BUDGET_DENIED'});};
const uuid=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??'');
export function validateRootCallBudget(value){
 if(!value||value.maximum!==6||!Number.isInteger(value.usedBeforeCurrent)||value.usedBeforeCurrent<0||value.usedBeforeCurrent>=6||
  value.currentCallNumber!==value.usedBeforeCurrent+1||value.remainingAfterCurrent!==6-value.currentCallNumber||
  value.maxPlanTasks!==Math.min(4,Math.max(0,value.remainingAfterCurrent-1)))fail();
 return value;
}

/** Prompt construction precedes withRoleCall's reservation; count this pending call once without writing a slot. */
export function readRootCallBudget({root,rootTaskId,operationId}){
 if(!path.isAbsolute(root)||!uuid(rootTaskId)||!uuid(operationId))fail();
 const directory=path.join(root,'budget',rootTaskId),stat=fs.lstatSync(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))fail();
 const files=fs.readdirSync(directory);
 if(files.some(name=>!name.endsWith('.json')||!uuid(name.slice(0,-5)))||files.includes(operationId+'.json'))fail();
 const usedBeforeCurrent=files.length,currentCallNumber=usedBeforeCurrent+1,remainingAfterCurrent=6-currentCallNumber;
 return validateRootCallBudget({maximum:6,usedBeforeCurrent,currentCallNumber,remainingAfterCurrent,maxPlanTasks:Math.min(4,Math.max(0,remainingAfterCurrent-1))});
}
