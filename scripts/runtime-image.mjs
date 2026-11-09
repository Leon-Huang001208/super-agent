#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const INPUT_FILES = [
  ...[
  'Dockerfile.runtime', 'entrypoint.sh', 'bootstrap.mjs', 'serve.mjs',
  'server-entry.mjs', 'chief-web-app-hook.mjs', 'complete-lock.mjs', 'verify-install.mjs',
  'codex-hello-gate.mjs', 'codex-chief-web-gate.mjs', 'package.install.json', 'package-lock.install.json',
  ].map(name => 'docker/' + name),
  'bridge/chief-web-call-admission.mjs',
  'bridge/chief-web-evaluation.mjs',
  'bridge/chief-web-intent-authority.mjs',
  'bridge/chief-web-intent-consumer.mjs',
  'bridge/chief-web-native-store.mjs',
  'bridge/chief-web-paperclip-repository.mjs',
  'bridge/chief-web-paperclip.mjs',
  'bridge/chief-web-pilot.mjs',
  'bridge/chief-web-private-file.mjs',
  'bridge/chief-web-projection.mjs',
  'bridge/chief-web-real-engine.mjs',
  'bridge/chief-web-real-executor.mjs',
  'bridge/chief-web-real-executor-provider.mjs',
  'bridge/chief-web-real-intake.mjs',
  'bridge/chief-web-real-runtime.mjs',
  'bridge/chief-web-real-spool.mjs',
  'scripts/chief-web-real-executor.mjs',
  'bridge/chief-web-recovery-cli.mjs',
  'bridge/chief-web-recovery-entry.mjs',
  'bridge/chief-web-recovery-finalization.mjs',
  'bridge/chief-web-recovery-io.mjs',
  'bridge/chief-web-recovery-lease.mjs',
  'bridge/chief-web-recovery-native.mjs',
  'bridge/chief-web-recovery-publisher.mjs',
  'bridge/chief-web-recovery.mjs',
  'bridge/chief-web-routes.mjs',
  'bridge/chief-web-runtime-bootstrap.mjs',
  'bridge/chief-web-settlement.mjs',
  'bridge/chief-web-skipped-wake.mjs',
  'bridge/chief-web-supplement-evidence.mjs',
  'plugins/chief-web-pilot/manifest.js',
  'plugins/chief-web-pilot/package.json',
  'plugins/chief-web-pilot/worker.js',
  'plugins/chief-web-pilot/ui/index.js',
];
const PLATFORM = 'linux/arm64';
const ID = /^sha256:[0-9a-f]{64}$/;
const KEY = /^[0-9a-f]{64}$/;
const LABEL = 'io.super-agent.build-input-sha256';
const fail = code => { throw new Error(code); };
const same = (a,b) => ['dev','ino','size','mode','mtimeMs','ctimeMs'].every(k => a[k]===b[k]);

export function inputSnapshot(root) {
  const bin = path.join(root, 'docker/bin');
  if (fs.realpathSync(bin) !== bin) fail('UNSAFE_BUILD_INPUT');
  const names = fs.readdirSync(bin).map(n => {
    if (!/^[a-zA-Z0-9._-]+$/.test(n)) fail('UNSAFE_BUILD_INPUT');
    return 'docker/bin/' + n;
  });
  let total = 0;
  const files = [...INPUT_FILES, ...names].sort().map(name => {
    const file = path.join(root, name);
    if (fs.realpathSync(file) !== file) fail('UNSAFE_BUILD_INPUT');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const a = fs.fstatSync(fd);
      if (!a.isFile() || a.nlink !== 1 || (a.mode & 0o7000) || (total += a.size) > 16*1024**2) fail('UNSAFE_BUILD_INPUT');
      const bytes = fs.readFileSync(fd);
      if (bytes.length !== a.size || !same(a, fs.fstatSync(fd)) || !same(a, fs.lstatSync(file))) fail('BUILD_INPUT_CHANGED');
      return {name, mode: a.mode & 0o777, bytes};
    } finally { fs.closeSync(fd); }
  });
  const dockerfile = files.find(f => f.name === 'docker/Dockerfile.runtime').bytes.toString('utf8');
  const from = dockerfile.split(/\r?\n/).filter(l => /^\s*FROM\b/i.test(l));
  const base = from.length === 1 && /^FROM ([\w./:-]+@sha256:[0-9a-f]{64})$/.exec(from[0].trim())?.[1];
  if (!base) fail('PINNED_BASE_REQUIRED');
  const hash = createHash('sha256').update(JSON.stringify({schema:1,platform:PLATFORM,base}));
  for (const {name,mode,bytes} of files) hash.update(JSON.stringify([name,mode,bytes.length])).update(bytes);
  const key = hash.digest('hex');
  return {files,key,base,reference:'super-agent-paperclip-runtime:input-' + key};
}

