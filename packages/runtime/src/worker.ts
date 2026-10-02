import { Kernel } from '../../kernel/src/service.js';
import { OsaError } from '../../kernel/src/contracts.js';
import type { Engine } from '../../kernel/src/contracts.js';
export class Worker {
  private controllers = new Map<string, AbortController>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private processing: Promise<boolean> | undefined;
  constructor(
    readonly kernel: Kernel,
    private engines: Map<string, Engine>,
    readonly workerId: string,
    private leaseMs = 30000,
  ) {}
  async once(): Promise<boolean> {
    const run = await this.kernel.claim(this.workerId, this.leaseMs);
    if (!run) return false;
    const control = new AbortController();
    this.controllers.set(run.id, control);
    const timeout = setTimeout(
      () => control.abort(new Error('ENGINE_TIMEOUT')),
      120000,
    );
    let beating = false;
    const heartbeat = setInterval(
      async () => {
        if (beating) return;
        beating = true;
        try {
          if (!(await this.kernel.heartbeat(run, this.leaseMs)))
            control.abort(new Error('LEASE_LOST'));
        } catch {
          control.abort(new Error('HEARTBEAT_FAILED'));
        } finally {
          beating = false;
        }
      },
      Math.max(50, Math.floor(this.leaseMs / 3)),
    );
    try {
      const engine = this.engines.get(run.engine);
      if (!engine)
        throw new OsaError('UNKNOWN_ENGINE', 'Brak silnika w workerze.');
      const result = await engine.execute(run.input, {
        identity: {
          tenantId: run.tenantId,
          subject: run.requestedBy || 'worker:' + this.workerId,
          role: 'owner',
        },
        signal: control.signal,
        run,
      });
      await this.kernel.settle(run, result);
    } catch (e) {
      const err =
        e instanceof OsaError
          ? e
          : new OsaError(
              'ENGINE_FAILED',
              control.signal.aborted
                ? 'Wykonanie przerwane.'
                : 'Silnik zakończył się błędem.',
              502,
              true,
            );
      await this.kernel.settle(run, undefined, {
        message: err.code + ': ' + err.message,
        retryable: err.retryable,
      });
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      this.controllers.delete(run.id);
    }
    return true;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.kernel.tickSchedules();
        this.processing = this.once();
        await this.processing;
      } catch (e) {
        console.error(
          'OSA worker tick failed:',
          e instanceof Error ? e.message : 'unknown',
        );
      } finally {
        this.processing = undefined;
        if (!this.stopped) this.timer = setTimeout(tick, 500);
      }
    };
    void tick();
  }
  abort(runId: string) {
    this.controllers.get(runId)?.abort();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const c of this.controllers.values()) c.abort();
    await this.processing;
  }
}
