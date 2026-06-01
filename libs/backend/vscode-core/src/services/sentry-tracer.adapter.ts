import { inject, injectable } from 'tsyringe';
import type { ITracer } from '@ptah-extension/platform-core';
import { TOKENS } from '../di/tokens';
import type { SentryService } from './sentry.service';

@injectable()
export class SentryTracerAdapter implements ITracer {
  constructor(
    @inject(TOKENS.SENTRY_SERVICE) private readonly sentry: SentryService,
  ) {}

  startSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => T,
  ): T {
    return this.sentry.startSpan(name, attributes, fn);
  }

  addBreadcrumb(
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.sentry.addBreadcrumb(category, message, data);
  }
}
