// === TRACK_3_CRON_SCHEDULER_BEGIN ===
/**
 * In-memory implementation of {@link IHandlerRegistry}.
 *
 * Lives entirely in the scheduler process — there is no persistence layer.
 * Consumer libraries (memory-curator, gateway, skill-synthesis) register
 * their named handlers at boot via `registerSingleton(...)` and then call
 * `register('memory:decay', fn)` from their own DI bootstrap.
 *
 * The registry is intentionally tiny: name → function. Anything more (per-
 * handler timeouts, retries, isolation) belongs in the {@link JobRunner} or
 * a dedicated middleware layer, not here.
 */
import { injectable } from 'tsyringe';
import type { IHandlerRegistry, JobHandler } from './types';

@injectable()
export class HandlerRegistry implements IHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(name: string, handler: JobHandler): void {
    if (!name || typeof name !== 'string') {
      throw new Error(
        'HandlerRegistry.register: name must be a non-empty string',
      );
    }
    if (this.handlers.has(name)) {
      throw new Error(`HandlerRegistry.register: duplicate handler '${name}'`);
    }
    this.handlers.set(name, handler);
  }

  unregister(name: string): void {
    this.handlers.delete(name);
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  resolve(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }
}
// === TRACK_3_CRON_SCHEDULER_END ===
