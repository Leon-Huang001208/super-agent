const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const actions = new Set(['pause', 'resume', 'confirm']);
const labels = { pause: '暂停', resume: '继续', confirm: '确认更新原 PR' };

function safeCode(code) {
  return typeof code === 'string' && /^CHIEF_WEB_[A-Z_]+$/.test(code) ? code : 'CHIEF_WEB_STATUS_UNAVAILABLE';
}

export function createChiefWebClient(issueId, fetcher = globalThis.fetch) {
  if (typeof issueId !== 'string' || !uuid.test(issueId)) throw new Error('CHIEF_WEB_CONVERSATION_INVALID');
  const path = '/api/issues/' + issueId + '/chief-web-pilot';
  async function request(body, signal) {
    const options = { credentials: 'same-origin', cache: 'no-store', signal };
    if (body) Object.assign(options, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const response = await fetcher(path, options);
    if (!body && response.status === 404) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(safeCode(data?.code));
    return data;
  }
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

export function ChiefWebPilotPanel() {
  const { react, sdkUi } = globalThis.__paperclipPluginBridge__;
  const { createElement: el, useEffect, useRef, useState } = react;
  const context = sdkUi.useHostContext();
  const issueId = context.entityType === 'issue' &&
    /(?:^|\/)chats\/[^/]+\/?$/.test(globalThis.location.pathname) ? context.entityId : null;
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
    const current = { issueId, controller, busy: false, available: false, sequence: 0, timer: null };
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
      if (current.available && !controller.signal.aborted) current.timer = globalThis.setTimeout(poll, 15_000);
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
