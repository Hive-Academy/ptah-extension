/**
 * Scoped tsyringe container factory for tests.
 *
 * Every production service in this monorepo is registered against the global
 * tsyringe `container`. Using the global container inside a test suite leaks
 * registrations between specs and makes mock injection order-sensitive. The
 * helpers here produce a **child container** per suite: registrations on the
 * child do not mutate the root, and `resetTestContainer()` fully clears the
 * child between tests.
 *
 * Reference: https://github.com/microsoft/tsyringe#child-containers
 */

import 'reflect-metadata';
import { container, type DependencyContainer } from 'tsyringe';

export type TsyringeTestContainer = DependencyContainer;

/**
 * Create a fresh child container off the global tsyringe root. The returned
 * container inherits resolutions from the root but any `.register()` call on
 * it is isolated — the root container is never mutated.
 */
export function createTestContainer(): TsyringeTestContainer {
  return container.createChildContainer();
}

/**
 * Clear every registration on the supplied child container.
 *
 * tsyringe's child containers expose `clearInstances()` (reset resolved
 * singletons) and `reset()` (drop registrations entirely). Tests typically
 * want both, and a brand-new child for isolation. Call this in `afterEach`.
 */
export function resetTestContainer(target: TsyringeTestContainer): void {
  target.clearInstances();
  target.reset();
}
