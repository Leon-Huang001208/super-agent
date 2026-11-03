import test from 'node:test';
import assert from 'node:assert/strict';
import { existingPrRunner } from '../scripts/existing-pr-runner.mjs';
const repository = 'Leon-Huang001208/super-agent';
const expectedCommit = 'a'.repeat(40);
const url = `https://github.com/${repository}/pull/1`;
function fixture(change = {}) {
  const calls = [];
  const pr = { number: 1, html_url: url, state: 'open', draft: false, head: { sha: expectedCommit, repo: { full_name: repository } }, base: { ref: 'main', repo: { full_name: repository } }, ...change };
  const run = existingPrRunner({ repository, number: 1, integrationBranch: 'codex/integration', expectedCommit, defaultBranch: 'main', invoke(command, args) { calls.push({ command, args }); return { status: 0, stdout: args[0] === 'api' ? JSON.stringify(pr) : '', stderr: '' }; } });
  return { run, calls };
}
const create = ['pr', 'create', '--repo', repository, '--base', 'main', '--head', 'codex/integration'];
test('reuses only the live existing PR with the exact prepared head', () => {
  const f = fixture(); assert.equal(f.run('gh', create).stdout.trim(), url);
  assert.deepEqual(f.calls.map(x => x.args[0]), ['api']);
});
test('head advance, wrong base, closed and draft PRs are rejected before mutation', () => {
  for (const change of [{ head: { sha: 'b'.repeat(40), repo: { full_name: repository } } }, { base: { ref: 'other', repo: { full_name: repository } } }, { state: 'closed' }, { draft: true }]) {
    const f = fixture(change); assert.throws(() => f.run('gh', create), /EXISTING_PR_IDENTITY_MISMATCH/); assert.equal(f.calls.length, 1);
  }
});
test('merge goes through server-side auto merge with a head SHA condition', () => {
  const f = fixture(); f.run('gh', ['pr', 'merge', '--repo', repository, '--auto', '--merge', url]);
  const args = f.calls.at(-1).args; assert.equal(args[args.indexOf('--match-head-commit') + 1], expectedCommit); assert.ok(args.includes('--auto'));
});
test('foreign project and unexpected actions cannot reuse this adapter', () => {
  assert.throws(() => existingPrRunner({ repository: 'Leon-Huang001208/ResearchWorkbench', number: 1, expectedCommit, invoke() {} }), /INVALID_EXISTING_PR_SCOPE/);
  const f = fixture(); assert.throws(() => f.run('gh', ['pr', 'merge', '--admin', url]), /UNEXPECTED_GITHUB_ACTION/); assert.throws(() => f.run('git', ['push']), /UNEXPECTED_GITHUB_ACTION/); assert.equal(f.calls.length, 0);
});