function dockerCall(args, {building=false}={}) {
  const r = spawnSync('docker', args, {encoding:'utf8',timeout:building?600000:15000,maxBuffer:1024**2});
  if (r.error || r.signal) fail(building ? 'BUILD_OUTCOME_UNKNOWN' : 'DOCKER_OBSERVATION_FAILED');
  if (r.status !== 0) fail(building ? 'IMAGE_BUILD_FAILED' : 'DOCKER_OBSERVATION_FAILED');
  return r.stdout.trim();
}

export function exportedImageDigest(metadata) {
  const digest=metadata?.['containerimage.digest'];
  if (typeof digest!=='string' || !ID.test(digest)) fail('BUILD_IMAGE_ID_UNVERIFIED');
  return digest;
}

export const dockerDriver = {
  inspect(ref) {
    // Empty success is absence. A daemon/inspect error is not a cache miss.
    const ids = ref.includes('@sha256:') || ID.test(ref) ? null :
      dockerCall(['image','ls','--no-trunc','--filter','reference='+ref,'--format','{{.ID}}']).split('\n').filter(Boolean);
    if (ids && !ids.length) return null;
    if (ids && (new Set(ids).size !== 1 || !ID.test(ids[0]))) fail('IMAGE_REFERENCE_AMBIGUOUS');
    const format = '{{json .Id}}|{{json .Os}}|{{json .Architecture}}|{{with (index .Config "Labels")}}{{json (index . "'+LABEL+'")}}{{else}}null{{end}}';
    const parts = dockerCall(['image','inspect','--format',format,ref]).split('|').map(x => JSON.parse(x));
    if (parts.length !== 4 || !ID.test(parts[0]) || (ids && parts[0] !== ids[0])) fail('IMAGE_REFERENCE_CHANGED');
    return {id:parts[0],os:parts[1],architecture:parts[2],key:parts[3]};
  },
  build({context,metadataFile,reference,key}) {
    dockerCall(['build','--load','--pull=false','--platform',PLATFORM,'--label',LABEL+'='+key,
      '--metadata-file',metadataFile,'--tag',reference,'--file',path.join(context,'docker/Dockerfile.runtime'),context], {building:true});
    const s=fs.lstatSync(metadataFile);
    if (!s.isFile() || s.nlink!==1 || s.size>64*1024) fail('BUILD_IMAGE_ID_UNVERIFIED');
    const metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
    // Buildx's IID can be the config digest. A containerd image store
    // addresses the exported manifest/index, not that config object.
    const digest=exportedImageDigest(metadata);
    const built=dockerDriver.inspect(digest);
    if (!imageMatches(built,key)) fail('BUILD_IMAGE_ID_UNVERIFIED');
    return built.id;
  },
  references() {
    const ids = dockerCall(['container','ls','-aq','--no-trunc']).split('\n').filter(Boolean);
    if (ids.some(id => !KEY.test(id))) fail('CONTAINER_ID_INVALID');
    const counts = new Map();
    for (let i=0;i<ids.length;i+=50) {
      const refs = dockerCall(['container','inspect','--format','{{.Image}}',...ids.slice(i,i+50)]).split('\n');
      if (refs.length!==ids.slice(i,i+50).length || refs.some(x=>!ID.test(x))) fail('CONTAINER_IMAGE_UNKNOWN');
      for (const ref of refs) counts.set(ref,(counts.get(ref)??0)+1);
    }
    return counts;
  },
};

