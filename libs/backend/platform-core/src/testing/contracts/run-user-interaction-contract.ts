/**
 * `runUserInteractionContract` — behavioural contract for `IUserInteraction`.
 *
 * Tests only what can be observed without a real UI: return types of the
 * message/input/pick surfaces, withProgress task invocation, and
 * openExternal/clipboard boolean resolutions. Scripted responses are wired
 * via the optional `script` hook on the setup return.
 */

import type { IUserInteraction } from '../../interfaces/user-interaction.interface';

export interface UserInteractionSetup {
  provider: IUserInteraction;
  /**
   * Optional script helper — lets the contract tell the setup what to return
   * from specific interactive calls before they fire.
   */
  script?(config: {
    nextInput?: string;
    nextQuickPick?: { label: string };
    nextAction?: string;
  }): void;
}

export function runUserInteractionContract(
  name: string,
  createSetup: () => Promise<UserInteractionSetup> | UserInteractionSetup,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IUserInteraction contract — ${name}`, () => {
    let setup: UserInteractionSetup;

    beforeEach(async () => {
      setup = await createSetup();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('showErrorMessage resolves to undefined when no action is scripted', async () => {
      await expect(
        setup.provider.showErrorMessage('boom'),
      ).resolves.toBeUndefined();
    });

    it('showWarningMessage resolves to a string when an action is scripted', async () => {
      setup.script?.({ nextAction: 'Retry' });
      const result = await setup.provider.showWarningMessage(
        'unstable',
        'Retry',
        'Cancel',
      );
      // Mocks without script still return undefined — accept both.
      expect([undefined, 'Retry']).toContain(result);
    });

    it('showInformationMessage returns a Promise<string | undefined>', async () => {
      const result = await setup.provider.showInformationMessage('info');
      expect(['string', 'undefined']).toContain(typeof result);
    });

    it('showInputBox resolves with the scripted value or undefined', async () => {
      setup.script?.({ nextInput: 'typed-value' });
      const result = await setup.provider.showInputBox({ prompt: 'enter' });
      expect([undefined, 'typed-value']).toContain(result);
    });

    it('showQuickPick resolves with a QuickPickItem or undefined', async () => {
      setup.script?.({ nextQuickPick: { label: 'one' } });
      const result = await setup.provider.showQuickPick([
        { label: 'one' },
        { label: 'two' },
      ]);
      expect(result === undefined || typeof result.label === 'string').toBe(
        true,
      );
    });

    it('withProgress invokes the task and returns its resolved value', async () => {
      const value = await setup.provider.withProgress(
        { title: 'load' },
        async (progress, token) => {
          expect(typeof progress.report).toBe('function');
          expect(typeof token.isCancellationRequested).toBe('boolean');
          return 42;
        },
      );
      expect(value).toBe(42);
    });

    it('openExternal resolves to a boolean', async () => {
      const ok = await setup.provider.openExternal('https://example.com');
      expect(typeof ok).toBe('boolean');
    });

    it('writeToClipboard resolves without throwing for plain strings', async () => {
      await expect(
        setup.provider.writeToClipboard('hello'),
      ).resolves.toBeUndefined();
    });

    it('openOAuthUrl returns { opened, code? } shape without userCode', async () => {
      const result = await setup.provider.openOAuthUrl({
        provider: 'copilot',
        verificationUri: 'https://github.com/login/device',
      });
      expect(result).toBeDefined();
      expect(typeof result.opened).toBe('boolean');
      // `code` is optional; if present it must be a string
      if (result.code !== undefined) {
        expect(typeof result.code).toBe('string');
      }
    });

    it('openOAuthUrl returns { opened, code? } shape with userCode', async () => {
      const result = await setup.provider.openOAuthUrl({
        provider: 'copilot',
        verificationUri: 'https://github.com/login/device',
        userCode: 'ABCD-1234',
      });
      expect(result).toBeDefined();
      expect(typeof result.opened).toBe('boolean');
      if (result.code !== undefined) {
        expect(typeof result.code).toBe('string');
      }
    });
  });
}
