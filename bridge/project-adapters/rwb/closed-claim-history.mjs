import { createHash } from 'node:crypto';

const pinned = 'cf6bd56e8129844a7cc7e6a5b30d214ec75abc9e80042deadc0b8a81ff1986bd';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

function replace(source, anchor, result) {
  if (!source.includes(anchor) || source.indexOf(anchor) !== source.lastIndexOf(anchor)) fail('CCA_HISTORY_ANCHOR_MISMATCH');
  return source.replace(anchor, () => result);
}

export function selectRetainedClaimIdentifiers(claims, historicalTaskId) {
  if (!uuid.test(historicalTaskId ?? '') || !Array.isArray(claims) || !claims.length || claims.length > 20) fail('CCA_HISTORY_INPUT_INVALID');
  const retained = claims.map(claim => {
    if (claim?.schemaVersion !== 2 || claim.taskId !== historicalTaskId ||
        !(claim.role === 'develop' && claim.scopeRevision === 9 || claim.role === 'review' && claim.scopeRevision === 10) ||
        claim.status !== 'claimed' || claim.retryAllowed !== false || !digest.test(claim.ownerRevisionAllowanceSha256 ?? '') ||
        ![claim.scopeId, claim.attemptId, claim.permitId, claim.nativeRunId].every(value => uuid.test(value ?? ''))) {
      fail('CCA_HISTORY_INPUT_INVALID');
    }
    return { taskId: claim.taskId, role: claim.role, revision: claim.scopeRevision, scopeId: claim.scopeId,
      attemptId: claim.attemptId, permitId: claim.permitId, runId: claim.nativeRunId };
  }).sort((a, b) => a.permitId.localeCompare(b.permitId));
  if (new Set(retained.map(value => value.permitId)).size !== retained.length ||
      new Set(retained.map(value => value.runId)).size !== retained.length) fail('CCA_HISTORY_INPUT_INVALID');
  return retained;
}

/** Selects identifiers for the existing audit. The audit still validates each private file and Native run. */
export function renderClosedClaimHistory(source, claims, historicalTaskId) {
  if (createHash('sha256').update(source).digest('hex') !== pinned) fail('CCA_HISTORY_BASE_MISMATCH');
  const retained = selectRetainedClaimIdentifiers(claims, historicalTaskId);
  const marker = '/** Narrow read-only loader predicate.';
  let patched = replace(source, marker,
    'const retainedClosedClaims = Object.freeze(' + JSON.stringify(retained) + ');\n\n' + marker);
  patched = replace(patched, '![C.develop.runId,C.review.runId].includes(runId)',
    '!([C.develop.runId,C.review.runId].includes(runId) || retainedClosedClaims.some(item => item.taskId === taskId && item.runId === runId))');
  return replace(patched, '    const item=C[claim?.role];',
    '    const item = (!currentWebRevision && retainedClosedClaims.find(value => value.taskId === claim?.taskId &&\n' +
    '      value.role === claim.role && value.permitId === claim.permitId)) || C[claim?.role];');
}
