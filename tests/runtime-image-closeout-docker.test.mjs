import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {verifyArchive} from '../scripts/runtime-image-closeout-docker.mjs';

const reference = 'super-agent-paperclip-runtime:input-'+'a'.repeat(64);
const indexType = 'application/vnd.oci.image.index.v1+json';
const manifestType = 'application/vnd.oci.image.manifest.v1+json';
const sha256 = bytes=>createHash('sha256').update(bytes).digest('hex');
const blobPath = descriptor=>'blobs/sha256/'+descriptor.digest.slice(7);

test('archive validation rejects corruption in reachable layer and attestation blobs', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'sa-closeout-archive-'));
  const input = path.join(tmp,'source.tar');
  t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const content = path.join(tmp,'archive');
  fs.mkdirSync(path.join(content,'blobs','sha256'),{recursive:true});

  function store(mediaType,value) {
    const bytes = Buffer.from(typeof value==='string'?value:JSON.stringify(value));
    const descriptor = {mediaType,digest:'sha256:'+sha256(bytes),size:bytes.length};
    fs.writeFileSync(path.join(content,blobPath(descriptor)),bytes);
    return descriptor;
  }
  const config = store('application/vnd.oci.image.config.v1+json',{os:'linux',architecture:'arm64'});
  const layer = store('application/vnd.oci.image.layer.v1.tar+gzip','example layer bytes');
  const image = store(manifestType,{schemaVersion:2,mediaType:manifestType,config,layers:[layer]});
  const attestConfig = store('application/vnd.oci.empty.v1+json',{});
  const statement = store('application/vnd.in-toto+json',{subject:[image.digest]});
  const attestation = store(manifestType,{
    schemaVersion:2,mediaType:manifestType,config:attestConfig,layers:[statement],subject:image
  });
  const imageIndex = store(indexType,{schemaVersion:2,mediaType:indexType,manifests:[image,attestation]});
  fs.writeFileSync(path.join(content,'index.json'),JSON.stringify({
    schemaVersion:2,manifests:[{...imageIndex,annotations:{'io.containerd.image.name':'docker.io/library/'+reference}}]
  }));
  fs.writeFileSync(path.join(content,'manifest.json'),JSON.stringify([
    {Config:blobPath(config),Layers:[blobPath(layer)],RepoTags:[reference]}
  ]));

  function pack() {
    const tar = spawnSync('tar',['-cf',input,'-C',content,'index.json','manifest.json','blobs'],{encoding:'utf8'});
    assert.equal(tar.status,0,tar.stderr);
  }
  pack();
  assert.doesNotThrow(()=>verifyArchive(input,reference,imageIndex.digest));
  for (const descriptor of [layer,statement]) {
    const file = path.join(content,blobPath(descriptor));
    const original = fs.readFileSync(file);
    fs.writeFileSync(file,Buffer.alloc(original.length,0));
    pack();
    assert.throws(()=>verifyArchive(input,reference,imageIndex.digest),{message:'IMAGE_ARCHIVE_UNVERIFIED'});
    fs.writeFileSync(file,original);
  }
});
