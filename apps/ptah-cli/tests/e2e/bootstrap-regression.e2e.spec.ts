/**
 * Bootstrap regression — locks in the freshly-fixed CLI bootstrap behaviors so
 * they can never silently regress.
 *
 * Every test runs against an ISOLATED, fresh `PTAH_CONFIG_PATH` (a unique tmp
 * dir per test via `createTmpHome`) and the non-TTY / no-color env the harness
 * already enforces. The real `~/.ptah` is never touched.
 *
 * Coverage map (each `it` = one freshly-fixed behavior):
 *   1. fresh `doctor`            → `auth.defaultProvider === ""`, no vscode-lm
 *   2. fake provider key         → exit 3, task.error auth_required, verified:false
 *   3. slot unification          → set-key writes the SDK-read slot (keystone)
 *   4. fake license              → exit 4, task.error license_required, "not accepted"
 *   5. init machine mode         → init.plan with steps[], exit 0, no hang
 *   6. no stdout pollution       → every stdout line parses, no breadcrumb/stack leak
 *   7. session no-hang           → start --once / start both terminate + session.created
 */

import { CliRunner, createTmpHome, type TmpHome } from './_harness';

jest.setTimeout(90_000);

/**
 * The two `session start does not hang` cases run a REAL agent turn
 * (session start → Claude Agent SDK → the Anthropic API). With the placeholder
 * key that means repeated `401`s fired at the live API from CI, which risks
 * abuse flags / IP bans — and the turn's terminate-vs-hang behavior depends on
 * external runtime behavior we don't control anyway. Skip them in CI (they
 * still run locally against your own environment); the rest of this suite
 * (doctor / set-key / license / init / stdout hygiene) exercises the bootstrap
 * without any network turn.
 */
const describeSessionTurn = process.env['CI'] ? describe.skip : describe;

/** Format-valid Anthropic placeholder — passes `sk-ant-` + length validation. */
const PLACEHOLDER_ANTHROPIC_KEY = `sk-ant-api03-${'a'.repeat(95)}`;
/** Format-valid Ptah license placeholder — `ptah_lic_` + 64 hex chars. */
const FAKE_LICENSE_KEY = `ptah_lic_${'0'.repeat(64)}`;

interface NotificationLike {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

function isNotification(value: unknown): value is NotificationLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    typeof (value as { method?: unknown }).method === 'string'
  );
}

function notificationsByMethod(
  lines: unknown[],
  method: string,
): NotificationLike[] {
  return lines.filter(
    (line): line is NotificationLike =>
      isNotification(line) && line.method === method,
  );
}

function firstNotification(
  lines: unknown[],
  method: string,
): NotificationLike | undefined {
  return notificationsByMethod(lines, method)[0];
}

/**
 * Isolation env every regression test shares: a fresh `PTAH_CONFIG_PATH` rooted
 * under the per-test tmp home (already mkdir'd by `createTmpHome`) plus the
 * deprecation-silencing flag the manual repro used. Color / TTY / HOME isolation
 * is owned by the harness's `buildEnv`.
 */
function isolatedEnv(tmp: TmpHome): NodeJS.ProcessEnv {
  return {
    PTAH_CONFIG_PATH: tmp.ptahDir,
    NODE_OPTIONS: '--no-deprecation',
  };
}

/**
 * Assert no stdout line leaked a no-op platform-command breadcrumb or a raw
 * stack-trace fragment, and that every stdout line parsed as JSON.
 */
function assertNoStdoutPollution(result: {
  stdoutRaw: string;
  hasMalformedStdout: boolean;
  stdoutLines: unknown[];
}): void {
  expect(result.hasMalformedStdout).toBe(false);
  expect(result.stdoutRaw).not.toContain('CliPlatformCommands.reloadWindow');
  for (const line of result.stdoutLines) {
    if (!isNotification(line) || line.method !== 'task.error') continue;
    const message = String(line.params?.['message'] ?? '');
    expect(message).not.toContain('main.mjs:');
    expect(message).not.toContain('at file://');
  }
}

