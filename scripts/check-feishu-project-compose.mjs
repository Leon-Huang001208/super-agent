import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = 'super-agent-paperclip-eval';
const root = '/Volumes/SuperAgentDockerData/paperclip-v2026.1023.0';
const docker = (args, options) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, ...options });
const env = { ...process.env, SUPER_AGENT_DATA_ROOT: root };
const fail = field => { throw new Error('FRA_COMPOSE_DRIFT:' + field); };
const envMap = values => Object.fromEntries(values.map(entry => {
  const index = entry.indexOf('=');
  return [entry.slice(0, index), entry.slice(index + 1)];
}));
const sorted = values => JSON.stringify([...values].sort());
const keys = value => sorted(Object.keys(value ?? {}));
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function securityOptions(values, cwd) {
  return sorted((values ?? []).map(value => {
    const seccomp = /^seccomp[=:](.+)$/.exec(value);
    if (!seccomp) return value.replace('=', ':');
    if (seccomp[1] === 'unconfined') return 'seccomp:unconfined';
    const profile = seccomp[1].startsWith('{') ? seccomp[1] : fs.readFileSync(path.resolve(cwd, seccomp[1]), 'utf8');
    return 'seccomp:' + canonical(JSON.parse(profile));
  }));
}

export function checkFeishuProjectCompose(overlay, name) {
  if (!['paperclip', 'feishu-connection'].includes(name) || !path.isAbsolute(overlay)) fail('argument');
  const [running] = JSON.parse(docker(['inspect', project + '-' + name + '-1']));
  const labels = running.Config.Labels;
  const originals = labels['com.docker.compose.project.config_files']?.split(',') ?? [];
  const cwd = labels['com.docker.compose.project.working_dir'];
  if (labels['com.docker.compose.project'] !== project || labels['com.docker.compose.service'] !== name ||
      !path.isAbsolute(cwd) || !originals.length || originals.some(file => !path.isAbsolute(file) || !fs.existsSync(file))) fail('identity');
  const overlayDocument = JSON.parse(fs.readFileSync(overlay, 'utf8'));
  const overlayServices = overlayDocument.services;
  const additions = overlayServices?.[name]?.volumes;
  if (keys(overlayDocument) !== sorted(['services']) || keys(overlayServices) !== sorted([name]) ||
      keys(overlayServices[name]) !== sorted(['volumes']) || !Array.isArray(additions) || !additions.length ||
      additions.some(volume => keys(volume) !== sorted(['type', 'source', 'target', 'read_only', 'bind']) ||
        volume.type !== 'bind' || volume.read_only !== true || keys(volume.bind) !== sorted(['create_host_path']) ||
        volume.bind?.create_host_path !== false)) fail('overlay');
  const overlayRoot = path.dirname(overlay);
  const { files } = JSON.parse(fs.readFileSync(path.join(overlayRoot, 'manifest.json'), 'utf8'));
  const namespace = name === 'paperclip' ? 'app/' : 'feishu/';
  const baseline = files.filter(entry => entry.file.startsWith(namespace) && entry.baseSha256 !== null);
  if (!baseline.length || baseline.some(entry => !/^[a-f0-9]{64}$/.test(entry.baseSha256))) fail('source-manifest');
  const targets = baseline.map(entry => {
    const file = path.join(overlayRoot, entry.file);
    const volume = additions.find(item => file === item.source || file.startsWith(item.source + path.sep));
    return volume && (file === volume.source ? volume.target : volume.target + '/' + path.relative(volume.source, file));
  });
  if (targets.some(target => typeof target !== 'string' || !target.startsWith('/'))) fail('source-target');
  const readback = docker(['exec', running.Id, 'sha256sum', ...targets]).trim().split('\n');
  if (readback.length !== baseline.length || readback.some((line, index) => line !== baseline[index].baseSha256 + '  ' + targets[index])) {
    fail('source-digest');
  }
  const args = ['compose', '--profile', '*', '--env-file', '/dev/null', '--project-name', project,
    '--project-directory', cwd, ...originals.flatMap(file => ['-f', file]), '-f', overlay];
  const resolved = JSON.parse(docker([...args, 'config', '--format', 'json'], { env, cwd }));
  const service = resolved.services?.[name];
  if (!service || typeof service.image !== 'string') fail('image');
  const [image] = JSON.parse(docker(['image', 'inspect', service.image]));
  if (image.Id !== running.Image) fail('image-digest');
  const declared = new Map((service.volumes ?? []).map(volume => [volume.target, volume]));
  const expected = new Map(running.Mounts.map(mount => [mount.Destination, {
    type: mount.Type, source: mount.Type === 'volume' ? mount.Name : mount.Source, read_only: !mount.RW,
  }]));
  for (const volume of additions) expected.set(volume.target, volume);
  for (const [target, wanted] of expected) {
    const actual = declared.get(target);
    const actualSource = actual?.type === 'volume' ? resolved.volumes?.[actual.source]?.name ?? actual.source : actual?.source;
    if (actual?.type !== wanted.type || actualSource !== wanted.source || Boolean(actual?.read_only) !== Boolean(wanted.read_only)) fail('mount');
  }
  if (expected.size !== declared.size) fail('mount-count');
  const liveEnv = envMap(running.Config.Env);
  const baseEnv = envMap(image.Config.Env ?? []);
  const plannedEnv = { ...baseEnv, ...service.environment };
  if (sorted(Object.keys(liveEnv)) !== sorted(Object.keys(plannedEnv)) ||
      Object.entries(liveEnv).some(([key, value]) => String(plannedEnv[key]) !== value)) fail('environment');
  if (JSON.stringify(service.command ?? image.Config.Cmd) !== JSON.stringify(running.Config.Cmd) ||
      JSON.stringify(service.entrypoint ?? image.Config.Entrypoint) !== JSON.stringify(running.Config.Entrypoint)) fail('entrypoint');
  const networks = Object.keys(service.networks ?? {}).map(network => resolved.networks?.[network]?.name ?? network);
  const host = running.HostConfig;
  if (sorted(networks) !== sorted(Object.keys(running.NetworkSettings.Networks)) ||
      Boolean(service.read_only) !== host.ReadonlyRootfs || Boolean(service.privileged) !== host.Privileged ||
      (service.user ?? image.Config.User ?? '') !== running.Config.User ||
      (service.pid ?? '') !== host.PidMode || (service.ipc ?? 'private') !== host.IpcMode ||
      sorted(service.cap_add ?? []) !== sorted(host.CapAdd ?? []) || sorted(service.cap_drop ?? []) !== sorted(host.CapDrop ?? []) ||
      securityOptions(service.security_opt, cwd) !== securityOptions(host.SecurityOpt, cwd) ||
      (service.ports?.length ?? 0) !== Object.keys(host.PortBindings ?? {}).length ||
      (service.devices?.length ?? 0) !== (host.Devices?.length ?? 0) ||
      (service.device_requests?.length ?? 0) !== (host.DeviceRequests?.length ?? 0)) fail('isolation');
  return { args, cwd, containerId: running.Id, imageId: image.Id };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkFeishuProjectCompose(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ code: /^FRA_COMPOSE_DRIFT:[a-z-]+$/.test(error?.message ?? '') ? error.message : 'FRA_COMPOSE_CHECK_FAILED' }));
    process.exitCode = 1;
  }
}
