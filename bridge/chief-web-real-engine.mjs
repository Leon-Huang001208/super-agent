import { createHash } from 'node:crypto';

export const REAL_RWB_DOCUMENT = 'docs/super-agent/chief-task-verification.md';
export const REAL_RWB_REPOSITORY = 'Leon-Huang001208/ResearchWorkbench';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const commit = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const stages = { understanding: 'chief', developing: 'developer', reviewing: 'reviewer', approved: 'publish' };
const terminal = new Set(['done', 'blocked']);
const confirmKeys = ['candidateSha', 'reviewDigest', 'baseSha', 'previousHead'];
const confirmationLifetime = 15 * 60_000;

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

export function realDigest(fields) {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function operationId(fields) {
  const hash = realDigest(fields);
  return hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-5' + hash.slice(13, 16) +
    '-8' + hash.slice(17, 20) + '-' + hash.slice(20, 32);
}

function same(value, fields) {
  return Object.entries(fields).every(([key, expected]) => value?.[key] === expected);
}

function failureCode(error, fallback) {
  return /^(CHIEF_WEB_REAL|RWB_REAL)_[A-Z0-9_]{1,70}$/.test(error?.code ?? '') ? error.code : fallback;
}

function publicView(state) {
  const { taskId, identifier, phase, generation, inputRevision, revision, paused, contextRevision, candidate, review, pr, ci, code, attempt } = state;
  return {
    taskId, identifier, phase, generation, inputRevision, revision, paused, contextRevision, pr, ci, code,
    ...(candidate && { candidateSha: candidate.candidateSha, baseSha: candidate.baseSha,
      previousHead: candidate.previousHead, reviewDigest: review?.reviewDigest }),
    ...(attempt && { operationId: attempt.id, operationKind: attempt.role }),
    canConfirm: !paused && phase === 'awaiting_confirmation',
  };
}

export function createChiefWebRealEngine({ repository, config, executor, publisher, log, now = Date.now } = {}) {
  if (![repository?.transaction, repository?.readOwnerMessages, executor?.execute, executor?.observe,
    publisher?.publish, publisher?.observePublication, publisher?.readCi, log, now].every(fn => typeof fn === 'function') ||
    !uuid.test(config?.conversationId ?? '') || !Number.isSafeInteger(config.generation) ||
    !Number.isSafeInteger(config.expiresAt)) fail('CHIEF_WEB_REAL_CONFIGURATION_INVALID');
  let running;

  const first = {
    phase: 'ready', sequence: 0, generation: config.generation, revision: 0, messages: [], results: [],
    controls: [], publications: [], taskId: null, pr: null, paused: false,
  };

  function stateFrom(value) {
    const state = value ?? first;
    if (state.generation !== config.generation) fail('CHIEF_WEB_REAL_GENERATION_CHANGED');
    return { ...state, contextRevision: realDigest([config.conversationId, state.generation, state.sequence]) };
  }

  async function change(tx, state, patch) {
    const next = stateFrom({ ...state, ...patch, sequence: state.sequence + 1 });
    await tx.appendState(next);
    return next;
  }

  async function blocked(tx, state, code) {
    if (state.taskId) await tx.setTask({ taskId: state.taskId, status: 'blocked' });
    return change(tx, state, { phase: 'blocked', code });
  }

  async function control(command) {
    const { action, requestId, generation, expectedRevision } = command ?? {};
    if (!uuid.test(requestId ?? '') || generation !== config.generation || !digest.test(expectedRevision ?? '') ||
      !['pause', 'resume', 'confirm'].includes(action)) fail('CHIEF_WEB_REAL_CONTROL_INVALID', 400);
    return repository.transaction(async tx => {
      const state = stateFrom(await tx.readState());
      const payload = realDigest([action, expectedRevision, ...confirmKeys.map(key => command[key])]);
      const recorded = state.controls.find(row => row.requestId === requestId);
      if (recorded) {
        if (recorded.payload !== payload) fail('CHIEF_WEB_REAL_CONTROL_CONFLICT');
        return publicView(state);
      }
      if (terminal.has(state.phase) || state.contextRevision !== expectedRevision) fail('CHIEF_WEB_REAL_CONTROL_STALE');
      if (state.controls.length >= 64) fail('CHIEF_WEB_REAL_CONTROL_LIMIT');
      const patch = { controls: [...state.controls, { requestId, payload }] };
      if (action === 'confirm') {
        const expected = { ...state.candidate, reviewDigest: state.review?.reviewDigest };
        if (state.paused || state.phase !== 'awaiting_confirmation' || !confirmKeys.every(key => command[key] === expected[key]) ||
            now() >= config.expiresAt) fail('CHIEF_WEB_REAL_CONFIRMATION_STALE');
        patch.phase = 'approved';
        patch.confirmation = { requestId, candidateSha: expected.candidateSha, reviewDigest: expected.reviewDigest,
          baseSha: expected.baseSha, previousHead: expected.previousHead, expiresAt: Math.min(now() + confirmationLifetime, config.expiresAt) };
      } else {
        patch.paused = action === 'pause';
        if (state.phase === 'approved' && patch.paused && !state.attempt) {
          patch.phase = 'awaiting_confirmation';
          patch.confirmation = null;
        }
      }
      return publicView(await change(tx, state, patch));
    });
  }

  async function nextWork() {
    const messages = await repository.readOwnerMessages();
    return repository.transaction(async tx => {
      let state = stateFrom(await tx.readState());
      if (terminal.has(state.phase)) return null;
      const mayAdmit = !state.paused && now() < config.expiresAt && (!state.attempt || state.attempt.role === 'ci') &&
        (state.phase === 'ready' ||
        (['waiting_ci', 'awaiting_supplement'].includes(state.phase) && state.revision === 1));
      const message = mayAdmit && messages.find(row => uuid.test(row.id) && row.generation === state.generation &&
        typeof row.text === 'string' && row.text.trim() && row.text.length <= 4000 && !state.messages.includes(row.id));
      if (message) {
        const inputs = [...state.messages, message.id];
        state = await change(tx, state, { phase: 'understanding', revision: state.revision + 1, messages: inputs,
          inputRevision: realDigest([config.conversationId, state.generation, inputs, realDigest(message.text)]),
          candidate: null, review: null, confirmation: null, ci: null, attempt: null });
      }
      if (state.attempt) {
        if (state.attempt.role === 'ci' && state.paused) return null;
        return { state, fresh: false, messages };
      }
      if (state.paused) return null;
      if (now() >= config.expiresAt) {
        await blocked(tx, state, 'CHIEF_WEB_REAL_SCOPE_EXPIRED');
        return null;
      }
      const role = stages[state.phase] ?? (state.phase === 'waiting_ci' ? 'ci' : null);
      if (!role) return null;
      if (role === 'publish' && (!state.confirmation || now() >= state.confirmation.expiresAt)) {
        await change(tx, state, { phase: 'awaiting_confirmation', confirmation: null, code: 'CHIEF_WEB_REAL_CONFIRMATION_EXPIRED' });
        return null;
      }
      const id = operationId([config.conversationId, state.generation, state.inputRevision, role]);
      state = await change(tx, state, { attempt: { id, role, reservedAt: now() } });
      return { state, fresh: true, messages };
    });
  }

  function requestFor(state, messages) {
    const { taskId, inputRevision, revision, attempt, pr, candidate, review, requirements, confirmation } = state;
    const text = messages.find(row => row.id === state.messages.at(-1) && row.generation === state.generation)?.text;
    if (attempt.role === 'chief' && (!text ||
        realDigest([config.conversationId, config.generation, state.messages, realDigest(text)]) !== inputRevision)) {
      fail('CHIEF_WEB_REAL_MESSAGE_UNAVAILABLE');
    }
    return {
      taskId, conversationId: config.conversationId, generation: config.generation, inputRevision, revision,
      role: attempt.role, slotId: attempt.id, operationId: attempt.id, targetDoc: REAL_RWB_DOCUMENT,
      repository: REAL_RWB_REPOSITORY, text: attempt.role === 'chief' ? text : undefined,
      requirements, taskDescription: requirements, pr, confirmation,
      candidateSha: candidate?.candidateSha, baseSha: candidate?.baseSha,
      branch: candidate?.branch ?? pr?.branch, previousHead: candidate?.previousHead ?? pr?.headSha ?? null,
      reviewDigest: review?.reviewDigest, headSha: pr?.headSha,
    };
  }

  function prepareResult(state, role, reply) {
    if (!same(reply, { status: 'completed', operationId: state.attempt.id, inputRevision: state.inputRevision }) ||
        !digest.test(reply.evidenceDigest ?? '')) fail('CHIEF_WEB_REAL_RECEIPT_MISMATCH');
    if (reply.taskId !== state.taskId) fail('CHIEF_WEB_REAL_RECEIPT_MISMATCH');
    const result = reply.result;
    if (!result || typeof result !== 'object') fail('CHIEF_WEB_REAL_RECEIPT_MISMATCH');
    if (role === 'chief') {
      if (result.accepted !== true || result.targetDoc !== REAL_RWB_DOCUMENT || typeof result.requirements !== 'string' ||
          !result.requirements.trim() || result.requirements.length > 4000) fail('CHIEF_WEB_REAL_INTENT_DENIED');
    } else if (role === 'developer') {
      if (!commit.test(result.candidateSha ?? '') || !commit.test(result.baseSha ?? '') ||
          result.candidateSha === result.baseSha || !/^codex\/[a-z0-9-]+$/.test(result.branch ?? '') ||
          result.checksPassed !== true || (state.pr && (result.branch !== state.pr.branch ||
            result.candidateSha === state.pr.headSha))) fail('CHIEF_WEB_REAL_CANDIDATE_UNVERIFIED');
    } else if (role === 'reviewer') {
      if (!same(result, { approved: true, candidateSha: state.candidate.candidateSha }) ||
          !digest.test(result.reviewDigest ?? '')) fail('CHIEF_WEB_REAL_REVIEW_BLOCKED');
    } else if (role === 'publish') {
      if (!same(result, { headSha: state.candidate.candidateSha, branch: state.candidate.branch, baseSha: state.candidate.baseSha }) ||
          !Number.isSafeInteger(result.number) || result.number < 1 ||
          result.url !== 'https://github.com/' + REAL_RWB_REPOSITORY + '/pull/' + result.number ||
          (state.pr && result.number !== state.pr.number)) fail('CHIEF_WEB_REAL_PUBLICATION_UNVERIFIED');
    } else if (!same(result, { headSha: state.pr.headSha, number: state.pr.number }) ||
        !['success', 'failure'].includes(result.conclusion) || !digest.test(result.checksDigest ?? '')) {
      fail('CHIEF_WEB_REAL_CI_MISMATCH');
    }
    return result;
  }

  async function settle(work, reply) {
    const role = work.state.attempt.role;
    return repository.transaction(async tx => {
      const state = stateFrom(await tx.readState());
      if (state.attempt?.id !== work.state.attempt.id || terminal.has(state.phase)) return false;
      if (reply?.status === 'pending') return false;
      if (role === 'ci' && reply?.status === 'completed' &&
          (reply.result?.headSha !== state.pr.headSha || reply.result?.number !== state.pr.number)) return false;
      try {
        if (reply?.status === 'blocked' || reply?.status === 'unknown') {
          fail(failureCode(reply, 'CHIEF_WEB_REAL_OPERATION_UNKNOWN'));
        }
        const result = prepareResult(state, role, reply);
        const patch = { attempt: null, code: null, results: [...state.results,
          { role, inputRevision: state.inputRevision, operationId: state.attempt.id, evidenceDigest: reply.evidenceDigest }] };
        if (role === 'chief') {
          const requirements = state.requirements ? state.requirements + '\n\n补充：' + result.requirements : result.requirements;
          const description = '目标文档：' + REAL_RWB_DOCUMENT + '\n\n' + requirements;
          if (!state.taskId) {
            const task = await tx.createTask({ title: '验证 Chief 真实任务交付', description });
            if (!uuid.test(task?.id ?? '') || typeof task.identifier !== 'string') fail('CHIEF_WEB_REAL_NATIVE_TASK_UNAVAILABLE');
            Object.assign(patch, { taskId: task.id, identifier: task.identifier });
          } else {
            await tx.setTask({ taskId: state.taskId, status: 'in_progress', description });
          }
          Object.assign(patch, { phase: 'developing', requirements });
        } else if (role === 'developer') {
          Object.assign(patch, { phase: 'reviewing', candidate: { candidateSha: result.candidateSha, baseSha: result.baseSha,
            branch: result.branch, previousHead: state.pr?.headSha ?? null } });
        } else if (role === 'reviewer') {
          Object.assign(patch, { phase: 'awaiting_confirmation', review: { reviewDigest: result.reviewDigest } });
        } else if (role === 'publish') {
          Object.assign(patch, { phase: 'waiting_ci', pr: result, confirmation: null,
            publications: [...state.publications, { ...result, inputRevision: state.inputRevision }] });
          await tx.setTask({ taskId: state.taskId, status: 'in_review' });
        } else {
          const phase = result.conclusion === 'failure' ? 'blocked' : state.revision === 2 ? 'done' : 'awaiting_supplement';
          Object.assign(patch, { phase, ci: result, code: phase === 'blocked' ? 'CHIEF_WEB_REAL_CI_FAILED' : null });
          if (terminal.has(phase)) await tx.setTask({ taskId: state.taskId, status: phase });
        }
        await change(tx, state, patch);
        return true;
      } catch (error) {
        if (failureCode(error, null) === null) throw error;
        await blocked(tx, state, failureCode(error, 'CHIEF_WEB_REAL_OPERATION_BLOCKED'));
        return false;
      }
    });
  }

  async function tick() {
    const work = await nextWork();
    if (!work) return;
    const role = work.state.attempt.role;
    let reply;
    try {
      const request = requestFor(work.state, work.messages);
      reply = role === 'ci' ? await publisher.readCi(request) : role === 'publish'
        ? await publisher[work.fresh ? 'publish' : 'observePublication'](request)
        : await executor[work.fresh ? 'execute' : 'observe'](request);
    } catch (error) {
      reply = { status: 'unknown', code: failureCode(error, 'CHIEF_WEB_REAL_OPERATION_UNKNOWN') };
    }
    const moved = await settle(work, reply);
    await log({ code: 'CHIEF_WEB_REAL_TICK', operationId: work.state.attempt.id, role, moved });
  }

  return Object.freeze({
    status: () => repository.transaction(async tx => publicView(stateFrom(await tx.readState()))),
    control,
    tick() {
      if (!running) running = tick().finally(() => { running = undefined; });
      return running;
    },
  });
}
