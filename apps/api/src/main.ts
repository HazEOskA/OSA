import { openStore } from '../../../packages/store/src/index.js';
import { Kernel } from '../../../packages/kernel/src/service.js';
import { createEngines } from '../../../packages/engines/src/index.js';
import { Worker } from '../../../packages/runtime/src/worker.js';
import { createApi } from './server.js';
import type { IdentityConfig } from './auth.js';
const store = await openStore();
const kernel = new Kernel(store);
const worker =
  process.env.OSA_EMBEDDED_WORKER === 'false'
    ? undefined
    : new Worker(
        kernel,
        createEngines(kernel),
        process.env.OSA_WORKER_ID || 'embedded-' + process.pid,
      );
const port = Number(process.env.OSA_PORT || 3000);
const host = process.env.OSA_HOST || '127.0.0.1';
const identities = JSON.parse(
  process.env.OSA_IDENTITIES_JSON || '[]',
) as IdentityConfig[];
const server = createApi(kernel, {
  publicUrl: process.env.OSA_PUBLIC_URL || `http://127.0.0.1:${port}`,
  identities,
  staticDir: './dist/control-room',
  worker,
});
server.listen(port, host, () => {
  worker?.start();
  console.log(`OSA API ${host}:${port} | ${store.kind}`);
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker?.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.close();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
