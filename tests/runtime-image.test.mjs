import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inputSnapshot, runImageAction, INPUT_FILES, exportedImageDigest } from '../scripts/runtime-image.mjs';

const base = 'node@sha256:' + 'a'.repeat(64);
const id = 'sha256:' + 'b'.repeat(64);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-image-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'docker/bin'), {recursive: true});
  for (const p of INPUT_FILES) {
    fs.mkdirSync(path.dirname(path.join(root, p)), {recursive: true});
    fs.writeFileSync(path.join(root, p), p.endsWith('Dockerfile.runtime') ? `FROM ${base}\n` : p);
  }
  fs.writeFileSync(path.join(root, 'docker/bin/codex'), 'command');
  const state = path.join(root, 'state');
  const images = new Map([[base, {id, os: 'linux', architecture: 'arm64', key: null}]]);
  let builds = 0;
  const driver = {
    inspect: ref => images.get(ref) ?? null,
    build({context, reference, key}) {
      builds++;
      assert.equal(fs.readFileSync(path.join(context, 'docker/Dockerfile.runtime'), 'utf8'), `FROM ${base}\n`);
      assert.equal(fs.existsSync(path.join(context, 'task.json')), false);
      images.set(reference, {id, os: 'linux', architecture: 'arm64', key});
      return id;
    },
    references: () => new Map(),
  };
  return {root, state, images, driver, builds: () => builds, run: (action, capacity=()=>true) => runImageAction({
    root, state, action, driver, capacity, log: () => {},
  })};
}

test('same approved build inputs reuse the exact image across tasks', t => {
  const f = fixture(t);
  const first = f.run('build');
  fs.writeFileSync(path.join(f.root, 'task.json'), '{"task":"another task"}');
  assert.equal(f.run('build').decision, 'reused');
  assert.equal(f.run('resolve').imageId, first.imageId);
  assert.equal(f.builds(), 1);
  assert.equal(f.run('audit').images[0].retirement, 'REVIEW_REQUIRED');
});

test('runtime source and executable mode changes alter the key', t => {
  const f = fixture(t);
  const initial = inputSnapshot(f.root).key;
  const bin = path.join(f.root, 'docker/bin/codex');
  fs.chmodSync(bin, 0o755);
  const mode = inputSnapshot(f.root).key;
  assert.notEqual(mode, initial);
  fs.writeFileSync(bin, 'changed');
  assert.notEqual(inputSnapshot(f.root).key, mode);
  assert.throws(() => f.run('resolve'), /RUNTIME_IMAGE_NOT_RECORDED/);
  assert.equal(f.builds(), 0);
});

test('runtime copies fingerprint the Chief app hook, policy and native UI source', t => {
  const f = fixture(t);
  const paths = [
    'docker/chief-web-app-hook.mjs',
    'bridge/chief-web-pilot.mjs',
    'bridge/chief-web-evaluation.mjs',
    'bridge/chief-web-recovery-cli.mjs',
    'bridge/chief-web-recovery-native.mjs',
    'plugins/chief-web-pilot/ui/index.js',
  ];
  let previous = inputSnapshot(f.root).key;
  for (const name of paths) {
    fs.appendFileSync(path.join(f.root, name), 'changed');
    const next = inputSnapshot(f.root).key;
    assert.notEqual(next, previous);
    previous = next;
  }
});

test('unknown tag or changed image ID fails closed without rebuilding', t => {
  const f = fixture(t);
  const {key, reference} = inputSnapshot(f.root);
  f.images.set(reference, {id, os: 'linux', architecture: 'arm64', key});
  assert.throws(() => f.run('build'), /RUNTIME_IMAGE_UNRECORDED/);
  f.images.delete(reference);
  f.run('build');
  f.images.set(reference, {id: 'sha256:' + 'c'.repeat(64), os: 'linux', architecture: 'arm64', key});
  assert.throws(() => f.run('resolve'), /RUNTIME_IMAGE_IDENTITY_MISMATCH/);
  assert.equal(f.builds(), 1);
});

test('symlinked executable input is rejected', t => {
  const f = fixture(t);
  fs.symlinkSync('codex', path.join(f.root, 'docker/bin/alias'));
  assert.throws(() => inputSnapshot(f.root), /UNSAFE_BUILD_INPUT/);
});

test('low disk blocks new builds but permits reuse', t => {
  const f = fixture(t);
  assert.throws(() => f.run('build',()=>false), /IMAGE_BUILD_DISK_FLOOR/);
  assert.equal(f.builds(), 0);
  f.run('build');
  assert.equal(f.run('build',()=>false).decision, 'reused');
});

test('ordinary build failure also preserves lock and staging until outcome is known', t => {
  const f = fixture(t);
  f.driver.build=()=>{throw new Error('IMAGE_BUILD_FAILED');};
  assert.throws(() => f.run('build'), /IMAGE_BUILD_FAILED/);
  assert.equal(fs.existsSync(path.join(f.state,'build.lock')),true);
  assert.equal(fs.readdirSync(f.state).filter(n=>n.startsWith('context-')).length,1);
  assert.throws(() => f.run('build'), /IMAGE_BUILD_IN_PROGRESS/);
});

test('unverified post-build result blocks another attempt', t => {
  const f = fixture(t);
  f.driver.build=()=>{};
  assert.throws(() => f.run('build'), /BUILT_IMAGE_UNVERIFIED/);
  assert.throws(() => f.run('build'), /IMAGE_BUILD_IN_PROGRESS/);
});

test('same fingerprint label cannot substitute a different build result', t => {
  const f=fixture(t);
  f.driver.build=({reference,key})=>{
    f.images.set(reference,{id:'sha256:'+'c'.repeat(64),os:'linux',architecture:'arm64',key});
    return id;
  };
  assert.throws(()=>f.run('build'),/BUILT_IMAGE_UNVERIFIED/);
  assert.throws(()=>f.run('build'),/IMAGE_BUILD_IN_PROGRESS/);
});

test('containerd registration uses exported manifest identity, never config identity', () => {
  const config='sha256:'+'d'.repeat(64);
  assert.equal(exportedImageDigest({'containerimage.digest':id,'containerimage.config.digest':config}),id);
  assert.throws(()=>exportedImageDigest({'containerimage.config.digest':config}),/BUILD_IMAGE_ID_UNVERIFIED/);
});
