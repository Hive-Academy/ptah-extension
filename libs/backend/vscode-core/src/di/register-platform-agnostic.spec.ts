/**
 * `registerVsCodeCorePlatformAgnostic` — the null-object defaults.
 *
 * The point of the `if (!container.isRegistered(...))` guard is that a host
 * which already bound a REAL adapter (Electron binds a coordinator-backed boot
 * readiness provider in `bootstrap.ts`) keeps it. Getting that wrong is not a
 * compile error and not a crash — the host would silently report "ready" for
 * the whole of a boot it is in the middle of.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IBootReadinessProvider } from '@ptah-extension/platform-core';
import type { Logger } from '../logging/logger';
import { registerVsCodeCorePlatformAgnostic } from './register-platform-agnostic';
import { NullBootReadinessProvider } from '../services/null-boot-readiness';

function createLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

describe('registerVsCodeCorePlatformAgnostic — BOOT_READINESS default', () => {
  it('registers the null provider when nothing else has', () => {
    const child = rootContainer.createChildContainer();

    registerVsCodeCorePlatformAgnostic(child, createLogger(), {
      includeLicensingAndAuth: false,
    });

    expect(child.isRegistered(PLATFORM_TOKENS.BOOT_READINESS)).toBe(true);
    const resolved = child.resolve<IBootReadinessProvider>(
      PLATFORM_TOKENS.BOOT_READINESS,
    );
    expect(resolved).toBeInstanceOf(NullBootReadinessProvider);
    expect(resolved.getReadiness().readiness).toBe('ready');
  });

  it('does NOT replace a provider a host already registered', () => {
    const child = rootContainer.createChildContainer();
    const hostProvider: IBootReadinessProvider = {
      getReadiness: () => ({
        readiness: 'warming',
        phase: 'database',
        startedAt: 1000,
      }),
    };
    child.register(PLATFORM_TOKENS.BOOT_READINESS, {
      useValue: hostProvider,
    });

    registerVsCodeCorePlatformAgnostic(child, createLogger(), {
      includeLicensingAndAuth: false,
    });

    const resolved = child.resolve<IBootReadinessProvider>(
      PLATFORM_TOKENS.BOOT_READINESS,
    );
    expect(resolved).toBe(hostProvider);
    expect(resolved.getReadiness().readiness).toBe('warming');
  });
});
