import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = data => createHash('sha256').update(data).digest('hex');
const pins = {
  'app/bridge/unified-runtime/gateway.mjs': 'a73bd54946dbe1a205db6d2b415e8aee366da48527ebbceb6dca7faba8d1c18a',
  'app/bridge/unified-main.mjs': '3c014da8b3e8dfdba66be4ed5e17a01ead24495be42018ea805e6638b7ed6282',
  'app/bridge/integration-native/index.mjs': 'de7332f0798e7bc696868d8a14d2e0f9482f087959c90f0f6f1f136be01c8dc0',
  'feishu/bridge/unified-feishu.mjs': 'aa3633dde3b8591e14da5ef862a86086e1b19a5bb90fd1e8fcaaf824f3bc4b7b',
};

function replaceOnce(source, anchor, replacement) {
  if (!source.includes(anchor) || source.indexOf(anchor) !== source.lastIndexOf(anchor)) throw new Error('FRA_OVERLAY_ANCHOR_MISMATCH');
  return source.replace(anchor, () => replacement);
}

function patchGateway(source) {
  source = "import { maybeRegisterFeishuAutoRwb } from '../feishu-auto-rwb-gateway.mjs';\n" +
    "import { codePathsFromGoal } from '../task-identity.mjs';\n" + source;
  source = replaceOnce(source, 'ownerOpenId, log, onAccepted } = {})', 'ownerOpenId, log, onAccepted, autoAdmission } = {})');
  const marker = '    const match = new RegExp(';
  return replaceOnce(source, marker,
    '    const scoped = await maybeRegisterFeishuAutoRwb({ admission: autoAdmission, native, text, operationId, externalRef, sourceEventKey, ownerOpenId, onAccepted, codePathsFromGoal, log });\n' +
    '    if (scoped !== null) return scoped;\n' + marker);
}

function patchMain(source) {
  source = "import { createFeishuAutoRwbAdmission } from './feishu-auto-rwb-admission.mjs';\n" + source;
  const runtimeState = '  let loaded, gateway, epoch, closing, stopped = false, refreshPending, drainFailed = false, fatalCode;';
  source = replaceOnce(source, runtimeState, runtimeState +
    '\n  const autoAdmission = createFeishuAutoRwbAdmission({ root, now: clock, readTaskContext: taskId => loaded.native.getTaskContext({ taskId }) });');
  source = replaceOnce(source, 'try { next = validateUnifiedConfig(await readConfig()); }',
    'try { next = validateUnifiedConfig(await autoAdmission.runtimeConfig(validateUnifiedConfig(await readConfig()))); }');
  const taskPolicy = '      now: clock, readTaskPolicy: createRootTaskPolicy({ identity: loaded.identity, config: next, clock }), readOutboundReceipt,';
  source = replaceOnce(source, taskPolicy, [
    '      now: clock, async readTaskPolicy(input) {',
    '        const scope = autoAdmission.lookup(input.task?.taskId);',
    '        if (scope && (!autoAdmission.enabled() || scope.inputRevision !== input.context?.inputRevision ||',
    "            input.context.fullTaskInput?.taskKind !== 'code_patch' ||",
    "            scope.pathsJson !== input.context.fullTaskInput.codeAllowedPathsJson)) fail('US_TASK_POLICY_DENIED');",
    '        return createRootTaskPolicy({ identity: loaded.identity, config: next, clock })(input);',
    '      }, readOutboundReceipt,',
  ].join('\n'));
  const marker = '    gateway = createGateway({ native: loaded.native, ownerOpenId: loaded.ownerOpenId, token, log,';
  return replaceOnce(source, marker, marker + ' autoAdmission,');
}

function patchNative(source) {
  return replaceOnce(source, '    const targetDoc = target(input);', [
    '    const scoped = input.autoScopePathsJson;',
    "    if (scoped !== undefined && (input.source !== 'feishu' || input.targetDoc !== undefined ||",
    "        typeof scoped !== 'string' || scoped !== codePathsFromGoal(goal))) fail('IN_CODE_TARGET_PROTECTED');",
    '    const targetDoc = scoped === undefined ? target(input) : null;',
  ].join('\n'));
}

