import { installNativeRoles,database } from '../bridge/native-role-runtime.mjs';
import { installRoleInstructionHook } from './role-instruction-hook.mjs';
import { ensureRoleArtifactWorkspaceHook } from './role-artifact-workspace-hook.mjs';
import fs from 'node:fs';
import {ROLE_ROOT,readControl} from '../bridge/role-control-store.mjs';
import {reconcileRoleInstructionMutation} from '../bridge/role-instruction-store.mjs';
if(process.argv[1]==='/opt/super-agent/serve.mjs'&&process.env.SUPER_AGENT_ROLE_RUNTIME_ENABLED==='true'){
 if(fs.existsSync(ROLE_ROOT+'/registry.json')){
  const registry=readControl(ROLE_ROOT+'/registry.json');
  for(const entry of registry.agents)if(entry.instructionMutation)await reconcileRoleInstructionMutation({companyId:registry.companyId,agentId:entry.profile.agentId});
 }
 const hook=installRoleInstructionHook();
 try{
  await ensureRoleArtifactWorkspaceHook();
  for(const url of hook.moduleUrls)await import(url);
  hook.verify();
 }finally{hook.close();}
}
await installNativeRoles();
if(process.argv[1]==='/opt/super-agent/serve.mjs'&&process.env.SUPER_AGENT_TEAM_COORDINATOR_ENABLED==='true'){
 const {startTeamCoordinator}=await import('../bridge/team-native-runtime.mjs');
 startTeamCoordinator({database});
 if(process.env.SUPER_AGENT_CHIEF_FEISHU_ENABLED==='true'){
  const {startChiefFeishuService}=await import('../bridge/chief-feishu-service.mjs');
  await startChiefFeishuService({database});
 }
}
