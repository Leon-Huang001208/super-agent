// The slot uses the board's authenticated API. The worker needs no I/O capability.
import { definePlugin, runWorker } from '/opt/paperclip/node_modules/@paperclipai/plugin-sdk/dist/index.js';

runWorker(definePlugin({ setup() {} }), import.meta.url);
