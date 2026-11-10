import fs from 'node:fs';
import { renderClosedClaimHistory } from '../bridge/project-adapters/rwb/closed-claim-history.mjs';

try {
  const [baseline, claimsFile, taskId, output] = process.argv.slice(2);
  if (!baseline || !claimsFile || !output || process.argv.length !== 6) throw Object.assign(new Error('arguments'), { code: 'CCA_HISTORY_ARGUMENT_INVALID' });
  const claims = JSON.parse(fs.readFileSync(claimsFile, 'utf8'));
  const candidate = renderClosedClaimHistory(fs.readFileSync(baseline, 'utf8'), claims, taskId);
  fs.writeFileSync(output, candidate, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ code: 'CCA_HISTORY_PREPARED', retainedCount: claims.length }));
} catch (error) {
  console.error(JSON.stringify({ code: error.code ?? 'CCA_HISTORY_PREPARE_FAILED' }));
  process.exitCode = 1;
}
