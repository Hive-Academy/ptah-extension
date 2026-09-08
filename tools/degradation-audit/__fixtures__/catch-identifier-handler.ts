// Planted fixture for the degradation-audit self-test (Revision 1, moderate
// finding: `.catch(<identifier>)` was previously invisible).
import { externalNoop } from './does-not-exist-simulates-an-import';

export const noop = (...args: unknown[]) => {};

export function fireAndForgetNoop(job: Promise<void>): void {
  // A named same-file no-op reference — must be flagged, same as an inline
  // `.catch(() => undefined)` would be.
  job.catch(noop);
}

export function fireAndForgetUnresolved(job: Promise<void>): void {
  // Not declared in this file (simulates an import) — flagged conservatively
  // per the review's "flag any .catch(identifier) unless it resolves to a
  // handler that logs or rethrows" guidance.
  job.catch(externalNoop);
}

export function realHandler(error: unknown): void {
  logger.error('rejection', error);
}

export function fireAndForgetHandled(job: Promise<void>): void {
  // Resolves in this file to a function that DOES call logger.error — must
  // NOT be flagged.
  job.catch(realHandler);
}

declare const logger: { error: (...args: unknown[]) => void };
