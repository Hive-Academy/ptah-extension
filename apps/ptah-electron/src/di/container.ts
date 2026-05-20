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
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

import { registerPhase0Platform } from './phase-0-platform';
import { registerPhase1Infra } from './phase-1-infra';
import { registerPhase2Libraries } from './phase-2-libraries';
import { registerPhase3Storage } from './phase-3-storage';
import { registerPhase4Handlers } from './phase-4-handlers';

export class ElectronDIContainer {
  private static _root: DependencyContainer | undefined;

  private static ensureRoot(): DependencyContainer {
    if (!ElectronDIContainer._root) {
      ElectronDIContainer._root = container.createChildContainer();
    }
    return ElectronDIContainer._root;
  }

  static setup(options: ElectronPlatformOptions): DependencyContainer {
    const root = ElectronDIContainer.ensureRoot();
    root.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: root });
    const { logger } = registerPhase0Platform(root, options);
    registerPhase1Infra(root, options, logger);
    registerPhase2Libraries(root, logger);
    registerPhase3Storage(root, logger);
    registerPhase4Handlers(root, logger);
    logger.info('[Electron DI] All services registered successfully');
    return root;
  }

  static getContainer(): DependencyContainer {
    return ElectronDIContainer.ensureRoot();
  }

  static resolve<T>(token: symbol): T {
    return ElectronDIContainer.ensureRoot().resolve<T>(token);
  }

  static isRegistered(token: symbol): boolean {
    return ElectronDIContainer.ensureRoot().isRegistered(token);
  }
}