function checkState(state, create) {
  if (fs.realpathSync(path.dirname(state))!==path.dirname(state)) fail('IMAGE_STATE_ALIAS');
  if (!fs.existsSync(state) && create) fs.mkdirSync(state,{mode:0o700});
  if (!fs.existsSync(state)) return false;
  const s=fs.lstatSync(state);
  if (!s.isDirectory() || s.uid!==process.getuid() || (s.mode&0o777)!==0o700 || fs.realpathSync(state)!==state) fail('IMAGE_STATE_UNSAFE');
  return true;
}

function readRecord(filename, key, reference) {
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    const s=fs.fstatSync(fd);
    if (!s.isFile() || s.uid!==process.getuid() || s.nlink!==1 || (s.mode&0o777)!==0o600 || s.size>2048) fail('IMAGE_RECORD_UNSAFE');
    const d=JSON.parse(fs.readFileSync(fd,'utf8'));
    if (!same(s,fs.fstatSync(fd)) || !same(s,fs.lstatSync(filename)) ||
        d.schemaVersion!==1 || d.key!==key || d.reference!==reference || d.platform!==PLATFORM || !ID.test(d.imageId)) fail('IMAGE_RECORD_INVALID');
    return d;
  } finally { fs.closeSync(fd); }
}

function imageMatches(image, key) {
  return image && ID.test(image.id) && image.os==='linux' && image.architecture==='arm64' && image.key===key;
}

