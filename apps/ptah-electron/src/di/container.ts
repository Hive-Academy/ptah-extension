/**
 * Electron DI Container Orchestrator
 *
 * Thin orchestrator delegating to phase files.
 *
 * Phase execution order (enforced by this orchestrator):
 *   Phase 0 — Platform abstraction + Logger (phase-0-platform.ts)
 *   Phase 1 — Infrastructure + shims + workspace-aware storage (phase-1-infra.ts)
 *   Phase 2 — Library registrations (phase-2-libraries.ts)
 *   Phase 3 — Storage adapters + platform abstractions + vscode-lm-tools (phase-3-storage.ts)
 *   Phase 4 — RPC handler classes + orchestrator (phase-4-handlers.ts)
 *
 * Public API preserved: setup / getContainer / resolve / isRegistered.
 */

import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';

import type { ElectronPlatformOptions } from '@ptah-extension/platform-electron';

import { registerPhase0Platform } from './phase-0-platform';
import { registerPhase1Infra } from './phase-1-infra';
import { registerPhase2Libraries } from './phase-2-libraries';
import { registerPhase3Storage } from './phase-3-storage';
import { registerPhase4Handlers } from './phase-4-handlers';

export class ElectronDIContainer {
  /**
   * Setup and orchestrate all service registrations for Electron.
   *
   * @param options - Electron platform options (paths, APIs)
   * @returns Configured DependencyContainer
   */
  static setup(options: ElectronPlatformOptions): DependencyContainer {
    const { logger } = registerPhase0Platform(container, options);
    registerPhase1Infra(container, options, logger);
    registerPhase2Libraries(container, logger);
    registerPhase3Storage(container, logger);
    registerPhase4Handlers(container, logger);
    logger.info('[Electron DI] All services registered successfully');
    return container;
  }

  /**
   * Get the global container instance.
   */
  static getContainer(): DependencyContainer {
    return container;
  }

  /**
   * Resolve a service by its token.
   */
  static resolve<T>(token: symbol): T {
    return container.resolve<T>(token);
  }

  /**
   * Check if a service is registered.
   */
  static isRegistered(token: symbol): boolean {
    return container.isRegistered(token);
  }
}
