/**
 * The CLI's unarmed shutdown path (TASK_2026_437 C14, Batch 16b).
 *
 * Without `--verbose` the CLI never arms diagnostics, so the governor is not
 * disposed through the diagnostics handle. `setup()` installs
 * `governorShutdownHandle` instead; `CliDIContainer.disposeDiagnostics()` — the
 * call `apps/ptah-cli/src/main.ts` makes on SIGINT, SIGTERM and `exit` — must
 * dispose the governor through it. `setup()` itself is the whole CLI bootstrap
 * and is not run here (see `container-diagnostics-override.spec.ts` for that
 * precedent); the handle is installed on the static the way `setup()` does.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import {
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  type BackgroundWorkGovernor,
  type Logger,
} from '@ptah-extension/vscode-core';
import { CliDIContainer, governorShutdownHandle } from './container';

function buildGovernorContainer() {
  const c = rootContainer.createChildContainer();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  c.register(TOKENS.LOGGER, { useValue: logger });
  registerVsCodeCorePlatformAgnostic(c, logger, {
    includeLicensingAndAuth: false,
  });
  return c;
}

describe('CLI unarmed shutdown — background-work governor disposal', () => {
  afterEach(() => {
    CliDIContainer.disposeDiagnostics();
  });

  it('disposeDiagnostics disposes the governor and rejects its pending waiters', async () => {
    const c = buildGovernorContainer();
    const governor = c.resolve<BackgroundWorkGovernor>(
      TOKENS.BACKGROUND_WORK_GOVERNOR,
    );
    governor.addForegroundSource({
      isForegroundBusy: () => true,
      onForegroundChange: () => () => undefined,
    });
    const pending = governor.whenClear({ lane: 'memory-curator' });

    // What `setup()` installs when `verbose` is false.
    (
      CliDIContainer as unknown as { _diagnostics: { dispose(): void } }
    )._diagnostics = governorShutdownHandle(c);
    CliDIContainer.disposeDiagnostics();

    expect(governor.state).toBe('disposed');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    // Cleared, so a second signal's call is a no-op.
    expect(() => CliDIContainer.disposeDiagnostics()).not.toThrow();
  });

  it('does not construct the governor before dispose', () => {
    const c = buildGovernorContainer();
    const resolve = jest.spyOn(c, 'resolve');

    governorShutdownHandle(c);

    expect(resolve).not.toHaveBeenCalled();
  });
});
