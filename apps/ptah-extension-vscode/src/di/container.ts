/**
 * Centralized Dependency Injection Container (Thin Orchestrator)
 *
 * RESPONSIBILITY: Orchestrate service registration across all libraries.
 * Each phase lives in its own file (`phase-0-platform.ts`, `phase-1-infra.ts`,
 * `phase-2-libraries.ts`, `phase-3-handlers.ts`, `phase-4-app.ts`) — this file
 * only wires them together.
 *
 * Public API: `setupMinimal`, `setup`, `getContainer`, `resolve`,
 * `isRegistered`, `clear`, and the `export { container }` re-export.
 */

import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import * as vscode from 'vscode';

import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';

import { registerPhase0Platform } from './phase-0-platform';
import {
  registerPhase1Infra,
  registerPhase1InfraMinimal,
} from './phase-1-infra';
import { registerPhase2Libraries } from './phase-2-libraries';
import { registerPhase3Handlers } from './phase-3-handlers';
import { registerPhase4App } from './phase-4-app';

export class DIContainer {
  private static _root: DependencyContainer | undefined;

  private static ensureRoot(): DependencyContainer {
    if (!DIContainer._root) {
      DIContainer._root = container.createChildContainer();
    }
    return DIContainer._root;
  }

  static setupMinimal(context: vscode.ExtensionContext): DependencyContainer {
    const root = DIContainer.ensureRoot();
    root.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: root });
    registerPhase0Platform(root, context);
    registerPhase1InfraMinimal(root);
    return root;
  }

  static setup(context: vscode.ExtensionContext): DependencyContainer {
    const root = DIContainer.ensureRoot();
    if (!root.isRegistered(PLATFORM_TOKENS.DI_CONTAINER)) {
      root.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: root });
    }
    const { logger } = registerPhase0Platform(root, context);
    registerPhase1Infra(root, context, logger);
    registerPhase2Libraries(root, logger);
    registerPhase3Handlers(root, logger);
    registerPhase4App(root, context);
    return root;
  }

  static getContainer(): DependencyContainer {
    return DIContainer.ensureRoot();
  }

  static resolve<T>(token: symbol): T {
    return DIContainer.ensureRoot().resolve<T>(token);
  }

  static isRegistered(token: symbol): boolean {
    return DIContainer.ensureRoot().isRegistered(token);
  }

  static clear(): void {
    DIContainer.ensureRoot().clearInstances();
  }
}
export { container };
