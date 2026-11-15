import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';

const ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_ID = /^[a-f0-9]{64}$/;
const RUNTIME_REF = /^super-agent-paperclip-runtime:input-[a-f0-9]{64}$/;
const LABEL = 'io.super-agent.build-input-sha256';
const INDEX_TYPES = new Set(['application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json']);
const MANIFEST_TYPES = new Set(['application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json']);
const HASH_STDIN = `
  import {createHash} from 'node:crypto';
  const hash = createHash('sha256');
  let size = 0;
  for await (const bytes of process.stdin) {
    hash.update(bytes);
    size += bytes.length;
  }
  process.stdout.write(size + ' ' + hash.digest('hex'));
`;
const fail = code => { throw new Error(code); };

function command(file, args, {timeout=15000, code='DOCKER_OBSERVATION_FAILED', output}={}) {
  const result = spawnSync(file, args, {
    encoding: 'utf8', timeout, maxBuffer: 4*1024**2,
    stdio: ['ignore', output ?? 'pipe', 'pipe']
  });
  if (result.error || result.signal || result.status !== 0) fail(code);
  return result.stdout ?? '';
}

function json(text, code='DOCKER_OBSERVATION_FAILED') {
  try { return JSON.parse(text); }
  catch { return fail(code); }
}

const lines = text => text.trim().split('\n').filter(Boolean);
const docker = (args, options) => command('docker', args, options);
const onlyStrings = items => Array.isArray(items) && items.every(item => typeof item==='string');

function connection() {
  const context = docker(['context','show']).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(context)) fail('DOCKER_IDENTITY_UNVERIFIED');
  // A CLI --context overrides DOCKER_HOST. Keep an explicit host override intact.
  const hostOverride = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ? process.env.DOCKER_HOST : null;
  const endpoint = hostOverride ?? json(docker(['context','inspect',context,'--format','{{json (index .Endpoints "docker").Host}}']));
  if (typeof endpoint!=='string' || !/^unix:\/\/\/[^\r\n\0]+$/.test(endpoint)) fail('DOCKER_IDENTITY_UNVERIFIED');
  const args = hostOverride ? [] : ['--context',context];
  const daemon = json(docker([...args,'info','--format','{{json .ID}}']));
  if (typeof daemon !== 'string' || !/^[a-zA-Z0-9:._-]{8,160}$/.test(daemon)) fail('DOCKER_IDENTITY_UNVERIFIED');
  return {args, identity:JSON.stringify([context,endpoint,daemon])};
}

function observe() {
  const ids = lines(docker(['container','ls','-aq','--no-trunc']));
  if (new Set(ids).size!==ids.length || ids.some(id=>!CONTAINER_ID.test(id))) fail('CONTAINER_ID_INVALID');
  const format = '[{{json .Id}},{{json .Image}},{{json .Config.Image}},' +
    '{{with (index .Config "Labels")}}{{json (index . "com.docker.compose.project")}},'+
    '{{json (index . "com.docker.compose.project.config_files")}}{{else}}null,null{{end}}]';
  const observed = [];
  for (let start=0; start<ids.length; start+=50) {
    const batch = ids.slice(start,start+50);
    const rows = lines(docker(['container','inspect','--format',format,...batch]));
    if (rows.length!==batch.length) fail('CONTAINER_IMAGE_UNKNOWN');
    for (const [index,row] of rows.entries()) {
      const fields = json(row);
      if (!Array.isArray(fields) || fields.length!==5) fail('CONTAINER_IMAGE_UNKNOWN');
      const [id,imageId,image,project,configFiles] = fields;
      if (id!==batch[index] || typeof imageId!=='string' || !ID.test(imageId) ||
          typeof image!=='string' || !image || /[\r\n\0]/.test(image) ||
          (project!==null && (typeof project!=='string' || /[\r\n\0]/.test(project))) ||
          (configFiles!==null && (typeof configFiles!=='string' || /[\r\n\0]/.test(configFiles)))) {
        fail('CONTAINER_IMAGE_UNKNOWN');
      }
      const files = configFiles===null ? [] : configFiles.split(',');
      if (files.some(file=>!file)) fail('CONTAINER_IMAGE_UNKNOWN');
      observed.push({imageId,image,project:project??'',configFiles:files});
    }
  }
  return observed;
}

