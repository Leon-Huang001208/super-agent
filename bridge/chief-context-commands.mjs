import { createHash } from 'node:crypto';
import { ROLE_KEYS } from './role-labels.mjs';

const fail = code => { throw Object.assign(new Error(code), {code}); };
const identifier = /^[A-Z][A-Z0-9]{1,15}-[1-9]\d{0,8}$/;
const key = /^[\p{L}\p{N}_-]{1,64}$/u;
const aliases = new Map([
  ['new','new'],['新建','new'],['projects','projects'],['项目列表','projects'],
  ['project','select_project'],['项目','select_project'],['切换','select_project'],
  ['status','status'],['状态','status'],['continue','continue'],['继续','continue'],
  ['pause','pause'],['暂停','pause'],['add','append'],['append','append'],['补充','append'],
  ['followup','followup'],['后续','followup'],['remember','remember'],['记住','remember'],
  ['correct','correct'],['更正','correct'],['memory','memory'],['记忆','memory'],
  ['memory-history','memory_history'],['记忆历史','memory_history'],['share','share'],['共享','share'],
]);
const normal = value => value.normalize('NFKC').toLowerCase();
function word(text) {
  const value=text.trim(), match=/^(\S+)(?:\s+([\s\S]*))?$/.exec(value);
  return match ? {first:match[1],rest:match[2]??''} : {first:'',rest:''};
}
function label(value) {
  const result=normal(value);
  if(!key.test(result))fail('CHIEF_CONTEXT_MEMORY_KEY_INVALID');
  return result;
}
function project(value) {
  const result=normal(value);
  if(!key.test(result))fail('CHIEF_CONTEXT_PROJECT_INVALID');
  return result;
}
function task(value) {
  const result=value.toUpperCase();
  if(!identifier.test(result))fail('CHIEF_CONTEXT_COMMAND_INVALID');
  return result;
}
function body(value) {
  const result=value.trim();
  if(!result||result.length>12000)fail('CHIEF_CONTEXT_COMMAND_INVALID');
  return result;
}
function optionalTask(value, requiresText) {
  const part=word(value),id=part.first.toUpperCase();
  if(requiresText&&part.first==='--')return {text:body(part.rest)};
  if(identifier.test(id))return {taskIdentifier:id,...(requiresText?{text:body(part.rest)}:{})};
  if(/^[A-Z][A-Z0-9]{1,15}-\d/.test(id))fail('CHIEF_CONTEXT_COMMAND_INVALID');
  if(!requiresText){if(value.trim())fail('CHIEF_CONTEXT_COMMAND_INVALID');return {};}
  return {text:body(value)};
}

/** Stable label identity only; it does not encode scope or authorize a write. */
export function contextMemoryId(value) {
  if(typeof value!=='string')fail('CHIEF_CONTEXT_MEMORY_KEY_INVALID');
  return 'owner-'+createHash('sha256').update(label(value)).digest('hex').slice(0,24);
}

/** Pure syntax. Authentication, current-task resolution and policy stay in Native. */
export function parseChiefContextCommand(text) {
  if(typeof text!=='string')fail('CHIEF_CONTEXT_COMMAND_INVALID');
  if(!/^\/chief(?:[ \t\r\n]|$)/.test(text))return null;
  if(text.length>16000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))fail('CHIEF_CONTEXT_COMMAND_INVALID');
  let rest=text.slice(6).trim(),projectKeyOrAlias,reviewBeforeDispatch=false;
  while(rest.startsWith('--')) {
    const flag=word(rest);rest=flag.rest;
    if(flag.first==='--project') {
      if(projectKeyOrAlias!==undefined)fail('CHIEF_CONTEXT_COMMAND_INVALID');
      const p=word(rest);if(!p.first||p.first.startsWith('--'))fail('CHIEF_CONTEXT_COMMAND_INVALID');
      projectKeyOrAlias=project(p.first);rest=p.rest;
    } else if(flag.first==='--plan-first') {
      if(reviewBeforeDispatch)fail('CHIEF_CONTEXT_COMMAND_INVALID');reviewBeforeDispatch=true;
    } else fail('CHIEF_CONTEXT_OPTION_DENIED');
  }
  if(!rest){if(projectKeyOrAlias||reviewBeforeDispatch)fail('CHIEF_CONTEXT_COMMAND_INVALID');return Object.freeze({kind:'help'});}
  const first=word(rest),kind=aliases.get(normal(first.first))??'new';
  const tail=aliases.has(normal(first.first))?first.rest:rest;
  if(reviewBeforeDispatch&&!['new','followup'].includes(kind))fail('CHIEF_CONTEXT_OPTION_DENIED');
  if(projectKeyOrAlias&&['projects','select_project','help'].includes(kind))fail('CHIEF_CONTEXT_OPTION_DENIED');
  let result;
  if(kind==='new')result={kind,goal:body(tail),...(reviewBeforeDispatch&&{reviewBeforeDispatch:true})};
  else if(kind==='projects'){if(tail.trim())fail('CHIEF_CONTEXT_COMMAND_INVALID');result={kind};}
  else if(kind==='select_project')result=tail.trim()?{kind,projectKeyOrAlias:project(tail.trim())}:{kind:'projects'};
  else if(['status','continue','pause'].includes(kind)) {
    const p=word(tail);if(p.rest)fail('CHIEF_CONTEXT_COMMAND_INVALID');
    result={kind,...(p.first&&{taskIdentifier:task(p.first)})};
  } else if(['append','followup'].includes(kind)) {
    const parts=optionalTask(tail,true);
    result={kind,...(parts.taskIdentifier&&{taskIdentifier:parts.taskIdentifier}),[kind==='append'?'text':'goal']:parts.text,
      ...(reviewBeforeDispatch&&{reviewBeforeDispatch:true})};
  } else if(['remember','correct','memory','memory_history'].includes(kind)) {
    let value=tail,role,expectedVersion;
    while(value.startsWith('--')) {
      const option=word(value),arg=word(option.rest);value=arg.rest;
      if(option.first==='--role'&&role===undefined&&ROLE_KEYS.includes(arg.first))role=arg.first;
      else if(option.first==='--role')fail('CHIEF_CONTEXT_ROLE_INVALID');
      else if(option.first==='--version'&&kind==='correct'&&expectedVersion===undefined&&/^[1-9]\d{0,8}$/.test(arg.first))expectedVersion=Number(arg.first);
      else fail('CHIEF_CONTEXT_OPTION_DENIED');
    }
    const p=word(value);
    if(['remember','correct'].includes(kind)) {
      const contents=body(p.rest);if(Buffer.byteLength(contents)>16384)fail('CHIEF_CONTEXT_COMMAND_INVALID');
      result={kind,key:label(p.first),text:contents};
    } else {
      if(p.rest||kind==='memory_history'&&!p.first)fail('CHIEF_CONTEXT_COMMAND_INVALID');
      result={kind,...(p.first&&{key:label(p.first)})};
    }
    if(role)result.role=role;if(expectedVersion!==undefined)result.expectedVersion=expectedVersion;
  } else if(kind==='share') {
    const from=word(tail),to=word(from.rest);
    if(from.first.startsWith('--'))fail('CHIEF_CONTEXT_OPTION_DENIED');
    if(!to.first||to.rest)fail('CHIEF_CONTEXT_COMMAND_INVALID');
    result={kind,key:label(from.first),targetProjectKeyOrAlias:project(to.first)};
  } else fail('CHIEF_CONTEXT_COMMAND_INVALID');
  if(projectKeyOrAlias)result.projectKeyOrAlias=projectKeyOrAlias;
  return Object.freeze(result);
}
