/**
 * Centralized Dependency Injection Container (Thin Orchestrator)
 *
 * RESPONSIBILITY: Orchestrate service registration across all libraries.
 * Each phase now lives in its own file (`phase-0-platform.ts`, `phase-1-infra.ts`,
 * `phase-2-libraries.ts`, `phase-3-handlers.ts`, `phase-4-app.ts`) — this file
 * only wires them together.
 *
 * TASK_2025_291 Wave C1 Step 2a: Split a 628-line container into phase modules.
 *
 * Public API preserved: `setupMinimal`, `setup`, `getContainer`, `resolve`,
 * `isRegistered`, `clear`, and the `export { container }` re-export.
 */

import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

import { registerPhase0Platform } from './phase-0-platform';
import {
  registerPhase1Infra,
  registerPhase1InfraMinimal,
} from './phase-1-infra';
import { registerPhase2Libraries } from './phase-2-libraries';
import { registerPhase3Handlers } from './phase-3-handlers';
import { registerPhase4App } from './phase-4-app';

export class DIContainer {
  /**
   * Minimal DI setup for license verification (TASK_2025_121 Batch 3).
   * Called BEFORE the full license check so that license status can be read
   * without initializing the rest of the extension.
   */
  static setupMinimal(context: vscode.ExtensionContext): DependencyContainer {
    registerPhase0Platform(container, context);
    registerPhase1InfraMinimal(container);
    return container;
  }

  /**
   * Full setup for licensed-user activation. Safe to call after `setupMinimal`
   * — every phase uses `isRegistered` guards internally.
   *
   * Phase order matches the original container (Phase 1.6 handlers before
   * Phase 2 libraries). All handler registrations are lazy factories, so
   * registering handlers before their library dependencies is safe.
   */
  static setup(context: vscode.ExtensionContext): DependencyContainer {
    const { logger } = registerPhase0Platform(container, context);
    registerPhase1Infra(container, context, logger);
    registerPhase3Handlers(container, logger);
    registerPhase2Libraries(container, logger);
    registerPhase4App(container, context);
    return container;
  }

  static getContainer(): DependencyContainer {
    return container;
  }

  static resolve<T>(token: symbol): T {
    return container.resolve<T>(token);
  }

  static isRegistered(token: symbol): boolean {
    return container.isRegistered(token);
  }

  static clear(): void {
    container.clearInstances();
  }
}

// Re-export container for backward compatibility.
export { container };
