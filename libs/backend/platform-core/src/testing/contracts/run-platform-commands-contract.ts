/**
 * `runPlatformCommandsContract` — behavioural contract for `IPlatformCommands`.
 *
 * The `IPlatformCommands` interface surface is intentionally lightweight:
 * each method is a fire-and-forget action with no return value (void /
 * Promise<void>). The observable invariants are therefore confined to:
 *
 *   1. `reloadWindow()` resolves without throwing.
 *   2. `openTerminal()` does not throw (synchronous void return).
 *   3. `focusChat()` resolves without throwing.
 *   4. Repeated calls to each method do not throw on the second invocation.
 *
 * Platform-specific side effects (actual window reload, terminal opening,
 * chat focus) cannot be observed in a unit test. The contract validates
 * that all three methods complete successfully for any conformant
 * implementation, including no-op stubs for headless platforms.
 */

import type { IPlatformCommands } from '../../interfaces/platform-abstractions.interface';

export function runPlatformCommandsContract(
  name: string,
  createProvider: () => Promise<IPlatformCommands> | IPlatformCommands,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IPlatformCommands contract — ${name}`, () => {
    let provider: IPlatformCommands;

    beforeEach(async () => {
      provider = await createProvider();
    });

    afterEach(async () => {
      await teardown?.();
    });

    // -------------------------------------------------------------------------
    // reloadWindow
    // -------------------------------------------------------------------------

    it('reloadWindow() resolves without throwing', async () => {
      await expect(provider.reloadWindow()).resolves.not.toThrow();
    });

    it('reloadWindow() resolves to undefined (no return value)', async () => {
      const result = await provider.reloadWindow();
      expect(result).toBeUndefined();
    });

    it('reloadWindow() can be called twice without throwing', async () => {
      await provider.reloadWindow();
      await expect(provider.reloadWindow()).resolves.not.toThrow();
    });

    // -------------------------------------------------------------------------
    // openTerminal
    // -------------------------------------------------------------------------

    it('openTerminal() does not throw when called with name and command', () => {
      expect(() =>
        provider.openTerminal('test-terminal', 'echo hello'),
      ).not.toThrow();
    });

    it('openTerminal() can be called with an empty command string without throwing', () => {
      expect(() => provider.openTerminal('test-terminal', '')).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // focusChat
    // -------------------------------------------------------------------------

    it('focusChat() resolves without throwing', async () => {
      await expect(provider.focusChat()).resolves.not.toThrow();
    });

    it('focusChat() resolves to undefined (no return value)', async () => {
      const result = await provider.focusChat();
      expect(result).toBeUndefined();
    });

    it('focusChat() can be called twice without throwing', async () => {
      await provider.focusChat();
      await expect(provider.focusChat()).resolves.not.toThrow();
    });
  });
}