describe('ptah-cli bootstrap regression', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome('ptah-e2e-bootstrap-');
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('fresh doctor reports an empty defaultProvider and no vscode-lm blocker', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['doctor'],
      env: isolatedEnv(tmp),
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    assertNoStdoutPollution(result);

    const report = firstNotification(result.stdoutLines, 'doctor.report');
    expect(report).toBeDefined();
    const auth = report?.params?.['auth'] as
      | { defaultProvider?: unknown }
      | undefined;
    expect(auth?.defaultProvider).toBe('');
    expect(JSON.stringify(report?.params)).not.toContain('vscode-lm');

    const effective = report?.params?.['effective'] as
      | { blockers?: unknown[] }
      | undefined;
    for (const blocker of effective?.blockers ?? []) {
      expect(String(blocker)).not.toContain('vscode-lm');
    }
  });

  it('rejects a malformed provider key with exit 3 and verified:false', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'provider',
        'set-key',
        '--provider',
        'anthropic',
        '--key',
        'totally-fake',
      ],
      env: isolatedEnv(tmp),
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(3);
    assertNoStdoutPollution(result);

    expect(
      firstNotification(result.stdoutLines, 'provider.key.set'),
    ).toBeUndefined();

    const error = firstNotification(result.stdoutLines, 'task.error');
    expect(error).toBeDefined();
    expect(error?.params?.['ptah_code']).toBe('auth_required');
    expect(error?.params?.['verified']).toBe(false);
  });

  it('keystone: a verified set-key writes the SDK-read slot (status + doctor agree)', async () => {
    const setKey = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'provider',
        'set-key',
        '--provider',
        'anthropic',
        '--key',
        PLACEHOLDER_ANTHROPIC_KEY,
      ],
      env: isolatedEnv(tmp),
      timeoutMs: 60_000,
    });

    expect(setKey.exitCode).toBe(0);
    assertNoStdoutPollution(setKey);
    const keySet = firstNotification(setKey.stdoutLines, 'provider.key.set');
    expect(keySet?.params?.['verified']).toBe(true);

    const status = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['provider', 'status'],
      env: isolatedEnv(tmp),
      timeoutMs: 60_000,
    });

    expect(status.exitCode).toBe(0);
    assertNoStdoutPollution(status);
    const statusNote = firstNotification(status.stdoutLines, 'provider.status');
    const providers = (statusNote?.params?.['providers'] ?? []) as Array<{
      name?: string;
      hasApiKey?: unknown;
    }>;
    const anthropicStatus = providers.find((p) => p.name === 'anthropic');
    expect(anthropicStatus).toBeDefined();
    expect(anthropicStatus?.hasApiKey).toBe(true);

    const doctor = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['doctor'],
      env: isolatedEnv(tmp),
      timeoutMs: 60_000,
    });

    expect(doctor.exitCode).toBe(0);
    assertNoStdoutPollution(doctor);
    const report = firstNotification(doctor.stdoutLines, 'doctor.report');
    const doctorProviders = (report?.params?.['providers'] ?? []) as Array<{
      id?: string;
      status?: unknown;
    }>;
    const anthropicDoctor = doctorProviders.find((p) => p.id === 'anthropic');
    expect(anthropicDoctor?.status).toBe('connected');
    const effective = report?.params?.['effective'] as
      | { ready?: unknown }
      | undefined;
    expect(effective?.ready).toBe(true);
  });

  it('rejects a server-rejected license key with exit 4 and a "not accepted" message', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['license', 'set', '--key', FAKE_LICENSE_KEY],
      env: isolatedEnv(tmp),
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(4);
    assertNoStdoutPollution(result);

    expect(
      firstNotification(result.stdoutLines, 'license.updated'),
    ).toBeUndefined();

    const error = firstNotification(result.stdoutLines, 'task.error');
    expect(error).toBeDefined();
    expect(error?.params?.['ptah_code']).toBe('license_required');
    expect(error?.params?.['success']).toBe(false);
    expect(String(error?.params?.['message'])).toMatch(/not accepted/i);
  });

  it('init in machine mode emits an init.plan with steps[] and exits 0 without hanging', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['init'],
      env: isolatedEnv(tmp),
      timeoutMs: 60_000,
    });

    expect(result.signal).toBeNull();
    expect(result.exitCode).toBe(0);
    assertNoStdoutPollution(result);

    const plan = firstNotification(result.stdoutLines, 'init.plan');
    expect(plan).toBeDefined();
    expect(Array.isArray(plan?.params?.['steps'])).toBe(true);
    expect((plan?.params?.['steps'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('emits only valid JSON on stdout across the bootstrap commands (no breadcrumb / stack leak)', async () => {
    const commandsUnderTest: string[][] = [
      ['doctor'],
      [
        'provider',
        'set-key',
        '--provider',
        'anthropic',
        '--key',
        'totally-fake',
      ],
      ['license', 'set', '--key', FAKE_LICENSE_KEY],
      ['init'],
    ];

    for (const args of commandsUnderTest) {
      const result = await CliRunner.spawnOneshot({
        home: tmp,
        args,
        env: isolatedEnv(tmp),
        timeoutMs: 60_000,
      });
      assertNoStdoutPollution(result);
    }
  });

  describeSessionTurn(
    'session start does not hang (with a configured placeholder key)',
    () => {
      beforeEach(async () => {
        const setKey = await CliRunner.spawnOneshot({
          home: tmp,
          args: [
            'provider',
            'set-key',
            '--provider',
            'anthropic',
            '--key',
            PLACEHOLDER_ANTHROPIC_KEY,
          ],
          env: isolatedEnv(tmp),
          timeoutMs: 60_000,
        });
        expect(setKey.exitCode).toBe(0);

        const setDefault = await CliRunner.spawnOneshot({
          home: tmp,
          args: ['provider', 'default', 'set', 'anthropic'],
          env: isolatedEnv(tmp),
          timeoutMs: 60_000,
        });
        expect(setDefault.exitCode).toBe(0);
      });

      it('session start --task --once terminates and emits session.created', async () => {
        const result = await CliRunner.spawnOneshot({
          home: tmp,
          args: ['session', 'start', '--task', 'say hi', '--once'],
          env: isolatedEnv(tmp),
          timeoutMs: 75_000,
        });

        expect(result.signal).toBeNull();
        expect(result.exitCode).not.toBeNull();
        expect(
          firstNotification(result.stdoutLines, 'session.created'),
        ).toBeDefined();
        expect(result.stdoutRaw).not.toContain('Settings > Authentication tab');
        expect(result.stderr).not.toContain('Settings > Authentication tab');
      });

      it('session start --task (no --once) terminates and emits session.created', async () => {
        const result = await CliRunner.spawnOneshot({
          home: tmp,
          args: ['session', 'start', '--task', 'say hi'],
          env: isolatedEnv(tmp),
          timeoutMs: 75_000,
        });

        expect(result.signal).toBeNull();
        expect(result.exitCode).not.toBeNull();
        expect(
          firstNotification(result.stdoutLines, 'session.created'),
        ).toBeDefined();
        expect(result.stdoutRaw).not.toContain('Settings > Authentication tab');
        expect(result.stderr).not.toContain('Settings > Authentication tab');
      });
    },
  );
});