function inspect(ref) {
  if (typeof ref!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/@-]{0,511}$/.test(ref)) fail('IMAGE_REFERENCE_INVALID');
  let ids;
  if (ID.test(ref)) {
    ids = lines(docker(['image','ls','--all','--no-trunc','--format','{{.ID}}']));
    if (ids.some(id=>!ID.test(id))) fail('IMAGE_REFERENCE_AMBIGUOUS');
    if (!ids.includes(ref)) return null;
    ids = [ref];
  } else if (!ref.includes('@')) {
    ids = lines(docker(['image','ls','--all','--no-trunc','--filter','reference='+ref,'--format','{{.ID}}']));
    if (!ids.length) return null;
    if (new Set(ids).size!==1 || !ID.test(ids[0])) fail('IMAGE_REFERENCE_AMBIGUOUS');
  }
  const format = '[{{json .Id}},{{json .Os}},{{json .Architecture}},'+
    '{{with (index .Config "Labels")}}{{json (index . "'+LABEL+'")}}{{else}}null{{end}},'+
    '{{json (index . "RepoTags")}},{{json (index . "RepoDigests")}}]';
  const fields = json(docker(['image','inspect','--format',format,ref]));
  if (!Array.isArray(fields) || fields.length!==6) fail('IMAGE_REFERENCE_CHANGED');
  const [id,os,architecture,key,tags,digests] = fields;
  if (typeof id!=='string' || !ID.test(id) || (ids && id!==ids[0]) ||
      typeof os!=='string' || typeof architecture!=='string' ||
      (key!==null && typeof key!=='string') || !onlyStrings(tags??[]) || !onlyStrings(digests??[])) {
    fail('IMAGE_REFERENCE_CHANGED');
  }
  return {id,os,architecture,key,tags:tags??[],digests:digests??[]};
}

export function verifyArchive(target, reference, imageId) {
  const code = 'IMAGE_ARCHIVE_UNVERIFIED';
  const options = {timeout:120000,code};
  const archive = args => command('tar',args,options);
  const names = lines(archive(['-tf',target]));
  const entries = new Set(names);
  if (entries.size!==names.length) fail(code);
  const read = name => archive(['-xOf',target,name]);
  const index = json(read('index.json'),code);
  const manifest = json(read('manifest.json'),code);
  const fullyQualified = 'docker.io/library/'+reference;
  const descriptors = index?.manifests?.filter(item =>
    [reference,fullyQualified].includes(item?.annotations?.['io.containerd.image.name']));
  if (index?.schemaVersion!==2 || descriptors?.length!==1 || descriptors[0].digest!==imageId) fail(code);

  const visited = new Map();
  const manifestPaths = [];
  function verifyDescriptor(descriptor, requireManifest=false) {
    const {digest,size,mediaType} = descriptor ?? {};
    if (typeof digest!=='string' || !ID.test(digest) || !Number.isSafeInteger(size) || size<0 ||
        typeof mediaType!=='string' || !mediaType) fail(code);
    const isIndex = INDEX_TYPES.has(mediaType);
    const isManifest = MANIFEST_TYPES.has(mediaType);
    if (requireManifest && !isIndex && !isManifest) fail(code);
    const hex = digest.slice(7);
    const blob = 'blobs/sha256/'+hex;
    if (!entries.has(blob)) fail(code);
    const prior = visited.get(digest);
    if (prior) {
      if (prior.size!==size || prior.mediaType!==mediaType) fail(code);
      return blob;
    }
    visited.set(digest,{size,mediaType});

    if (!isIndex && !isManifest) {
      // Pass filenames as shell arguments. The hash worker streams layer bytes
      // from tar and pipefail preserves extraction errors from tar.
      const computed = command('/bin/bash',['--noprofile','--norc','-o','pipefail','-c',
        'tar -xOf "$1" "$2" | "$3" --input-type=module -e "$4"',
        'image-archive',target,blob,process.execPath,HASH_STDIN],options);
      if (computed!==size+' '+hex) fail(code);
      return blob;
    }

    const bytes = read(blob);
    if (Buffer.byteLength(bytes)!==size || createHash('sha256').update(bytes).digest('hex')!==hex) fail(code);
    const document = json(bytes,code);
    if (document?.schemaVersion!==2 || (document.mediaType!==undefined && document.mediaType!==mediaType)) fail(code);
    if (isIndex) {
      if (!Array.isArray(document.manifests) || !document.manifests.length) fail(code);
      for (const child of document.manifests) verifyDescriptor(child,true);
    } else {
      if (!Array.isArray(document.layers)) fail(code);
      const config = verifyDescriptor(document.config);
      const layers = document.layers.map(layer=>verifyDescriptor(layer));
      manifestPaths.push([config,...layers]);
    }
    if (document.subject!==undefined) verifyDescriptor(document.subject,true);
    return blob;
  }
  verifyDescriptor(descriptors[0],true);

  const named = Array.isArray(manifest) && manifest.filter(item =>
    item?.RepoTags?.some(tag=>tag===reference || tag===fullyQualified));
  if (named?.length!==1 || !Array.isArray(named[0].Layers)) fail(code);
  const paths = [named[0].Config,...named[0].Layers];
  if (!manifestPaths.some(blobs=>blobs.length===paths.length && blobs.every((blob,i)=>blob===paths[i]))) fail(code);
}

