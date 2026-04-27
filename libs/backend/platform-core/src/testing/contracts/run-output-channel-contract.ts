/**
 * `runOutputChannelContract` — behavioural contract for `IOutputChannel`.
 *
 * Impls need not surface the same buffer back out (production channels emit
 * to the host UI directly), but the public surface must be callable, side
 * effect free for observers, and `dispose()` must be idempotent.
 */

import type { IOutputChannel } from '../../interfaces/output-channel.interface';

export function runOutputChannelContract(
  name: string,
  createProvider: () => Promise<IOutputChannel> | IOutputChannel,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IOutputChannel contract — ${name}`, () => {
    let channel: IOutputChannel;

    beforeEach(async () => {
      channel = await createProvider();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('exposes a non-empty name string', () => {
      expect(typeof channel.name).toBe('string');
      expect(channel.name.length).toBeGreaterThan(0);
    });

    it('appendLine does not throw on plain ASCII input', () => {
      expect(() => channel.appendLine('hello')).not.toThrow();
    });

    it('appendLine does not throw on multi-byte / emoji input', () => {
      expect(() => channel.appendLine('hello — 🌍')).not.toThrow();
    });

    it('append does not throw on fragment input', () => {
      expect(() => channel.append('partial')).not.toThrow();
    });

    it('clear does not throw before or after writes', () => {
      expect(() => channel.clear()).not.toThrow();
      channel.appendLine('line');
      expect(() => channel.clear()).not.toThrow();
    });

    it('show does not throw — may be a no-op in headless impls', () => {
      expect(() => channel.show()).not.toThrow();
    });

    it('dispose is idempotent', () => {
      expect(() => channel.dispose()).not.toThrow();
      expect(() => channel.dispose()).not.toThrow();
    });
  });
}
