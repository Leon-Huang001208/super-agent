// Project adapter for the managed controller's existing githubRunner extension.
// It reuses a verified PR whose head is the exact prepared integration commit.
export function existingPrRunner({ repository, number, integrationBranch, expectedCommit, defaultBranch, invoke }) {
  if (repository !== 'Leon-Huang001208/super-agent' || !Number.isSafeInteger(number) || number < 1 || !/^[a-f0-9]{40}$/.test(expectedCommit) || typeof invoke !== 'function') throw new Error('INVALID_EXISTING_PR_SCOPE');
  const url = `https://github.com/${repository}/pull/${number}`;
  function inspect() {
    const result = invoke('gh', ['api', `repos/${repository}/pulls/${number}`]);
    const pr = JSON.parse(result.stdout);
    if (pr.number !== number || pr.html_url !== url || pr.state !== 'open' || pr.draft !== false || pr.head?.sha !== expectedCommit || pr.head?.repo?.full_name !== repository || pr.base?.ref !== defaultBranch || pr.base?.repo?.full_name !== repository) throw new Error('EXISTING_PR_IDENTITY_MISMATCH');
    return pr;
  }
  return (command, args, options) => {
    if (command !== 'gh' || !Array.isArray(args)) throw new Error('UNEXPECTED_GITHUB_ACTION');
    if (args[0] === 'pr' && args[1] === 'create') {
      if (args[args.indexOf('--repo') + 1] !== repository || args[args.indexOf('--head') + 1] !== integrationBranch || args[args.indexOf('--base') + 1] !== defaultBranch) throw new Error('UNEXPECTED_GITHUB_ACTION');
      inspect();
      // This receipt points to a real, live PR. No duplicate PR is created.
      return { status: 0, stdout: url + '\n', stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'merge' && args.includes(url) && args.includes('--auto') && args.includes('--merge') && args[args.indexOf('--repo') + 1] === repository) {
      inspect();
      return invoke('gh', ['pr', 'merge', url, '--repo', repository, '--auto', '--merge', '--match-head-commit', expectedCommit], options);
    }
    throw new Error('UNEXPECTED_GITHUB_ACTION');
  };
}
