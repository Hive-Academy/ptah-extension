/**
 * Messaging Gateway e2e — TASK_2026_141 Batch 7, Task 7.3.
 *
 * Flow: status default-off → set-token via stdin (assert ciphertext lands,
 *       plaintext ABSENT from secrets file AND stdout) → bindings empty →
 *       start one-shot returns adaptersLive:false notice → stop.
 *
 * Fake-adapter inbound simulation re-scoped out (no cross-process injection
 * seam — recorded per R11.2). Binding approve/block covered at unit level.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import { CliRunner, createTmpHome, type TmpHome } from './_harness';

jest.setTimeout(90_000);

const FAKE_TOKEN = 'tg-test-token-e2e-12345-never-used';

interface GatewayStatusPayload {
  enabled: boolean;
  adapters: Array<{ platform: string; running: boolean }>;
  adaptersLive: boolean;
}

interface GatewayTokenSetPayload {
  platform: string;
  ok: boolean;
}

interface GatewayBindingsPayload {
  bindings: unknown[];
}

interface GatewayStartedPayload {
  adaptersLive: boolean;
  notice: string;
}

interface GatewayStoppedPayload {
  ok: boolean;
}

function findNotification<T = unknown>(
  lines: unknown[],
  method: string,
): T | undefined {
  for (const line of lines) {
    if (
      typeof line === 'object' &&
      line !== null &&
      (line as { method?: unknown }).method === method
    ) {
      return (line as { params: T }).params;
    }
  }
  return undefined;
}

describe('messaging gateway e2e (TASK_2026_141 Batch 7)', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome('ptah-e2e-gw-');
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('gateway status returns enabled:false by default', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'status', '--json'],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<GatewayStatusPayload>(
      result.stdoutLines,
      'gateway.status',
    );
    expect(payload).toBeDefined();
    expect(payload!.enabled).toBe(false);
    expect(payload!.adaptersLive).toBe(false);
  });

  it('set-token via stdin: ciphertext lands in secrets file, plaintext absent from file and stdout', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'set-token', 'telegram', '--stdin', '--json'],
      stdin: `${FAKE_TOKEN}\n`,
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<GatewayTokenSetPayload>(
      result.stdoutLines,
      'gateway.token_set',
    );
    expect(payload).toBeDefined();
    expect(payload!.ok).toBe(true);
    expect(payload!.platform).toBe('telegram');

    expect(result.stdoutRaw).not.toContain(FAKE_TOKEN);

    const secretsPath = path.join(tmp.path, '.ptah', 'secrets.enc.json');
    expect(fs.existsSync(secretsPath)).toBe(true);
    const secretsContent = fs.readFileSync(secretsPath, 'utf8');

    expect(secretsContent).not.toContain(FAKE_TOKEN);

    const secrets = JSON.parse(secretsContent) as {
      entries: Record<string, unknown>;
    };
    const TOKEN_KEY = 'gateway.telegram.tokenCipher';
    expect(
      Object.prototype.hasOwnProperty.call(secrets.entries, TOKEN_KEY),
    ).toBe(true);
    const cipher = secrets.entries[TOKEN_KEY];
    expect(typeof cipher).toBe('object');
    expect(cipher).not.toBeNull();
  });

  it('bindings list returns empty array in fresh state', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'status', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'bindings', '--json'],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<GatewayBindingsPayload>(
      result.stdoutLines,
      'gateway.bindings',
    );
    expect(payload).toBeDefined();
    expect(Array.isArray(payload!.bindings)).toBe(true);
    expect(payload!.bindings.length).toBe(0);
  });

  it('gateway start one-shot returns adaptersLive:false honest notice', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'status', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'start', '--json'],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<GatewayStartedPayload>(
      result.stdoutLines,
      'gateway.started',
    );
    expect(payload).toBeDefined();
    expect(payload!.adaptersLive).toBe(false);
    expect(typeof payload!.notice).toBe('string');
    expect(payload!.notice.length).toBeGreaterThan(0);
  });

  it('gateway stop exits cleanly', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'status', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['gateway', 'stop', '--json'],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<GatewayStoppedPayload>(
      result.stdoutLines,
      'gateway.stopped',
    );
    expect(payload).toBeDefined();
    expect(payload!.ok).toBe(true);
  });
});