export function runImageAction({root,state,action,driver=dockerDriver,capacity,log}) {
  if (!['build','resolve','audit'].includes(action)) fail('IMAGE_ACTION_INVALID');
  if (action==='audit') {
    if (!checkState(state,false)) return {images:[],unknownImagesProtected:true};
    const references=driver.references();
    return {images:fs.readdirSync(state).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort().map(name=>{
      const key=name.slice(0,-5),reference='super-agent-paperclip-runtime:input-'+key;
      const record=readRecord(path.join(state,name),key,reference);
      const image=driver.inspect(reference),count=references.get(record.imageId)??0;
      return {key,imageId:record.imageId,containers:count,retirement:count?'KEEP_REFERENCED':
        imageMatches(image,key)&&image.id===record.imageId?'REVIEW_REQUIRED':'KEEP_UNKNOWN'};
    }),unknownImagesProtected:true};
  }
  const input=inputSnapshot(root),{key,reference,base}=input;
  const filename=path.join(state,key+'.json');
  const lookup=()=>{
    try { fs.lstatSync(filename); }
    catch(e) { if (e.code==='ENOENT') return null; throw e; }
    const r=readRecord(filename,key,reference),i=driver.inspect(reference);
    if (!imageMatches(i,key) || i.id!==r.imageId) fail('RUNTIME_IMAGE_IDENTITY_MISMATCH');
    return {imageId:r.imageId,key,decision:'reused'};
  };
  const exists=checkState(state,action==='build');
  if (exists) {
    const hit=lookup();
    if (hit) {log({action, ...hit});return hit;}
  }
  if (action==='resolve') fail('RUNTIME_IMAGE_NOT_RECORDED');
  const lock=path.join(state,'build.lock');
  try {fs.mkdirSync(lock,{mode:0o700});}
  catch(e) {if(e.code==='EEXIST')fail('IMAGE_BUILD_IN_PROGRESS');throw e;}
  const lockIdentity=fs.lstatSync(lock);
  let staging, stagingIdentity, preserve=false;
  try {
    const hit=lookup();
    if (hit) {log({action,...hit});return hit;}
    if (driver.inspect(reference)) fail('RUNTIME_IMAGE_UNRECORDED');
    if (!capacity()) fail('IMAGE_BUILD_DISK_FLOOR');
    const cachedBase=driver.inspect(base);
    if (!cachedBase || cachedBase.os!=='linux' || cachedBase.architecture!=='arm64') fail('PINNED_BASE_NOT_LOCAL');
    staging=fs.mkdtempSync(path.join(state,'context-'));stagingIdentity=fs.lstatSync(staging);
    const context=path.join(staging,'inputs');
    for(const f of input.files){
      const target=path.join(context,f.name);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.chmodSync(path.dirname(target),0o755);
      fs.writeFileSync(target,f.bytes,{flag:'wx',mode:f.mode});
      fs.chmodSync(target,f.mode);
      fs.utimesSync(target,0,0);
    }
    // A client error or loss of the post-build observation cannot certify that
    // the daemon stopped. Keep the lock until the exact result is recorded.
    preserve=true;
    const builtId=driver.build({context,metadataFile:path.join(staging,'build-metadata.json'),reference,key});
    const image=driver.inspect(reference);
    if (!imageMatches(image,key) || image.id!==builtId) fail('BUILT_IMAGE_UNVERIFIED');
    fs.writeFileSync(filename,JSON.stringify({schemaVersion:1,key,reference,platform:PLATFORM,imageId:image.id})+'\n',{flag:'wx',mode:0o600});
    preserve=false;
    const result={imageId:image.id,key,decision:'built'};
    log({action,...result});return result;
  } finally {
    if (!preserve) {
      const sameDir=(p,s)=>{const n=fs.lstatSync(p);return n.isDirectory()&&n.dev===s.dev&&n.ino===s.ino&&n.uid===s.uid;};
      if (!sameDir(lock,lockIdentity) || (staging&&!sameDir(staging,stagingIdentity))) fail('IMAGE_BUILD_DIRECTORY_CHANGED');
      if (staging) fs.rmSync(staging,{recursive:true});
      fs.rmdirSync(lock);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const action=process.argv[2];
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const data=process.env.SUPER_AGENT_DATA_ROOT;
  let log;
  try {
    if (!data || !path.isAbsolute(data) || fs.realpathSync(data)!==data) fail('IMAGE_DATA_ROOT_INVALID');
    const logPath=path.join(data,'logs','runtime-image.jsonl');
    if(fs.realpathSync(path.dirname(logPath))!==path.dirname(logPath))fail('IMAGE_LOG_ROOT_ALIAS');
    log = event => {
      const fd=fs.openSync(logPath,fs.constants.O_APPEND|fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
      try {
        const s=fs.fstatSync(fd);
        if (!s.isFile() || s.uid!==process.getuid() || s.nlink!==1 || (s.mode&0o777)!==0o600) fail('IMAGE_LOG_UNSAFE');
        fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...event})+'\n');
      } finally {fs.closeSync(fd);}
    };
    const capacity=()=>{
      const x=fs.statfsSync(process.platform==='darwin'?'/private/tmp':'/',{bigint:true});
      const y=fs.statfsSync(data,{bigint:true});
      return x.bavail*x.bsize>=5n*1024n**3n && y.bavail*y.bsize>=1024n**3n;
    };
    const result=runImageAction({root,state:path.join(data,'image-reuse-v1'),action,capacity,log});
    if (action==='resolve') process.stdout.write(result.imageId+'\n');
    else process.stdout.write(JSON.stringify(result)+'\n');
  } catch(e) {
    const code=/^[A-Z_]+$/.test(e.message)?e.message:'IMAGE_POLICY_IO_ERROR';
    try {log?.({action:['build','resolve','audit'].includes(action)?action:'unknown',errorCode:code});}
    catch {process.stderr.write('{"errorCode":"IMAGE_AUDIT_LOG_UNAVAILABLE"}\n');}
    process.stderr.write(JSON.stringify({errorCode:code})+'\n');
    process.exitCode=1;
  }
}
