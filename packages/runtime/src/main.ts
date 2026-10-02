import { openStore } from '../../store/src/index.js';
import { Kernel } from '../../kernel/src/service.js';
import { createEngines } from '../../engines/src/index.js';
import { Worker } from './worker.js';
const store = await openStore();
const kernel = new Kernel(store);
const worker = new Worker(
  kernel,
  createEngines(kernel),
  process.env.OSA_WORKER_ID || 'worker-' + process.pid,
);
worker.start();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  await store.close();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
console.log('OSA worker started');
