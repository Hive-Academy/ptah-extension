/**
 * Unit tests for CliPlatformCommands.
 *
 * The CLI has no window / terminal / chat UI, so every command is a no-op.
 * Critically, NONE of them may write to stdout (it carries the JSON-RPC NDJSON
 * machine stream); --verbose breadcrumbs go to stderr.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  AuthDeviceCodePayload,
  AuthLoginOutputPayload,
} from '@ptah-extension/shared';

import { CliPlatformCommands } from './cli-platform-commands.js';
import type { AuthCommandPushSink } from './cli-platform-commands.js';

/** Records every push so assertions can read the emitted event stream. */
function makeRecordingSink(): AuthCommandPushSink & {
  events: Array<{ type: string; payload: unknown }>;
} {
  const events: Array<{ type: string; payload: unknown }> = [];
  return {
    events,
    broadcastMessage: async (type, payload) => {
      events.push({ type, payload });
    },
  };
}

/**
 * Materialise a script file and return the `node <path>` command line.
 *
 * `runAuthCommand` splits the command on whitespace (adequate for its only
 * caller, `codex login --device-auth`), so the command must not contain quoted
 * or space-bearing arguments — hence a file rather than `node -e "..."`, and
 * `node` from PATH rather than `process.execPath`, which on Windows lives
 * under `C:\Program Files\`.
 */
function nodeScript(dir: string, name: string, source: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, 'utf8');
  return `node ${file}`;
}

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

  /**
   * `runAuthCommand` is the fix for `auth:codexLogin` reporting success while
   * `openTerminal` did nothing. The contract that matters:
   *   - the command actually runs,
   *   - `success` tracks the real exit status (never optimistic),
   *   - a missing binary is a reported failure, not a throw,
   *   - output reaches the UI as push events instead of the real stdout,
   *     which the TUI owns.
   */
  describe('runAuthCommand', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-auth-cmd-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('is detectable as the IAuthCommandRunner capability', () => {
      const cmds = new CliPlatformCommands();
      expect(typeof cmds.runAuthCommand).toBe('function');
    });

    it('reports success only when the process exits 0', async () => {
      const cmds = new CliPlatformCommands();
      const result = await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: nodeScript(tmpDir, 'ok.js', 'process.exit(0);'),
      });

      expect(result).toEqual({ success: true, exitCode: 0 });
    });

    it('reports failure with the real exit code (never optimistic success)', async () => {
      const cmds = new CliPlatformCommands();
      const result = await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: nodeScript(tmpDir, 'fail.js', 'process.exit(7);'),
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(7);
      expect(result.error).toContain('7');
    });

    it('reports a missing binary as a failure instead of throwing', async () => {
      const cmds = new CliPlatformCommands();
      const result = await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: 'ptah-definitely-not-a-real-binary --device-auth',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PATH');
    });

    it('rejects an empty command without spawning', async () => {
      const cmds = new CliPlatformCommands();
      const result = await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: '   ',
      });

      expect(result).toEqual({
        success: false,
        exitCode: null,
        error: 'Empty auth command.',
      });
    });

    it('pushes child output as auth:loginOutput and never writes to stdout', async () => {
      const sink = makeRecordingSink();
      const cmds = new CliPlatformCommands({ pushSink: sink });

      await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: nodeScript(
          tmpDir,
          'chatty.js',
          'console.log("hello");console.error("oops");',
        ),
      });

      const output = sink.events
        .filter((e) => e.type === MESSAGE_TYPES.AUTH_LOGIN_OUTPUT)
        .map((e) => e.payload as AuthLoginOutputPayload);

      expect(output.map((o) => o.line)).toEqual(
        expect.arrayContaining(['hello', 'oops']),
      );
      expect(output.every((o) => o.provider === 'openai-codex')).toBe(true);
      expect(output.some((o) => o.stream === 'stderr')).toBe(true);
      // stdout belongs to the Ink frame — the child must never reach it.
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('extracts a device code and verification URL from the output', async () => {
      const sink = makeRecordingSink();
      const cmds = new CliPlatformCommands({ pushSink: sink });

      await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: nodeScript(
          tmpDir,
          'device.js',
          'console.log("Enter code ABCD-1234 at https://auth.example.com/device");',
        ),
      });

      const device = sink.events
        .filter((e) => e.type === MESSAGE_TYPES.AUTH_DEVICE_CODE)
        .map((e) => e.payload as AuthDeviceCodePayload);

      expect(device).toHaveLength(1);
      expect(device[0]?.userCode).toBe('ABCD-1234');
      expect(device[0]?.verificationUri).toBe(
        'https://auth.example.com/device',
      );
    });

    it('emits no device-code event for ordinary output lines', async () => {
      const sink = makeRecordingSink();
      const cmds = new CliPlatformCommands({ pushSink: sink });

      await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: nodeScript(tmpDir, 'plain.js', 'console.log("working...");'),
      });

      expect(
        sink.events.filter((e) => e.type === MESSAGE_TYPES.AUTH_DEVICE_CODE),
      ).toHaveLength(0);
    });

    it('kills and reports a command that outlives the timeout', async () => {
      const cmds = new CliPlatformCommands({ authCommandTimeoutMs: 150 });
      const result = await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: nodeScript(
          tmpDir,
          'hang.js',
          'setTimeout(() => process.exit(0), 60000);',
        ),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('runs and reports normally when no push sink is configured', async () => {
      const cmds = new CliPlatformCommands();
      const result = await cmds.runAuthCommand({
        provider: 'openai-codex',
        name: 'Codex Login',
        command: nodeScript(tmpDir, 'quiet.js', 'console.log("hi");'),
      });

      expect(result.success).toBe(true);
    });
  });
});
