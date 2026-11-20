import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  installRoleInstructionHook,
  patchRoleInstructionRevisionSource,
  patchRoleInstructionFileStoreSource,
  wrapRoleInstructionService,
} from '../docker/role-instruction-hook.mjs';

test('all Native instruction mutation APIs retain their input, target and result', async () => {
  for (const methods of [['commit', 'restore', 'commitPluginReset'], ['write', 'apply']]) {
    const calls = [], result = { changed: true }, actor = { type: 'board', userId: 'owner' };
    const input = { companyId: 'company', agentId: 'agent', path: 'research/AGENTS.md' };
    const read = () => 'unchanged read';
    const service = { read };
    for (const method of methods) service[method] = async (...args) => {
      calls.push({ method, args });
      return result;
    };
    const wrapped = wrapRoleInstructionService(service, methods, async (target, nativeMutation) => {
      assert.deepEqual(target, { companyId: 'company', agentId: 'agent' });
      calls.push('before');
      const value = await nativeMutation();
      calls.push('synchronized');
      return value;
    });
    assert.equal(wrapped.read, read);
    for (const method of methods) {
      assert.equal(await wrapped[method](input, actor), result);
      assert.deepEqual(calls.splice(0), ['before', { method, args: [input, actor] }, 'synchronized']);
    }
  }
});

test('a successful Native write does not return before registry synchronization', async () => {
  let release, synchronized = false;
  const blocked = new Promise(resolve => { release = resolve; });
  const service = wrapRoleInstructionService({ commit: async () => 'native receipt' }, ['commit'],
    async (_target, nativeMutation) => {
      const result = await nativeMutation();
      await blocked;
      synchronized = true;
      return result;
    });
  let settled = false;
  const saving = service.commit({ companyId: 'company', agentId: 'agent' }).then(value => {
    settled = true;
    return value;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  assert.equal(await saving, 'native receipt');
  assert.equal(synchronized, true);
});

test('Native conflicts and synchronization failures remain visible to the caller', async () => {
  const conflict = Object.assign(new Error('base changed'), { code: 'INSTRUCTION_REVISION_CONFLICT' });
  const pending = Object.assign(new Error('sync pending'), { code: 'ROLE_INSTRUCTION_SYNC_PENDING' });
  const identity = { companyId: 'company', agentId: 'agent' };
  const nativeFailure = wrapRoleInstructionService({ commit: async () => { throw conflict; } }, ['commit'],
    async (_target, mutate) => mutate());
  await assert.rejects(nativeFailure.commit(identity), error => error === conflict);
  const syncFailure = wrapRoleInstructionService({ commit: async () => 'saved' }, ['commit'],
    async (_target, mutate) => { await mutate(); throw pending; });
  await assert.rejects(syncFailure.commit(identity), error => error === pending);
});

test('source hooks reject release drift and disabled loading needs no installed package', () => {
  assert.throws(() => patchRoleInstructionRevisionSource('export function agentInstructionRevisionService(db) {}'),
    { code: 'ROLE_INSTRUCTION_REVISION_BASE_DRIFT' });
  assert.throws(() => patchRoleInstructionFileStoreSource('export function agentFileStore(db) {}'),
    { code: 'ROLE_INSTRUCTION_FILE_STORE_BASE_DRIFT' });
  const hook = installRoleInstructionHook({ enabled: false, directory: '/missing-paperclip' });
  assert.equal(hook.enabled, false);
  hook.verify();
  hook.close();
});

test('pinned installed sources wrap all mutation APIs without changing disk bytes', {
  skip: !process.env.PAPERCLIP_TEST_SERVER_ROOT,
}, async () => {
  const root = process.env.PAPERCLIP_TEST_SERVER_ROOT;
  const revisionFile = path.join(root, 'dist/services/agent-instruction-revisions.js');
  const storeFile = path.join(root, 'dist/services/agent-file-store.js');
  const revision = fs.readFileSync(revisionFile, 'utf8');
  const store = fs.readFileSync(storeFile, 'utf8');
  const patchedRevision = patchRoleInstructionRevisionSource(revision);
  const patchedStore = patchRoleInstructionFileStoreSource(store);
  assert.match(patchedRevision, /function agentInstructionRevisionServiceNative\(db\)/);
  assert.match(patchedRevision, /\["commit","restore","commitPluginReset"\]/);
  assert.match(patchedStore, /function agentFileStoreNative\(db\)/);
  assert.match(patchedStore, /\["write","apply"\]/);
  const hook = installRoleInstructionHook({ directory: path.resolve(root, '../../..') });
  try {
    for (const url of hook.moduleUrls) await import(url);
    hook.verify();
  } finally { hook.close(); }
  assert.equal(fs.readFileSync(revisionFile, 'utf8'), revision);
  assert.equal(fs.readFileSync(storeFile, 'utf8'), store);
});
