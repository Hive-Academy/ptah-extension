/**
 * `container-diagnostics-override.spec.ts` — TASK_2026_299 Task 6.5.
 *
 * Proves that the CLI's Phase 2 registration replaces the Phase 0
 * `CliDiagnosticsProvider` stub (`{ status: 'unavailable', source:
 * 'cli-phase0', ... }`, already covered end-to-end by
 * `platform-cli/.../cli-diagnostics-provider.spec.ts`) with the real
 * `TypeScriptDiagnosticsProvider` once `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`
 * is overridden.
 *
 * Why this does NOT call `CliDIContainer.setup()` directly: that single
 * static method (`container.ts:244` onward) is the entire CLI DI bootstrap —
 * persistence-sqlite, memory-curator, messaging-gateway, voice-providers,
 * licensing, and more, driven by `CliBootstrapOptions` (real paths, workspace
 * root, etc). The project's own `with-engine.spec.ts` deliberately mocks the
 * bootstrap (`bootstrap` override on `WithEngineOptions`) rather than calling
 * it for real, "so tests do not pay the real container cost" (see that
 * file's header comment) — this spec follows the same precedent.
 *
 * Instead, this spec:
 *   1. Calls the REAL, exported `registerWorkspaceIntelligenceServices`
 *      against a minimal child container (its only two preconditions are
 *      `TOKENS.LOGGER` and `TOKENS.FILE_SYSTEM_MANAGER`).
 *   2. Executes the override lines VERBATIM as they appear in
 *      `container.ts:528-536` (mirrored, not imported — see caveat below).
 *   3. Asserts the resolved token is a `TypeScriptDiagnosticsProvider`, not
 *      the `CliDiagnosticsProvider` placeholder that was registered first.
 *
 * DRIFT CAVEAT: because the override snippet is mirrored rather than
 * imported, this spec cannot detect someone editing the override in
 * `container.ts` without updating this file. If the override moves, gains
 * dependencies, or changes shape, keep this file's mirrored block in sync by
 * hand.
 */

import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  registerWorkspaceIntelligenceServices,
  TypeScriptDiagnosticsProvider,
} from '@ptah-extension/workspace-intelligence';
import { CliDiagnosticsProvider } from '@ptah-extension/platform-cli';

function buildLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
}

/**
 * Minimal container satisfying `registerWorkspaceIntelligenceServices`'s two
 * `isRegistered` guards, plus the Phase 0 diagnostics placeholder (mirroring
 * `platform-cli/src/registration.ts`'s registration of
 * `CliDiagnosticsProvider` under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`) and
 * a stub `IFileSystemProvider` (the real dependency
 * `TypeScriptDiagnosticsProvider`'s constructor takes).
 */
function buildPhase0Container(logger: Logger): DependencyContainer {
  const c = rootContainer.createChildContainer();
  c.register(TOKENS.LOGGER, { useValue: logger });
  c.register(TOKENS.FILE_SYSTEM_MANAGER, { useValue: {} });
  c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: {
      findFiles: jest.fn(async () => []),
      readFile: jest.fn(),
    },
  });
  // Phase 0: the fallback registration, exactly as
  // `platform-cli/src/registration.ts` wires it before any override.
  c.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
    useValue: new CliDiagnosticsProvider(),
  });
  return c;
}

describe('CLI Phase 2 — DIAGNOSTICS_PROVIDER override (TASK_2026_299 Task 6.5)', () => {
  it('resolves to the Phase 0 CliDiagnosticsProvider stub before the override runs', () => {
    const c = buildPhase0Container(buildLogger());

    const resolved = c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER);

    expect(resolved).toBeInstanceOf(CliDiagnosticsProvider);
    expect(resolved).not.toBeInstanceOf(TypeScriptDiagnosticsProvider);
  });

  it('resolves to TypeScriptDiagnosticsProvider — NOT the Phase 0 stub — after workspace-intelligence registration + the Phase 2 override', () => {
    const logger = buildLogger();
    const c = buildPhase0Container(logger);
    const phase0Instance = c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER);

    // registerWorkspaceIntelligenceServices(container, logger) — the REAL,
    // exported function, called exactly as container.ts:524 calls it.
    registerWorkspaceIntelligenceServices(c, logger);

    // Mirrors container.ts:528-536 verbatim (see DRIFT CAVEAT above).
    const tsDiagsProvider = new TypeScriptDiagnosticsProvider(
      c.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
    );
    c.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
      useValue: tsDiagsProvider,
    });

    const resolved = c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER);

    expect(resolved).toBeInstanceOf(TypeScriptDiagnosticsProvider);
    expect(resolved).not.toBeInstanceOf(CliDiagnosticsProvider);
    expect(resolved).not.toBe(phase0Instance);
    expect(resolved).toBe(tsDiagsProvider);
  });
});
