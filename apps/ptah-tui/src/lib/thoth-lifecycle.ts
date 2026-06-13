import { EventEmitter } from 'node:events';
import type { DependencyContainer } from 'tsyringe';
import {
  activateThoth as defaultActivateThoth,
  disposeThoth as defaultDisposeThoth,
  type ThothRefs,
  type ThothLogger,
} from '@ptah-extension/cli-engine';

export type ThothActivationStatus = 'idle' | 'activating' | 'active' | 'failed';

export type ThothSubsystem =
  | 'memory'
  | 'skills'
  | 'cron'
  | 'gateway'
  | 'sqlite'
  | 'embedder';

export interface ThothSubsystemState {
  readonly ready: boolean;
  readonly reason?: string;
}

export interface ThothActivationSnapshot {
  readonly status: ThothActivationStatus;
  readonly error?: string;
  readonly subsystems: Readonly<Record<ThothSubsystem, ThothSubsystemState>>;
}

const LOGGER_TOKEN = Symbol.for('Logger');

type ActivateFn = (
  container: DependencyContainer,
  tier: 'runtime',
  logger: ThothLogger,
) => Promise<ThothRefs>;

type DisposeFn = (
  refs: ThothRefs | undefined,
  logger: ThothLogger,
) => Promise<void>;

export interface ThothLifecycleOptions {
  readonly activate?: ActivateFn;
  readonly dispose?: DisposeFn;
}

function degraded(reason: string): ThothSubsystemState {
  return { ready: false, reason };
}

function ready(): ThothSubsystemState {
  return { ready: true };
}

function pendingSubsystems(): Record<ThothSubsystem, ThothSubsystemState> {
  return {
    memory: degraded('activating'),
    skills: degraded('activating'),
    cron: degraded('activating'),
    gateway: degraded('activating'),
    sqlite: degraded('activating'),
    embedder: degraded('activating'),
  };
}

function offlineSubsystems(
  reason: string,
): Record<ThothSubsystem, ThothSubsystemState> {
  return {
    memory: degraded(reason),
    skills: degraded(reason),
    cron: degraded(reason),
    gateway: degraded(reason),
    sqlite: degraded(reason),
    embedder: degraded(reason),
  };
}

function deriveSubsystems(
  refs: ThothRefs,
): Record<ThothSubsystem, ThothSubsystemState> {
  return {
    memory: refs.memoryCurator ? ready() : degraded('offline'),
    skills: refs.skillSynthesis ? ready() : degraded('offline'),
    cron: refs.cronScheduler ? ready() : degraded('offline'),
    gateway: refs.gateway ? ready() : degraded('offline'),
    sqlite: refs.sqliteConnection ? ready() : degraded('offline'),
    embedder: refs.embedderClient ? ready() : degraded('offline'),
  };
}

export class ThothLifecycle extends EventEmitter {
  private readonly activateFn: ActivateFn;
  private readonly disposeFn: DisposeFn;

  private status: ThothActivationStatus = 'idle';
  private error: string | undefined;
  private subsystems: Record<ThothSubsystem, ThothSubsystemState> =
    pendingSubsystems();
  private refs: ThothRefs | undefined;

  constructor(options: ThothLifecycleOptions = {}) {
    super();
    this.activateFn = options.activate ?? (defaultActivateThoth as ActivateFn);
    this.disposeFn = options.dispose ?? defaultDisposeThoth;
  }

  snapshot(): ThothActivationSnapshot {
    return {
      status: this.status,
      error: this.error,
      subsystems: { ...this.subsystems },
    };
  }

  getRefs(): ThothRefs | undefined {
    return this.refs;
  }

  async activate(container: DependencyContainer): Promise<void> {
    if (this.status === 'activating' || this.status === 'active') {
      return;
    }
    this.status = 'activating';
    this.error = undefined;
    this.subsystems = pendingSubsystems();
    this.emitChange();

    try {
      const logger = container.resolve<ThothLogger>(LOGGER_TOKEN);
      const refs = await this.activateFn(container, 'runtime', logger);
      this.refs = refs;
      this.subsystems = deriveSubsystems(refs);
      this.status = 'active';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.error = message;
      this.subsystems = offlineSubsystems(message);
      this.status = 'failed';
    }
    this.emitChange();
  }

  async dispose(container: DependencyContainer): Promise<void> {
    if (this.status === 'idle') {
      return;
    }
    let logger: ThothLogger | undefined;
    try {
      logger = container.resolve<ThothLogger>(LOGGER_TOKEN);
    } catch {
      logger = undefined;
    }
    if (logger) {
      await this.disposeFn(this.refs, logger);
    }
    this.refs = undefined;
    this.status = 'idle';
    this.subsystems = pendingSubsystems();
    this.emitChange();
  }

  private emitChange(): void {
    this.emit('change', this.snapshot());
  }
}
