import { installNativeRoles,database } from '../bridge/native-role-runtime.mjs';
await installNativeRoles();
if(process.argv[1]==='/opt/super-agent/serve.mjs'&&process.env.SUPER_AGENT_TEAM_COORDINATOR_ENABLED==='true'){
 const {startTeamCoordinator}=await import('../bridge/team-native-runtime.mjs');
 startTeamCoordinator({database});
 if(process.env.SUPER_AGENT_CHIEF_FEISHU_ENABLED==='true'){
  const {startChiefFeishuService}=await import('../bridge/chief-feishu-service.mjs');
  await startChiefFeishuService({database});
 }
}
