import path from 'node:path';
import { chiefWebRealDigest, chiefWebRealRequestIdentity, validateChiefWebRealClaim, CHIEF_WEB_REAL_MODEL } from './chief-web-real-executor.mjs';
import { readRecoveryPrivate, writeRecoveryPrivate } from './chief-web-recovery-io.mjs';

const root = '/paperclip/control/chief-web/recovery-host/real-model';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = /^[a-f0-9]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const matches = (value, expected) => Object.entries(expected).every(([key, item]) => value?.[key] === item);
export const CHIEF_WEB_REAL_MODEL_TIMEOUT = 120_000;
export const CHIEF_WEB_REAL_MODEL_FILE_LIMIT = 32_768;

function jobFile(slotId, name) {
  if (!uuid.test(slotId ?? '')) fail('CHIEF_WEB_REAL_EXECUTION_SCOPE_DENIED');
  return path.join(root, slotId, name);
}

function claimFields(claim) {
  const identity = chiefWebRealRequestIdentity(claim);
  if (!digest.test(claim.requestDigest ?? '')) fail('CHIEF_WEB_REAL_EXECUTION_RESERVATION_DENIED');
  validateChiefWebRealClaim(claim, identity, claim.requestDigest);
  return {
    ...identity, ...CHIEF_WEB_REAL_MODEL, requestDigest: claim.requestDigest, credentialGrantId: claim.credentialGrantId,
    accountFingerprint: claim.accountFingerprint, claimedAt: claim.claimedAt, expiresAt: claim.expiresAt,
  };
}

function envelope({ claim, prompt }) {
  const binding = claimFields(claim);
  if (typeof prompt !== 'string' || !prompt || Buffer.byteLength(prompt) > 262144 || prompt.includes('\0')) {
    fail('CHIEF_WEB_REAL_PROVIDER_INPUT_DENIED');
  }
  const job = { schemaVersion: 1, ...binding, prompt, promptDigest: chiefWebRealDigest(prompt) };
  if (Buffer.byteLength(JSON.stringify(job) + '\n') > CHIEF_WEB_REAL_MODEL_FILE_LIMIT) fail('CHIEF_WEB_REAL_PROVIDER_INPUT_DENIED');
  return job;
}

export function createChiefWebRealFileProvider({ read = readRecoveryPrivate, write = writeRecoveryPrivate, now = Date.now } = {}) {
  async function observe(claim) {
    const binding = claimFields(claim);
    const receipt = await read(jobFile(binding.slotId, 'receipt.json'));
    if (receipt) {
      const physical = await read(jobFile(binding.slotId, 'physical.json'));
      if (!matches(receipt, binding) || !matches(physical, { ...binding, status: 'claimed',
        dispatchedAt: receipt.dispatchedAt, promptDigest: receipt.promptDigest })) fail('CHIEF_WEB_REAL_PROVIDER_RECEIPT_UNVERIFIED');
      return receipt;
    }
    const physical = await read(jobFile(binding.slotId, 'physical.json'));
    if (physical && (!matches(physical, binding) || !Number.isSafeInteger(physical.dispatchedAt) ||
        now() < physical.dispatchedAt || now() >= physical.dispatchedAt + CHIEF_WEB_REAL_MODEL_TIMEOUT + 30_000)) {
      return { status: 'unknown' };
    }
    return null;
  }

  return Object.freeze({
    safeHandoffReplay: true,
    observe,
    async invoke(input) {
      const job = envelope(input);
      const reservation = await read(jobFile(job.slotId, 'reservation.json'));
      if (!matches(reservation, { ...claimFields(input.claim), status: 'reserved' }) || now() >= job.expiresAt) {
        fail('CHIEF_WEB_REAL_EXECUTION_RESERVATION_DENIED');
      }
      const current = await observe(input.claim);
      if (current) return current;
      if (await read(jobFile(job.slotId, 'physical.json'))) return null;
      try { await write(jobFile(job.slotId, 'request.json'), job); }
      catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (!matches(await read(jobFile(job.slotId, 'request.json')), job)) fail('CHIEF_WEB_REAL_PROVIDER_REQUEST_CHANGED');
      }
      return observe(input.claim);
    },
  });
}

