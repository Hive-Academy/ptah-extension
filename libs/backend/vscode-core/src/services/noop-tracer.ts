import { injectable } from 'tsyringe';
import type { ITracer } from '@ptah-extension/platform-core';

@injectable()
export class NoopTracer implements ITracer {
  startSpan<T>(
    _name: string,
    _attributes: Record<string, string | number | boolean>,
    fn: () => T,
  ): T {
    return fn();
  }

  addBreadcrumb(
    _category: string,
    _message: string,
    _data?: Record<string, unknown>,
  ): void {
    /* no-op */
  }
}
