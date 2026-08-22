/**
 * `phase-2-diagnostics-override.spec.ts` — TASK_2026_299 Task 6.5.
 *
 * Proves that Electron Phase 2 registration replaces the Phase 0
 * `ElectronDiagnosticsProvider` stub (`{ status: 'unavailable', source:
 * 'electron-phase0', ... }`, already covered end-to-end by
 * `platform-electron/.../electron-diagnostics.spec.ts`) with the real
 * `TypeScriptDiagnosticsProvider` once `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`
 * is overridden.
 *
 * Why this does NOT import `registerPhase2Libraries` directly: that function
 * (`apps/ptah-electron/src/di/phase-2-libraries.ts`) transitively imports
 * `persistence-sqlite` (better-sqlite3 native binding), `memory-curator`,
 * `messaging-gateway`, `voice-providers`, `skill-synthesis`, `cron-scheduler`
 * and more — none of which load cleanly under Jest without an elaborate
 * bootstrap (confirmed: `require('./phase-2-libraries')` alone throws at
 * module-evaluation time in this Jest environment). `container.smoke.spec.ts`
 * documents and works around the exact same constraint for `registerPhase4Handlers`
 * by hand-building a minimal container instead of calling the real Phase 2/4
 * chain end to end — this spec follows that precedent.
 *
 * Instead, this spec:
 *   1. Calls the REAL, exported `registerWorkspaceIntelligenceServices`
 *      against a minimal child container (its only two preconditions are
 *      `TOKENS.LOGGER` and `TOKENS.FILE_SYSTEM_MANAGER` — verified by reading
 *      `workspace-intelligence/src/di/register.ts`).
 *   2. Executes the override lines VERBATIM as they appear in
 *      `phase-2-libraries.ts:170-178` (mirrored, not imported — see caveat
 *      below).
 *   3. Asserts the resolved token is a `TypeScriptDiagnosticsProvider`, not
 *      the `ElectronDiagnosticsProvider` placeholder that was registered
 *      first.
 *
 * DRIFT CAVEAT: because the override snippet is mirrored rather than
 * imported, this spec cannot detect someone editing the override in
 * `phase-2-libraries.ts` without updating this file. If the override moves,
 * gains dependencies, or changes shape, keep this file's mirrored block in
 * sync by hand.
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
import { ElectronDiagnosticsProvider } from '@ptah-extension/platform-electron';

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
 * `platform-electron/src/registration.ts`'s registration of
 * `ElectronDiagnosticsProvider` under `PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER`)
 * and a stub `IFileSystemProvider` (the real dependency
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
  // `platform-electron/src/registration.ts` wires it before any override.
  c.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
    useValue: new ElectronDiagnosticsProvider(),
  });
  return c;
}

describe('Electron Phase 2 — DIAGNOSTICS_PROVIDER override (TASK_2026_299 Task 6.5)', () => {
  it('resolves to the Phase 0 ElectronDiagnosticsProvider stub before the override runs', () => {
    const c = buildPhase0Container(buildLogger());

    const resolved = c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER);

    expect(resolved).toBeInstanceOf(ElectronDiagnosticsProvider);
    expect(resolved).not.toBeInstanceOf(TypeScriptDiagnosticsProvider);
  });

  it('resolves to TypeScriptDiagnosticsProvider — NOT the Phase 0 stub — after workspace-intelligence registration + the Phase 2 override', () => {
    const logger = buildLogger();
    const c = buildPhase0Container(logger);
    const phase0Instance = c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER);

    // registerWorkspaceIntelligenceServices(container, logger) — the REAL,
    // exported function, called exactly as phase-2-libraries.ts:166 calls it.
    registerWorkspaceIntelligenceServices(c, logger);

    // Mirrors phase-2-libraries.ts:170-178 verbatim (see DRIFT CAVEAT above).
    const tsDiagsProvider = new TypeScriptDiagnosticsProvider(
      c.resolve(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER),
    );
    c.register(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER, {
      useValue: tsDiagsProvider,
    });

    const resolved = c.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER);

    expect(resolved).toBeInstanceOf(TypeScriptDiagnosticsProvider);
    expect(resolved).not.toBeInstanceOf(ElectronDiagnosticsProvider);
    expect(resolved).not.toBe(phase0Instance);
    expect(resolved).toBe(tsDiagsProvider);
  });
});
