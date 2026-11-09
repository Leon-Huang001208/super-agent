const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const actions = new Set(['pause', 'resume', 'confirm']);
const labels = { pause: '暂停', resume: '继续', confirm: '确认更新原 PR' };

function safeCode(code) {
  return typeof code === 'string' && /^CHIEF_WEB_[A-Z_]+$/.test(code) ? code : 'CHIEF_WEB_STATUS_UNAVAILABLE';
}

function createChiefWebRequest(issueId, endpoint, fetcher) {
  if (typeof issueId !== 'string' || !uuid.test(issueId)) throw new Error('CHIEF_WEB_CONVERSATION_INVALID');
  const path = '/api/issues/' + issueId + '/' + endpoint;
  return async (body, signal) => {
    const options = { credentials: 'same-origin', cache: 'no-store', signal };
    if (body) Object.assign(options, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const response = await fetcher(path, options);
    if (!body && response.status === 404) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(safeCode(data?.code));
    return data;
  };
}

export function createChiefWebClient(issueId, fetcher = globalThis.fetch) {
  const request = createChiefWebRequest(issueId, 'chief-web-pilot', fetcher);
  return {
    status: signal => request(null, signal),
    control(command, signal) {
      if (!actions.has(command?.action)) throw new Error('CHIEF_WEB_ACTION_INVALID');
      return request(command, signal);
    },
  };
}

function panelText(view) {
  if (view.code) return '需要处理 · ' + safeCode(view.code);
  if (view.historical) return '历史任务已完成 · 等待本次补充';
  if (view.control === 'paused') return '本次续接已暂停';
  if (view.phase === 'done') return '本次续接完成 · 最新 PR head 的 CI 已通过';
  if (view.phase === 'awaiting_confirmation') return '候选已就绪 · 等待本人确认';
  if (view.phase === 'waiting_ci') return '原 PR 已更新 · 等待当前 head 的 CI';
  if (view.phase === 'blocked') return '本次续接受阻';
  return '本次续接处理中';
}

function ChiefWebContinuation({ issueId }) {
  const { react } = globalThis.__paperclipPluginBridge__;
  const { createElement: el, useEffect, useRef, useState } = react;
  const [model, setModel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const live = useRef(null);

  useEffect(() => {
    setModel(null);
    setError(null);
    setBusy(false);
    if (typeof issueId !== 'string' || !uuid.test(issueId)) return;
    const controller = new AbortController();
    const client = createChiefWebClient(issueId);
    const current = { issueId, controller, busy: false, available: null, sequence: 0, timer: null };
    live.current = current;
    current.refresh = async () => {
      const sequence = ++current.sequence;
      try {
        const view = await client.status(controller.signal);
        if (controller.signal.aborted || sequence !== current.sequence) return;
        current.available = Boolean(view);
        setModel(view ? { issueId, view } : null);
      } catch (cause) {
        if (!controller.signal.aborted && sequence === current.sequence) {
          setError(safeCode(cause?.message));
        }
      }
    };
    async function poll() {
      await current.refresh();
      if (current.available !== false && !controller.signal.aborted) current.timer = globalThis.setTimeout(poll, 15_000);
    }
    current.control = command => client.control(command, controller.signal);
    void poll();
    return () => {
      controller.abort();
      globalThis.clearTimeout(current.timer);
      if (live.current === current) live.current = null;
    };
  }, [issueId]);

  if (model?.issueId !== issueId || !model?.view) return null;
  const view = model.view;

  async function send(control) {
    const current = live.current;
    if (current?.issueId !== issueId || current.busy) return;
    current.busy = true;
    setBusy(true);
    setError(null);
    const command = { ...control, contextRevision: view.contextRevision, requestId: globalThis.crypto.randomUUID() };
    try {
      await current.control(command);
    } catch (cause) {
      if (!current.controller.signal.aborted) setError(safeCode(cause?.message));
    } finally {
      if (!current.controller.signal.aborted) {
        await current.refresh();
        if (!current.controller.signal.aborted) {
          current.busy = false;
          setBusy(false);
        }
      }
    }
  }

  return el('section', { 'aria-label': 'RWB #261 网页续接' },
    el('p', { role: 'status' }, panelText(view)),
    el('p', null, el('a', { href: 'https://github.com/Leon-Huang001208/ResearchWorkbench/pull/261' }, 'RWB PR #261'),
      view.prHead ? ' · ' + view.prHead.slice(0, 12) : ''),
    error ? el('p', { role: 'alert' }, error) : null,
    el('div', { className: 'flex flex-wrap gap-2' },
      el('button', { type: 'button', disabled: busy, onClick: () => void live.current?.refresh() }, '刷新状态'),
      ...(Array.isArray(view.actions) ? view.actions : []).filter(item => actions.has(item?.action) &&
        (item.action !== 'confirm' || typeof item.candidate === 'string')).map(item =>
        el('button', { type: 'button', key: item.action, disabled: busy, onClick: () => void send(item) },
          item.action === 'confirm' ? labels.confirm + ' · ' + item.candidate.slice(0, 12) : labels[item.action]))));
}

export function createChiefWebEvaluationClient(issueId, fetcher = globalThis.fetch) {
  const request = createChiefWebRequest(issueId, 'chief-web-evaluation', fetcher);
  return {
    status: signal => request(null, signal),
    create: (generation, requestId, signal) => request({ action: 'create', generation, requestId }, signal),
  };
}

const evaluationLabels = {
  ready: '可以创建网页演练任务',
  queued: '已登记 · 等待测试执行器',
  running: '测试执行器处理中',
  waiting_ci: '测试执行已完成 · 等待当前候选的模拟 CI',
  done: '演练完成 · 当前候选的模拟 CI 已通过',
  blocked: '演练受阻 · 请查看回执',
  closed: '此对话代际的演练入口已关闭',
};

function ChiefWebEvaluation({ issueId }) {
  const { react } = globalThis.__paperclipPluginBridge__;
  const { createElement: el, useEffect, useRef, useState } = react;
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const live = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const client = createChiefWebEvaluationClient(issueId);
    const current = { busy: false, requestId: null, generation: null, revision: 0 };
    live.current = current;
    let timer;
    async function poll() {
      try {
        if (!current.busy) {
          const revision = current.revision;
          const next = await client.status(controller.signal);
          if (controller.signal.aborted) return;
          if (revision === current.revision) {
            if (!next) return;
            setView(next);
            if (['done', 'blocked', 'closed'].includes(next.phase)) return;
          }
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(safeCode(cause?.message));
      }
      if (!controller.signal.aborted) timer = globalThis.setTimeout(poll, 1500);
    }
    current.create = async generation => {
      if (current.busy || controller.signal.aborted) return;
      current.busy = true;
      current.revision++;
      if (generation !== current.generation) {
        current.generation = generation;
        current.requestId = globalThis.crypto.randomUUID();
      }
      setBusy(true);
      setError(null);
      try {
        const next = await client.create(generation, current.requestId, controller.signal);
        if (!controller.signal.aborted) setView(next);
      } catch (cause) {
        if (!controller.signal.aborted) setError(safeCode(cause?.message));
      } finally {
        current.busy = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    void poll();
    return () => {
      controller.abort();
      globalThis.clearTimeout(timer);
      if (live.current === current) live.current = null;
    };
  }, [issueId]);

  if (!view) return null;
  return el('section', { 'aria-label': 'Chief 网页新建任务演练', className: 'space-y-2 p-2' },
    el('p', { role: 'status' }, evaluationLabels[view.phase]),
    view.taskId ? el('p', null, '任务 ' + view.identifier + ' · ' + view.taskId) : null,
    view.candidateSha ? el('p', null, '本次候选 ' + view.candidateSha) : null,
    view.receipt?.kind === 'ci' ? el('p', null, '模拟 CI 回执 · ' + view.receipt.conclusion) : null,
    view.leaseReleased && view.candidateSha ? el('p', null, '执行租约已释放') : null,
    error || view.code ? el('p', { role: 'alert' }, error ?? safeCode(view.code)) : null,
    view.phase === 'ready' ? el('button', {
      type: 'button', disabled: busy, className: 'rounded-md border border-border px-3 py-1.5 text-sm cursor-pointer',
      onClick: () => void live.current?.create(view.generation),
    }, '新建演练任务') : null);
}

export function createChiefWebRealClient(issueId, fetcher = globalThis.fetch) {
  const request = createChiefWebRequest(issueId, 'chief-web-real', fetcher);
  return { status: signal => request(null, signal), control: (command, signal) => request(command, signal) };
}

const realLabels = {
  ready: '在 Chief 对话中输入任务要求',
  understanding: 'Chief 正在理解本次要求',
  developing: '测试与文档修改进行中',
  reviewing: '候选正在接受独立评审',
  awaiting_confirmation: '候选已就绪，等待你确认',
  approved: '已确认，正在发布本次候选',
  waiting_ci: '等待当前 PR head 的 CI',
  awaiting_supplement: '当前 head 的 CI 已通过，可以在原对话补充一次要求',
  done: '任务完成，最新 PR head 的 CI 已通过',
  blocked: '任务受阻，请查看本次回执',
};

function ChiefWebRealTask({ issueId }) {
  const { react } = globalThis.__paperclipPluginBridge__;
  const { createElement: el, useEffect, useRef, useState } = react;
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const live = useRef(null);

  useEffect(() => {
    const client = createChiefWebRealClient(issueId);
    const controller = new AbortController();
    const current = { busy: false, revision: 0, retry: null };
    live.current = current;
    let timer;

    current.refresh = async () => {
      const revision = current.revision;
      try {
        const next = await client.status(controller.signal);
        if (controller.signal.aborted || revision !== current.revision) return undefined;
        setView(next);
        return next;
      } catch (cause) {
        if (!controller.signal.aborted && revision === current.revision) setError(safeCode(cause?.message));
        return undefined;
      }
    };

    async function poll() {
      const next = current.busy ? undefined : await current.refresh();
      if (!controller.signal.aborted && next !== null && !['done', 'blocked'].includes(next?.phase)) {
        timer = globalThis.setTimeout(poll, 2500);
      }
    }

    current.control = async command => {
      if (current.busy || controller.signal.aborted) return;
      const key = JSON.stringify(command);
      if (current.retry?.key !== key) current.retry = { key, id: globalThis.crypto.randomUUID() };
      current.busy = true;
      current.revision++;
      setBusy(true);
      setError(null);
      try {
        const next = await client.control({ ...command, requestId: current.retry.id }, controller.signal);
        if (!controller.signal.aborted) setView(next);
      } catch (cause) {
        if (!controller.signal.aborted) setError(safeCode(cause?.message));
      } finally {
        if (!controller.signal.aborted) {
          current.busy = false;
          setBusy(false);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      globalThis.clearTimeout(timer);
      if (live.current === current) live.current = null;
    };
  }, [issueId]);

  if (!view) return null;
  const { phase, paused, taskId, identifier, generation, contextRevision, candidateSha, reviewDigest, previousHead, baseSha, pr, ci } = view;
  const prUrl = typeof pr?.url === 'string' && /^https:\/\/github\.com\/Leon-Huang001208\/ResearchWorkbench\/pull\/[1-9][0-9]*$/.test(pr.url) ? pr.url : null;
  const canControl = !['done', 'blocked'].includes(phase);
  const buttonClass = 'rounded-md border border-border px-3 py-1.5 text-sm cursor-pointer';

  function send(action) {
    void live.current?.control({ action, generation, expectedRevision: contextRevision,
      ...(action === 'confirm' && { candidateSha, reviewDigest, previousHead, baseSha }) });
  }

  return el('section', { 'aria-label': 'Chief 真实 RWB 任务', className: 'space-y-2 p-2' },
    el('p', { role: 'status' }, paused ? '任务已暂停' : (realLabels[phase] ?? '任务处理中')),
    taskId ? el('p', null, 'Paperclip 任务 ' + identifier + ' · ' + taskId) : null,
    view.inputRevision ? el('p', null, '输入版本 ' + view.revision + ' · ' + view.inputRevision) : null,
    prUrl ? el('p', null, el('a', { href: prUrl }, 'RWB PR #' + pr.number), ' · ' + pr.headSha) : null,
    ci ? el('p', null, 'CI ' + ci.conclusion + ' · ' + ci.headSha) : null,
    view.canConfirm ? el('p', null, '待确认候选 ' + candidateSha) : null,
    error || view.code ? el('p', { role: 'alert' }, error ?? safeCode(view.code)) : null,
    el('div', { className: 'flex flex-wrap gap-2' },
      el('button', { type: 'button', className: buttonClass, disabled: busy, onClick: () => void live.current?.refresh() }, '刷新状态'),
      canControl ? el('button', { type: 'button', className: buttonClass, disabled: busy,
        onClick: () => send(paused ? 'resume' : 'pause') }, paused ? '继续任务' : '暂停任务') : null,
      view.canConfirm ? el('button', { type: 'button', className: buttonClass, disabled: busy,
        onClick: () => send('confirm') }, prUrl ? '确认更新同一 PR' : '确认创建 PR') : null));
}

export function ChiefWebPilotPanel() {
  const { react, sdkUi } = globalThis.__paperclipPluginBridge__;
  const { createElement: el, Fragment } = react;
  const context = sdkUi.useHostContext();
  const issueId = context.entityType === 'issue' &&
    /(?:^|\/)chats\/[^/]+\/?$/.test(globalThis.location.pathname) ? context.entityId : null;
  if (typeof issueId !== 'string' || !uuid.test(issueId)) return null;
  return el(Fragment, null,
    el(ChiefWebContinuation, { key: `pilot:${issueId}`, issueId }),
    el(ChiefWebEvaluation, { key: `evaluation:${issueId}`, issueId }),
    el(ChiefWebRealTask, { key: `real:${issueId}`, issueId }));
}