export function decodeChiefWebRealCodex(output) {
  if (!Buffer.isBuffer(output) || output.length === 0 || output.length > 524288) fail('CHIEF_WEB_REAL_PROVIDER_PROTOCOL_DENIED');
  let sessionId, message, usage, started = false, completed = false;
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(output).trim().split('\n');
  for (const line of lines) {
    const row = JSON.parse(line);
    if (completed || !row || typeof row !== 'object' || Array.isArray(row)) fail('CHIEF_WEB_REAL_PROVIDER_PROTOCOL_DENIED');
    if (row.type === 'thread.started' && !sessionId && uuid.test(row.thread_id ?? '')) sessionId = row.thread_id;
    else if (row.type === 'turn.started' && sessionId && !started) started = true;
    else if (row.type === 'item.completed' && started && row.item?.type === 'agent_message' &&
        message === undefined && typeof row.item.text === 'string' && Buffer.byteLength(row.item.text) <= 262144) {
      message = JSON.parse(row.item.text);
    } else if (['item.started', 'item.completed'].includes(row.type) && started && row.item?.type === 'reasoning') {
      continue;
    } else if (row.type === 'turn.completed' && started && message !== undefined) {
      usage = Object.fromEntries(['input_tokens', 'cached_input_tokens', 'output_tokens']
        .filter(key => Object.hasOwn(row.usage ?? {}, key)).map(key => [key, row.usage[key]]));
      if (!Object.values(usage).every(value => Number.isSafeInteger(value) && value >= 0)) fail('CHIEF_WEB_REAL_PROVIDER_PROTOCOL_DENIED');
      completed = true;
    } else fail('CHIEF_WEB_REAL_PROVIDER_PROTOCOL_DENIED');
  }
  if (!completed || !sessionId || message === null || typeof message !== 'object' || Array.isArray(message)) {
    fail('CHIEF_WEB_REAL_PROVIDER_PROTOCOL_DENIED');
  }
  return { sessionId, result: message, usage, transcriptDigest: chiefWebRealDigest(output) };
}

/** Isolated worker entry, called once per persistent slot by the host. */
export function createChiefWebRealProviderWorker({
  read = readRecoveryPrivate, write = writeRecoveryPrivate, readCredential, run, log, now = Date.now,
} = {}) {
  if (![read, write, readCredential, run, log, now].every(fn => typeof fn === 'function')) {
    fail('CHIEF_WEB_REAL_PROVIDER_CONFIGURATION_INVALID');
  }

  async function execute(slotId) {
    const request = await read(jobFile(slotId, 'request.json'));
    if (request?.slotId !== slotId || request.schemaVersion !== 1) fail('CHIEF_WEB_REAL_PROVIDER_REQUEST_DENIED');
    const job = envelope({ claim: request, prompt: request.prompt });
    if (request.promptDigest !== job.promptDigest) fail('CHIEF_WEB_REAL_PROVIDER_REQUEST_CHANGED');
    const binding = claimFields(job);
    const receiptFile = jobFile(slotId, 'receipt.json');
    const physicalFile = jobFile(slotId, 'physical.json');
    const previous = await read(receiptFile);
    if (previous) {
      if (!matches(previous, { ...binding, promptDigest: job.promptDigest }) || !matches(await read(physicalFile),
        { ...binding, status: 'claimed', dispatchedAt: previous.dispatchedAt, promptDigest: job.promptDigest })) {
        fail('CHIEF_WEB_REAL_PROVIDER_RECEIPT_UNVERIFIED');
      }
      return { slotId, status: previous.status };
    }
    if (await read(physicalFile)) return { slotId, status: 'unknown' };
    const reservation = await read(jobFile(slotId, 'reservation.json'));
    if (!matches(reservation, { ...binding, status: 'reserved' }) || now() >= job.expiresAt) {
      fail('CHIEF_WEB_REAL_EXECUTION_RESERVATION_DENIED');
    }
    const credential = await readCredential(binding);
    if (!matches(credential, { verified: true, accountFingerprint: binding.accountFingerprint,
      credentialGrantId: binding.credentialGrantId })) fail('CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_DENIED');
    const dispatchedAt = now();
    if (!Number.isSafeInteger(dispatchedAt) || dispatchedAt >= job.expiresAt ||
        !matches(await read(jobFile(slotId, 'reservation.json')), { ...binding, status: 'reserved' })) {
      fail('CHIEF_WEB_REAL_EXECUTION_RESERVATION_DENIED');
    }
    const physical = { ...binding, status: 'claimed', dispatchedAt, promptDigest: job.promptDigest };
    try { await write(physicalFile, physical); }
    catch (error) { if (error?.code === 'EEXIST') return { slotId, status: 'unknown' }; throw error; }

    let receipt;
    try {
      await log({ slotId, role: binding.role, status: 'claimed', code: 'CHIEF_WEB_REAL_MODEL_DISPATCH_CLAIMED' });
      const output = await run({ binding, prompt: job.prompt, credential });
      const decoded = decodeChiefWebRealCodex(output);
      receipt = { ...physical, ...decoded, status: 'completed', physicalCalls: 1,
        resultDigest: chiefWebRealDigest(JSON.stringify(decoded.result)) };
      if (Buffer.byteLength(JSON.stringify(receipt) + '\n') > CHIEF_WEB_REAL_MODEL_FILE_LIMIT) fail('CHIEF_WEB_REAL_PROVIDER_PROTOCOL_DENIED');
    } catch (error) {
      const code = error?.code === 'CHIEF_WEB_REAL_PROVIDER_CREDENTIAL_ROTATED'
        ? error.code : 'CHIEF_WEB_REAL_PROVIDER_OUTCOME_UNKNOWN';
      receipt = { ...physical, status: 'unknown', physicalCalls: 1, code };
    }
    await write(receiptFile, receipt);
    await log({ slotId, role: binding.role, status: receipt.status,
      code: receipt.code ?? 'CHIEF_WEB_REAL_MODEL_RECEIPT_COMMITTED' });
    return { slotId, status: receipt.status };
  }

  return Object.freeze({ execute });
}
