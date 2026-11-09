import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

export function checkFeishuAutoRwbCompose(overlay, name) {
  if (!['paperclip', 'feishu-connection'].includes(name) || !path.isAbsolute(overlay)) fail('argument');
  const [running] = JSON.parse(docker(['inspect', project + '-' + name + '-1']));
  const labels = running.Config.Labels;
  const originals = labels['com.docker.compose.project.config_files']?.split(',') ?? [];
  const cwd = labels['com.docker.compose.project.working_dir'];
  if (labels['com.docker.compose.project'] !== project || labels['com.docker.compose.service'] !== name ||
      !path.isAbsolute(cwd) || !originals.length || originals.some(file => !path.isAbsolute(file) || !fs.existsSync(file))) fail('identity');
  const overlayServices = JSON.parse(fs.readFileSync(overlay, 'utf8')).services;
  const additions = overlayServices?.[name]?.volumes;
  if (Object.keys(overlayServices ?? {}).length !== 1 || !Array.isArray(additions) || !additions.length ||
      additions.some(volume => volume.type !== 'bind' || !volume.read_only || volume.bind?.create_host_path !== false)) fail('overlay');
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
  if (sorted(networks) !== sorted(Object.keys(running.NetworkSettings.Networks)) ||
      Boolean(service.read_only) !== running.HostConfig.ReadonlyRootfs) fail('isolation');
  return { args, cwd, containerId: running.Id, imageId: image.Id };
}

if (process.argv[1]?.endsWith('/check-feishu-auto-rwb-compose.mjs') || process.argv[1] === 'scripts/check-feishu-auto-rwb-compose.mjs') {
  try {
    const result = checkFeishuAutoRwbCompose(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ code: /^FRA_COMPOSE_DRIFT:[a-z-]+$/.test(error?.message ?? '') ? error.message : 'FRA_COMPOSE_CHECK_FAILED' }));
    process.exitCode = 1;
  }
}