function patchFeishu(source) {
  source = "import { createFeishuAutoRwbAdmission } from './feishu-auto-rwb-admission.mjs';\n" +
    "import { describeFeishuAutoRwbBlocked } from './feishu-auto-rwb-gateway.mjs';\n" + source;
  const register = '    const result = await native.registerFeishu(copied); active();';
  source = replaceOnce(source, register, [
    "    const blockedAck = 'auto-blocked:' + hash([event.message.chat_id, event.message.message_id]);",
    "    if (db.prepare('SELECT operation_id FROM deliveries WHERE operation_id=?').get(blockedAck)) return { type: 'ignored', ignored: true };",
    register,
  ].join('\n'));
  const ignored = "    if (result?.type === 'ignored' || result?.ignored === true) return { ...result, ignored: true };";
  source = replaceOnce(source, ignored, ignored + '\n' + [
    "    if (result?.type === 'scoped_blocked' && result.status === 'blocked' && id(result.operationId) && typeof result.code === 'string') {",
    '      const operationId = blockedAck;',
    "      const text = describeFeishuAutoRwbBlocked(result.code);",
    "      const input = { messageId: event.message.message_id, ownerOpenId: expectedOwner, type: result.type, textHash: hash(text) };",
    "      if (await owner() !== expectedOwner) throw fail('UF_OWNER_REQUIRED');",
    "      if (claim(operationId, input)) {",
    "        try {",
    "          const response = await sdkClient.im.message.reply({ path: { message_id: event.message.message_id },",
    "            data: { msg_type: 'text', content: JSON.stringify({ text }), uuid: uuidFor(operationId) } });",
    "          settle(operationId, response);",
    "        } catch { emit('UF_ACK_UNKNOWN'); }",
    "      }",
    "      return result;",
    "    }",
  ].join('\n'));
  const completion = '      resultKey = hash([request.taskId, request.headSha]);';
  return replaceOnce(source, completion, [
    '      const scope = await createFeishuAutoRwbAdmission({ root }).lookup(request.taskId);',
    "      if (scope) {",
    "        if (scope.ownerOpenId !== expectedOwner || scope.inputRevision !== context.inputRevision) throw fail('UF_COMPLETION_UNVERIFIED');",
    "        text += '\\n输入版本：' + scope.version + '\\nCI：通过';",
    '      }',
    completion,
  ].join('\n'));
}

const transforms = [patchGateway, patchMain, patchNative, patchFeishu];
const added = ['feishu-auto-rwb-policy.mjs', 'feishu-auto-rwb-admission.mjs', 'feishu-auto-rwb-gateway.mjs'];

function readRegular(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(filename) !== filename) throw new Error('FRA_OVERLAY_INPUT_UNSAFE');
  return fs.readFileSync(filename);
}

export function prepareFeishuAutoRwbOverlay(appRoot, feishuRoot, output) {
  for (const root of [appRoot, feishuRoot]) {
    if (path.resolve(root) !== root || fs.realpathSync(root) !== root) throw new Error('FRA_OVERLAY_ROOT_INVALID');
  }
  if (!path.isAbsolute(output) || fs.existsSync(output)) throw new Error('FRA_OVERLAY_OUTPUT_INVALID');
  const files = new Map();
  for (const [index, [filename, expected]] of Object.entries(pins).entries()) {
    const slash = filename.indexOf('/');
    const root = filename.startsWith('app/') ? appRoot : feishuRoot;
    const input = readRegular(path.join(root, filename.slice(slash + 1)));
    if (digest(input) !== expected) throw new Error('FRA_OVERLAY_BASE_MISMATCH:' + filename);
    files.set(filename, transforms[index](input.toString('utf8')));
  }
  for (const filename of added) {
    const data = readRegular(path.join(sourceRoot, 'bridge', filename));
    files.set('app/bridge/' + filename, data);
    files.set('feishu/bridge/' + filename, data);
  }
  fs.mkdirSync(output, { mode: 0o700 });
  for (const [filename, data] of files) {
    const destination = path.join(output, filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
    fs.writeFileSync(destination, data, { flag: 'wx', mode: 0o644 });
  }
  for (const [role, service, mountRoot] of [['app', 'paperclip', '/opt/super-agent/task'], ['feishu', 'feishu-connection', '/integration']]) {
    const volumes = [...files.keys()].filter(file => file.startsWith(role + '/')).map(file => ({
      type: 'bind',
      source: path.join(output, file),
      target: mountRoot + '/' + file.slice((role === 'feishu' ? 'feishu/bridge/' : 'app/').length),
      read_only: true,
      bind: { create_host_path: false },
    }));
    fs.writeFileSync(path.join(output, role + '.compose.json'), JSON.stringify({ services: { [service]: { volumes } } }) + '\n',
      { flag: 'wx', mode: 0o600 });
  }
  const receipt = { schemaVersion: 1, files: [...files].map(([file, data]) => ({ file, baseSha256: pins[file] ?? null, sha256: digest(data) })) };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('FRA_OVERLAY_ARGUMENT_INVALID');
    const receipt = prepareFeishuAutoRwbOverlay(...process.argv.slice(2));
    console.log(JSON.stringify({ code: 'FRA_OVERLAY_PREPARED', files: receipt.files.length }));
  } catch (error) {
    console.error(JSON.stringify({ code: /^FRA_[A-Z_:a-z/.-]+$/.test(error?.message ?? '') ? error.message : 'FRA_OVERLAY_FAILED' }));
    process.exitCode = 1;
  }
}
