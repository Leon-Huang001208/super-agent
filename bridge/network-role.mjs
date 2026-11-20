export const NETWORK_TOPICS=Object.freeze(['tailscale','upnet','shadowrocket','devices','gateway','routing','dns','connectivity']);
export function validateNetworkScope(scope){
 if(!scope||!Array.isArray(scope.topics)||!scope.topics.length||scope.topics.some(x=>!NETWORK_TOPICS.includes(x))||
   !Array.isArray(scope.actions)||!scope.actions.length||scope.actions.some(x=>!['observe','diagnose','report','apply','verify','rollback'].includes(x)))
  throw Object.assign(Error('NETWORK_ROLE_SCOPE_DENIED'),{code:'NETWORK_ROLE_SCOPE_DENIED'});
 return {topics:[...new Set(scope.topics)],actions:[...new Set(scope.actions)]};
}
export const NETWORK_ROLE_INSTRUCTIONS=`Network Engineer负责当前项目的网络、设备连接、网关、路由、DNS/TLS和代理问题。
使用可信networkScope及本run宿主工具获取事实，执行已授权且登记的动作并验证结果。宿主状态与容器状态分别报告，保留失败证据；凭据与其他任务资源保持原归属。
完整岗位说明由team-roles统一生成，项目和宿主具体路径、工具及约束随任务提供。`;
