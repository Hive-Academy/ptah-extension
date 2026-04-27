/**
 * `createMockPlatformCommands` — `jest.Mocked<IPlatformCommands>` wiring the
 * small platform-level command surface (reload window / open terminal) to
 * no-op jest spies.
 */

import type { IPlatformCommands } from '../../interfaces/platform-abstractions.interface';

export type MockPlatformCommands = jest.Mocked<IPlatformCommands>;

export function createMockPlatformCommands(
  overrides?: Partial<IPlatformCommands>,
): MockPlatformCommands {
  const mock: MockPlatformCommands = {
    reloadWindow: jest.fn(async (): Promise<void> => {
      /* noop */
    }),
    openTerminal: jest.fn((_name: string, _command: string): void => {
      /* noop */
    }),
  };

  if (overrides?.reloadWindow) {
    mock.reloadWindow = jest.fn(overrides.reloadWindow);
  }
  if (overrides?.openTerminal) {
    mock.openTerminal = jest.fn(overrides.openTerminal);
  }

  return mock;
}
