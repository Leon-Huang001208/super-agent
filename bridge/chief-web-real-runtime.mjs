import { createChiefWebRealEngine } from './chief-web-real-engine.mjs';
import { loadPinnedChiefWebRealIntake } from './chief-web-real-intake.mjs';
import { createChiefWebRealSpool } from './chief-web-real-spool.mjs';
import { readChiefWebPrivateJson } from './chief-web-private-file.mjs';

export async function loadChiefWebRealRuntime({ log }) {
  if (process.env.PAPERCLIP_INSTANCE_ID !== 'chief-web-real-rwb' ||
      process.env.HEARTBEAT_SCHEDULER_ENABLED !== 'false' ||
      ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'].some(key => process.env[key])) {
    throw new Error('CHIEF_WEB_REAL_ISOLATION_REQUIRED');
  }
  const config = await readChiefWebPrivateJson('/paperclip/control/chief-web-real.json');
  const spool = await createChiefWebRealSpool({ root: '/chief-real-broker', config, log });
  const mountChiefWebPilot = await loadPinnedChiefWebRealIntake({
    config, ports: { executor: spool.executor, publisher: spool.publisher }, log,
    createEngine(options) {
      const engine = createChiefWebRealEngine(options);
      const timer = setInterval(() => {
        engine.tick().catch(() => log({ code: 'CHIEF_WEB_REAL_RECONCILIATION_REQUIRED' }));
      }, 2000);
      timer.unref();
      return {
        ...engine,
        control(command) {
          return spool.withControlFence(async () => {
            if (command.action === 'pause') {
              const state = await engine.status();
              if (state.contextRevision !== command.expectedRevision) return engine.control(command);
              // Publish the fence before the DB control. A concurrent state
              // change keeps transport fenced until the current board Resume.
              await spool.setPaused(true);
              return engine.control(command);
            }
            if (command.action === 'confirm' && await spool.isPaused()) {
              throw Object.assign(new Error('CHIEF_WEB_REAL_PAUSED'), { code: 'CHIEF_WEB_REAL_PAUSED', status: 409 });
            }
            const result = await engine.control(command);
            if (command.action === 'resume' && result.applied) await spool.setPaused(result.paused === true);
            return result;
          });
        },
        async status() {
          const status = await engine.status();
          return await spool.isPaused() ? { ...status, paused: true, canConfirm: false } : status;
        },
      };
    },
  });
  return { mountChiefWebPilot };
}
