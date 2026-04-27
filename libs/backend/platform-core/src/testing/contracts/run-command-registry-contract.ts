/**
 * `runCommandRegistryContract` — behavioural contract for `ICommandRegistry`.
 *
 * Assertions focus on observable command routing: register returns a disposable
 * that unregisters, execute invokes the stored handler with args, and
 * executing an unknown id surfaces as a rejection rather than a silent resolve.
 */

import type { ICommandRegistry } from '../../interfaces/command-registry.interface';

export function runCommandRegistryContract(
  name: string,
  createProvider: () => Promise<ICommandRegistry> | ICommandRegistry,
  teardown?: () => Promise<void> | void,
): void {
  describe(`ICommandRegistry contract — ${name}`, () => {
    let registry: ICommandRegistry;

    beforeEach(async () => {
      registry = await createProvider();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('executeCommand on unknown id rejects', async () => {
      await expect(
        registry.executeCommand('no.such.command'),
      ).rejects.toThrow();
    });

    it('registerCommand followed by executeCommand invokes the handler', async () => {
      let invoked = false;
      const sub = registry.registerCommand('t.ping', () => {
        invoked = true;
        return 'pong';
      });
      const result = await registry.executeCommand<string>('t.ping');
      sub.dispose();
      expect(invoked).toBe(true);
      expect(result).toBe('pong');
    });

    it('executeCommand forwards variadic args to the handler', async () => {
      let received: unknown[] = [];
      const sub = registry.registerCommand('t.echo', (...args: unknown[]) => {
        received = args;
        return args.length;
      });
      const count = await registry.executeCommand<number>('t.echo', 'a', 1, {
        x: true,
      });
      sub.dispose();
      expect(count).toBe(3);
      expect(received).toEqual(['a', 1, { x: true }]);
    });

    it('disposing the registration unhooks the handler', async () => {
      const sub = registry.registerCommand('t.once', () => 'ok');
      sub.dispose();
      await expect(registry.executeCommand('t.once')).rejects.toThrow();
    });

    it('registerCommand supports async handlers', async () => {
      const sub = registry.registerCommand('t.async', async () => {
        await Promise.resolve();
        return 'done';
      });
      await expect(registry.executeCommand<string>('t.async')).resolves.toBe(
        'done',
      );
      sub.dispose();
    });

    it('re-registering after dispose restores execution', async () => {
      const first = registry.registerCommand('t.re', () => 'first');
      first.dispose();
      const second = registry.registerCommand('t.re', () => 'second');
      await expect(registry.executeCommand<string>('t.re')).resolves.toBe(
        'second',
      );
      second.dispose();
    });
  });
}
