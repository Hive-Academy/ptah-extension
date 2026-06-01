import { injectable, inject } from 'tsyringe';
import type { Logger } from '../logging/logger';
import { TOKENS } from '../di/tokens';

export interface SentryInitOptions {
  dsn: string;
  environment: string;
  release: string;
  platform: string;
  extensionVersion: string;
  tracesSampleRate?: number;
}

export interface SentryErrorContext {
  errorSource: string;
  workspaceHash?: string;
  activeProvider?: string;
  extra?: Record<string, unknown>;
}

@injectable()
export class SentryService {
  private initialized = false;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  initialize(options: SentryInitOptions): void {
    if (process.env['NODE_ENV'] === 'test') return;
    if (!options.dsn) return;
    if (this.initialized) return;

    const Sentry = require('@sentry/node') as typeof import('@sentry/node');
    const tracesSampleRate = this.resolveTracesSampleRate(options);
    Sentry.init({
      dsn: options.dsn,
      environment: options.environment,
      release: `ptah-extension@${options.release}`,
      tracesSampleRate,
      initialScope: {
        tags: {
          platform: options.platform,
          extensionVersion: options.extensionVersion,
        },
      },
    });
    this.initialized = true;
    this.logger.info('[Sentry] Initialized', {
      environment: options.environment,
      tracesSampleRate,
    });
  }

  private resolveTracesSampleRate(options: SentryInitOptions): number {
    if (
      typeof options.tracesSampleRate === 'number' &&
      Number.isFinite(options.tracesSampleRate)
    ) {
      return options.tracesSampleRate;
    }
    const envValue = parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '');
    if (Number.isFinite(envValue)) {
      return envValue;
    }
    return options.environment === 'development' ? 1.0 : 0.1;
  }

  startSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => T,
  ): T {
    if (!this.initialized || process.env['NODE_ENV'] === 'test') {
      return fn();
    }
    const Sentry = require('@sentry/node') as typeof import('@sentry/node');
    const op =
      typeof attributes['op'] === 'string' ? attributes['op'] : 'function';
    return Sentry.startSpan({ name, op, attributes }, fn);
  }

  captureException(error: Error, context?: SentryErrorContext): void {
    if (!this.initialized) return;

    const Sentry = require('@sentry/node') as typeof import('@sentry/node');
    Sentry.withScope((scope) => {
      if (context) {
        scope.setTag('errorSource', context.errorSource);
        if (context.workspaceHash) {
          scope.setTag('workspaceHash', context.workspaceHash);
        }
        if (context.activeProvider) {
          scope.setTag('activeProvider', context.activeProvider);
        }
        if (context.extra) {
          scope.setExtras(context.extra);
        }
      }
      Sentry.captureException(error);
    });
  }

  captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
  ): void {
    if (!this.initialized) return;

    const Sentry = require('@sentry/node') as typeof import('@sentry/node');
    Sentry.captureMessage(message, level);
  }

  addBreadcrumb(
    category: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.initialized) return;

    const Sentry = require('@sentry/node') as typeof import('@sentry/node');
    Sentry.addBreadcrumb({ category, message, data });
  }

  async flush(timeoutMs = 2000): Promise<void> {
    if (!this.initialized) return;

    const Sentry = require('@sentry/node') as typeof import('@sentry/node');
    await Sentry.flush(timeoutMs);
  }

  async shutdown(timeoutMs = 2000): Promise<void> {
    if (!this.initialized) return;

    const Sentry = require('@sentry/node') as typeof import('@sentry/node');
    await Sentry.close(timeoutMs);
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  static hashWorkspacePath(workspacePath: string): string {
    const { createHash } = require('crypto') as typeof import('crypto');
    return createHash('sha1').update(workspacePath).digest('hex').slice(0, 8);
  }
}
