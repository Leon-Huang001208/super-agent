import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REAL_RWB_REPOSITORY } from '../bridge/chief-web-real-engine.mjs';

const repoPath = 'repos/' + REAL_RWB_REPOSITORY;
const owner = REAL_RWB_REPOSITORY.split('/')[0];
const id = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const branch = new RegExp('^codex/integrate-super-agent-(' + id + ')$');
const ref = new RegExp('^/git/ref/heads/(?:master|codex/integrate-super-agent-' + id + ')$');
const prList = new RegExp('^/pulls\\?state=all&head=' + owner + '%3Acodex%2Fintegrate-super-agent-' + id + '&base=master&per_page=2$');
const pr = /^\/pulls\/[1-9][0-9]*$/;
const statuses = /^\/commits\/[a-f0-9]{40}\/(?:check-runs\?filter=latest&per_page=100|status\?per_page=100)$/;
const fail = code => { throw Object.assign(new Error('RWB_REAL_' + code), { code: 'RWB_REAL_' + code }); };
const readPaths = new Set(['', '/actions/runs?per_page=20', '/branches/master/protection/required_status_checks']);

export function createChiefWebRealGitHub({ ghBinary, projectRoot, run = spawnSync } = {}) {
  if (![ghBinary, projectRoot].every(value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value) ||
      typeof run !== 'function') fail('GITHUB_TRANSPORT_CONFIGURATION_INVALID');
  function api(method, endpoint, input) {
    const env = { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1',
      GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', GH_PAGER: 'cat' };
    delete env.GH_DEBUG;
    delete env.DEBUG;
    const result = run(ghBinary, ['api', '--hostname', 'github.com', '--method', method,
      '--header', 'Accept: application/vnd.github+json', '--header', 'X-GitHub-Api-Version: 2022-11-28',
      '--include', ...(input === undefined ? [] : ['--input', '-']), endpoint], {
      env, cwd: projectRoot, encoding: 'utf8', timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
      ...(input === undefined ? {} : { input: JSON.stringify(input) }),
    });
    const data = result?.stdout ?? '';
    const header = /^HTTP\/\S+ ([0-9]{3})[^\r\n]*\r?\n/.exec(data);
    const boundary = /\r?\n\r?\n/.exec(data);
    if (result?.error || result?.signal || !header || !boundary) fail('GITHUB_TRANSPORT_UNKNOWN');
    if (method === 'GET' && header[1] === '404' && result.status === 1) return null;
    if (result.status !== 0 || header[1] !== (method === 'GET' ? '200' : '201')) fail('GITHUB_TRANSPORT_FAILED');
    try { return JSON.parse(data.slice(boundary.index + boundary[0].length)); }
    catch { fail('GITHUB_TRANSPORT_RESPONSE_INVALID'); }
  }

  return Object.freeze({
    get(endpoint) {
      if (typeof endpoint !== 'string' || !endpoint.startsWith(repoPath)) fail('GITHUB_ENDPOINT_DENIED');
      const suffix = endpoint.slice(repoPath.length);
      if (!readPaths.has(suffix) && ![ref, prList, pr, statuses].some(pattern => pattern.test(suffix))) fail('GITHUB_ENDPOINT_DENIED');
      return api('GET', endpoint);
    },
    createPullRequest(input) {
      const match = branch.exec(input?.head ?? '');
      const taskId = 'super-agent-' + match?.[1];
      const expectedBody = new RegExp('^Managed ResearchWorkbench delivery ' + taskId +
        '\\.\\n\\nCandidate: [a-f0-9]{40}\\nVerification: passed\\.\\n$');
      if (!match || input.repository !== REAL_RWB_REPOSITORY || input.base !== 'master' ||
          input.title !== 'merge: deliver ' + taskId || !expectedBody.test(input.body ?? '')) fail('GITHUB_CREATION_SCOPE_DENIED');
      const { title, body, head, base } = input;
      return api('POST', repoPath + '/pulls', { title, body, head, base });
    },
  });
}
