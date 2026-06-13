/**
 * Unit tests for CliPlatformCommands.
 *
 * The CLI has no window / terminal / chat UI, so every command is a no-op.
 * Critically, NONE of them may write to stdout (it carries the JSON-RPC NDJSON
 * machine stream); --verbose breadcrumbs go to stderr.
 */

import { CliPlatformCommands } from './cli-platform-commands.js';

describe('CliPlatformCommands', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('never writes to stdout or console.log (default)', async () => {
    const cmds = new CliPlatformCommands();
    await cmds.reloadWindow();
    cmds.openTerminal('name', 'echo hi');
    await cmds.focusChat();

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('emits breadcrumbs to stderr (never stdout) when verbose', async () => {
    const cmds = new CliPlatformCommands({ verbose: true });
    await cmds.reloadWindow();
    cmds.openTerminal('name', 'echo hi');
    await cmds.focusChat();

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(3);
    const written = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(written[0]).toContain('reloadWindow');
    expect(written[1]).toContain('openTerminal');
    expect(written[2]).toContain('focusChat');
  });
});
