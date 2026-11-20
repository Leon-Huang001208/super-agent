import {spawnSync} from 'node:child_process';

/** Reuse the existing Native host proxy policy; no global settings or credentials are changed. */
export function hostProxyEnvironment({env=process.env,platform=process.platform,probe=spawnSync}={}){
 const selected={};for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'])if(env[key])selected[key]=env[key];
 if(!selected.HTTPS_PROXY&&platform==='darwin'){
  const observed=probe('/usr/sbin/scutil',['--proxy'],{encoding:'utf8',timeout:3000});
  const host=observed.stdout?.match(/HTTPSProxy\s*:\s*([^\s]+)/)?.[1],port=observed.stdout?.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
  if(/HTTPSEnable\s*:\s*1/.test(observed.stdout??'')&&host==='127.0.0.1'&&port)selected.HTTPS_PROXY=selected.HTTP_PROXY='http://127.0.0.1:'+port;
 }
 return {...selected,NO_PROXY:[...new Set(['127.0.0.1','localhost','mac-mini-1.tail947973.ts.net',...(env.NO_PROXY??'').split(',').filter(Boolean)])].join(','),NODE_USE_ENV_PROXY:'1'};
}
