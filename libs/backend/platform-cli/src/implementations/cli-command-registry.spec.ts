/**
 * `cli-command-registry.spec.ts` — runs `runCommandRegistryContract` against
 * `CliCommandRegistry`, plus CLI-specific coverage of `getRegisteredCommands`
 * (used by the TUI layer to build dynamic menus and help text).
 */

import 'reflect-metadata';
import { runCommandRegistryContract } from '@ptah-extension/platform-core/testing';
import { CliCommandRegistry } from './cli-command-registry';

runCommandRegistryContract(
  'CliCommandRegistry',
  () => new CliCommandRegistry(),
);

describe('CliCommandRegistry — CLI-specific behaviour', () => {
  let registry: CliCommandRegistry;

  beforeEach(() => {
    registry = new CliCommandRegistry();
  });

  it('getRegisteredCommands is empty on a fresh registry', () => {
    expect(registry.getRegisteredCommands()).toEqual([]);
  });

  it('getRegisteredCommands lists every registered id', () => {
    const a = registry.registerCommand('cmd.a', () => undefined);
    const b = registry.registerCommand('cmd.b', () => undefined);
    expect([...registry.getRegisteredCommands()].sort()).toEqual([
      'cmd.a',
      'cmd.b',
    ]);
    a.dispose();
    b.dispose();
  });

  it('getRegisteredCommands drops ids after dispose', () => {
    const a = registry.registerCommand('cmd.a', () => undefined);
    a.dispose();
    expect(registry.getRegisteredCommands()).not.toContain('cmd.a');
  });

  it('re-registering overwrites the prior handler', async () => {
    registry.registerCommand('cmd.x', () => 'first');
    registry.registerCommand('cmd.x', () => 'second');
    await expect(registry.executeCommand<string>('cmd.x')).resolves.toBe(
      'second',
    );
  });

  it('executeCommand propagates handler rejections', async () => {
    registry.registerCommand('cmd.bad', () => {
      throw new Error('boom');
    });
    await expect(registry.executeCommand('cmd.bad')).rejects.toThrow('boom');
  });

  it('executeCommand awaits async handlers (returns their resolved value)', async () => {
    registry.registerCommand('cmd.async', async () => {
      await Promise.resolve();
      return { ok: true };
    });
    await expect(registry.executeCommand('cmd.async')).resolves.toEqual({
      ok: true,
    });
  });
});
