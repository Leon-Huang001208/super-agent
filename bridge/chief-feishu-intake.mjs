import { createHash } from 'node:crypto';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const appId = /^cli_[A-Za-z0-9]{1,200}$/;
const openId = /^ou_[A-Za-z0-9]{1,200}$/;
const messageId = /^om_[A-Za-z0-9]{1,245}$/;
const chatId = /^oc_[A-Za-z0-9]{1,253}$/;
const opaqueId = /^[A-Za-z0-9_-]{1,256}$/;
const eventType = 'im.message.receive_v1';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);

function frozenCopy(value) {
  const copy = structuredClone(value);
  const freeze = object => {
    for (const child of Object.values(object)) if (isObject(child) || Array.isArray(child)) freeze(child);
    return Object.freeze(object);
  };
  return freeze(copy);
}

function trustedBinding(value) {
  if (!isObject(value) || !matches(appId, value.appId) || !matches(opaqueId, value.tenantKey) ||
      !matches(openId, value.ownerOpenId) || !matches(opaqueId, value.nativeOwnerId) ||
      !['companyId', 'projectId', 'chiefAgentId'].every(key => matches(uuid, value[key]))) {
    fail('CHIEF_FEISHU_CONFIGURATION_INVALID');
  }
  // Select only deployment-owned scope. Extra caller fields cannot expand authority.
  return frozenCopy(Object.fromEntries([
    'appId', 'tenantKey', 'ownerOpenId', 'nativeOwnerId', 'companyId', 'projectId', 'chiefAgentId',
  ].map(key => [key, value[key]])));
}

/**
 * Pure intake policy, called only by the authenticated, fixed-app SDK transport.
 * Matching envelope fields do not authenticate an arbitrary HTTP/JSON caller.
 * Native owns task creation, source-ID/body conflicts and durable idempotency.
 */
export function createChiefFeishuIntake({ binding, registerTrustedMessage, resolveProject, log } = {}) {
  if (typeof registerTrustedMessage !== 'function' || typeof log !== 'function') {
    fail('CHIEF_FEISHU_CONFIGURATION_INVALID');
  }
  const scope = trustedBinding(binding);

  async function reject(code, id) {
    await log({ code, ...(matches(messageId, id) && { messageId: id }) });
    return { kind: 'rejected', code };
  }

  return async function receiveChiefFeishuMessage(data) {
    const header = data?.header ?? data;
    const event = data?.event ?? data;
    const message = event?.message;
    if (!isObject(header) || !isObject(event) || !isObject(message) ||
        typeof message.content !== 'string' || message.content.length > 100_000) {
      return reject('CHIEF_FEISHU_MESSAGE_INVALID', message?.message_id);
    }
    let content;
    try { content = JSON.parse(message.content); }
    catch { return reject('CHIEF_FEISHU_MESSAGE_INVALID', message.message_id); }
    if (!isObject(content) || typeof content.text !== 'string') {
      return reject('CHIEF_FEISHU_MESSAGE_INVALID', message.message_id);
    }
    const text = content.text;
    // Preserve all prior command namespaces, including /rwb and /任务.
    if (!/^\/chief(?:[ \t\r\n]|$)/.test(text)) return { kind: 'ignored' };
    if (text.length > 16_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      return reject('CHIEF_FEISHU_MESSAGE_INVALID', message.message_id);
    }
    let goal = text.slice('/chief'.length).trim(),projectSelector;
    if(/^--project(?:\s|$)/.test(goal)){
      const selected=/^--project\s+(?:"([^"]+)"|'([^']+)'|([^\s"']+))\s+([\s\S]+)$/.exec(goal);
      if(!selected)return reject('CHIEF_FEISHU_GOAL_INVALID',message.message_id);
      projectSelector=selected[1]??selected[2]??selected[3];goal=selected[4].trim();
    }
    if (!goal || goal.length > 12_000) return reject('CHIEF_FEISHU_GOAL_INVALID', message.message_id);

    const sender = event.sender;
    const tenantKey = header.tenant_key ?? sender?.tenant_key;
    if (header.event_type !== eventType ||
        (header.app_id !== undefined && header.app_id !== scope.appId) ||
        !isObject(sender) || sender.sender_type !== 'user' ||
        !matches(openId, sender.sender_id?.open_id) || sender.sender_id.open_id !== scope.ownerOpenId ||
        !matches(opaqueId, tenantKey) || tenantKey !== scope.tenantKey ||
        (header.tenant_key !== undefined && sender.tenant_key !== undefined &&
          header.tenant_key !== sender.tenant_key) ||
        message.chat_type !== 'p2p' || message.message_type !== 'text') {
      return reject('CHIEF_FEISHU_IDENTITY_DENIED', message.message_id);
    }
    if (!matches(messageId, message.message_id) || !matches(chatId, message.chat_id) ||
        (header.event_id !== undefined && !matches(opaqueId, header.event_id))) {
      return reject('CHIEF_FEISHU_MESSAGE_INVALID', message.message_id);
    }

    const bodySha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    const sourceParams = {
      source: 'feishu', eventType, appId: scope.appId, tenantKey, ownerOpenId: scope.ownerOpenId,
      messageId: message.message_id, chatId: message.chat_id,
      ...(header.event_id !== undefined && { eventId: header.event_id }), bodySha256,
    };
    let projectId=scope.projectId;
    if(projectSelector){
      if(typeof resolveProject!=='function')fail('CHIEF_FEISHU_PROJECT_RESOLVER_REQUIRED');
      const project=await resolveProject(projectSelector);
      if(!matches(uuid,project?.id))fail('CHIEF_FEISHU_PROJECT_INVALID');
      projectId=project.id;
    }
    const snapshot = frozenCopy({
      schemaVersion: 1, ...scope,projectId,...(projectSelector?{projectSelector}:{}), source: 'feishu', externalId: message.message_id,
      ...(header.event_id !== undefined && { eventId: header.event_id }),
      messageId: message.message_id, chatId: message.chat_id, text, goal, bodySha256, sourceParams,
    });
    try {
      // Replays deliberately reach Native with the same identity and exact body hash.
      // Never retry here: a rejected transport response can follow a committed result.
      return { kind: 'registered', result: await registerTrustedMessage(snapshot) };
    } catch (error) {
      const code = /^(?:CHIEF_FEISHU|TEAM|ROLE|ADMISSION)_[A-Z0-9_]+$/.test(error?.code ?? '')
        ? error.code : 'CHIEF_FEISHU_NATIVE_RESULT_UNKNOWN';
      try { await log({ code, messageId: snapshot.messageId }); } catch { /* Preserve the original Native outcome. */ }
      throw error;
    }
  };
}
