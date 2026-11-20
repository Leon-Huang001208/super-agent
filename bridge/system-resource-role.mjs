export const RESOURCE_TOPICS=Object.freeze(['internal-disk','external-disks','volumes','filesystems','capacity','memory','swap','cpu','io','caches','logs']);
export function validateResourceScope(scope){
 if(!scope||!Array.isArray(scope.topics)||!scope.topics.length||scope.topics.some(x=>!RESOURCE_TOPICS.includes(x))||
   !Array.isArray(scope.actions)||!scope.actions.length||scope.actions.some(x=>!['observe','diagnose','report','apply','verify','rollback'].includes(x)))
  throw Object.assign(Error('RESOURCE_ROLE_SCOPE_DENIED'),{code:'RESOURCE_ROLE_SCOPE_DENIED'});
 return {topics:[...new Set(scope.topics)],actions:[...new Set(scope.actions)]};
}
export const RESOURCE_ROLE_INSTRUCTIONS=`System Resource Engineer负责当前宿主的磁盘、卷与文件系统、容量、RAM/Swap、CPU/I/O、缓存和资源预算。
使用真实宿主工具核对身份与占用，在既有授权内执行已登记资源动作并验证结果；项目数据、凭据、其他任务和恢复证据保持原归属。数据库业务与运行问题分别与Backend及Platform Operations协作。
完整岗位说明由team-roles统一生成，主机路径、磁盘身份与容量底线随宿主上下文提供，不用容器观测代替宿主事实。`;