// Exclusive output prevents the Docker client from replacing a pre-existing file.
function save({target,reference,imageId}) {
  if (!RUNTIME_REF.test(reference) || !ID.test(imageId)) fail('IMAGE_ARCHIVE_ID_INVALID');
  let fd;
  try {
    fd = fs.openSync(target,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    docker(['image','save',reference],{timeout:600000,code:'IMAGE_ARCHIVE_FAILED',output:fd});
    fs.fsyncSync(fd);
    const file = fs.fstatSync(fd);
    if (!file.isFile() || file.nlink!==1 || file.size===0) fail('IMAGE_ARCHIVE_UNVERIFIED');
    verifyArchive(target,reference,imageId);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024**2);
    for (let offset=0; offset<file.size;) {
      const count = fs.readSync(fd,buffer,0,Math.min(buffer.length,file.size-offset),offset);
      if (!count) fail('IMAGE_ARCHIVE_UNVERIFIED');
      hash.update(buffer.subarray(0,count));
      offset += count;
    }
    const current = fs.lstatSync(target);
    if (['dev','ino','size','mode','mtimeMs','ctimeMs'].some(key=>current[key]!==file[key])) {
      fail('IMAGE_ARCHIVE_UNVERIFIED');
    }
    return hash.digest('hex');
  } catch (error) {
    if (/^IMAGE_ARCHIVE_[A-Z_]+$/.test(error.message)) throw error;
    return fail('IMAGE_ARCHIVE_UNVERIFIED');
  } finally {
    if (fd!==undefined) fs.closeSync(fd);
  }
}

export const dockerCloseoutDriver = {
  identity: () => connection().identity,
  observe,
  inspect,
  save,
  remove(imageId, expectedIdentity) {
    if (!ID.test(imageId)) fail('IMAGE_REMOVAL_ID_INVALID');
    const observed = connection();
    if (expectedIdentity!==undefined && observed.identity!==expectedIdentity) fail('DOCKER_IDENTITY_CHANGED');
    docker([...observed.args,'image','rm','--no-prune',imageId],
      {timeout:120000,code:'IMAGE_REMOVAL_OUTCOME_UNKNOWN'});
  }
};
