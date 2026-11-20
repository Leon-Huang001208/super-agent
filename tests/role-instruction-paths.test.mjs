import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pinRoleInstruction,hostRoleInstructionPath} from '../bridge/role-instruction-paths.mjs';

test('a pinned run keeps the admitted bytes after the role entry is edited', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'role-instruction-pin-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'AGENTS.md'),bytes=Buffer.from('original role instructions\n');
  fs.writeFileSync(source,bytes,{mode:0o600});
  const digest=createHash('sha256').update(bytes).digest('hex');
  const runId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const pinned=pinRoleInstruction({source,sha256:digest,runId,role:'research',root});
  fs.writeFileSync(source,'saved next version\n');
  assert.deepEqual(fs.readFileSync(pinned),bytes);
  assert.match(pinned,/research\/AGENTS\.md$/);
  assert.throws(()=>pinRoleInstruction({source,sha256:digest,runId,role:'research',root}),/MATERIAL_CHANGED/);
});

test('host transport maps the full admitted path instead of a colliding basename', () => {
  const file='/paperclip/instances/default/companies/a/agents/b/instructions/research/AGENTS.md';
  assert.equal(hostRoleInstructionPath(file,'/data'),'/data/state/instances/default/companies/a/agents/b/instructions/research/AGENTS.md');
  assert.throws(()=>hostRoleInstructionPath('/paperclip/../secrets/auth','/data'),/PATH_DENIED/);
});
