/**
 * Permission level wiring.
 *
 * `--auto-approve` global flag and `PTAH_AUTO_APPROVE=true` env var
 * must elevate the SdkPermissionHandler permission level to 'yolo'. Verified
 * by spawning `ptah interact` with each input and confirming SDK init still
 * reaches `session.ready` (init succeeds → permission handler resolved →
 * `setPermissionLevel('yolo')` ran without throwing). Direct-observable
 * proof of the level itself is via stderr breadcrumb when `--verbose` is on.
 *
 * `ptah config autopilot set true|false` maps to
 * `permissionLevel: 'yolo'|'ask'` via the `config:autopilot-toggle` RPC.
 * The CLI emits `config.autopilot` notification with the resolved values.
 *
 * The autopilot config RPC handler is registered in-process (not on the
 * interact JSON-RPC inbound channel), so the autopilot tests use
 * `spawnOneshot()` against `ptah config autopilot ...` directly.
 */

import {
  CliRunner,
  createTmpHome,
  type RunnerHandle,
  type TmpHome,
} from './_harness';

jest.setTimeout(60_000);

const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

describe('permission gates (Bug 2 + Bug 3)', () => {
  let tmp: TmpHome;
  let runner: RunnerHandle | undefined;

  beforeEach(async () => {
    tmp = await createTmpHome();
  });

  afterEach(async () => {
    if (runner) {
      try {
        await runner.shutdown();
      } catch {
        try {
          await runner.kill();
        } catch {
          /* swallow */
        }
      }
      runner = undefined;
    }
    await tmp.cleanup();
  });

  it('--auto-approve reaches session.ready without throwing on permission setup (Bug 2)', async () => {
    // The fix wires post-DI: resolves SdkPermissionHandler, calls
    // setPermissionLevel('yolo'). If the resolution failed pre-fix, init still
    // succeeded (graceful try/catch) — but the verbose stderr breadcrumb is
    // the durable signal. We assert session.ready fires AND the verbose
    // breadcrumb mentions `auto-approve` / `yolo`.
    runner = await CliRunner.spawn({
      home: tmp,
      args: ['--auto-approve', '--verbose'],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
    });
    expect(runner.ready.protocol_version).toBe('2.0');
    // Wait briefly for stderr breadcrumb to flush.
    await new Promise((r) => setTimeout(r, 200));
    const stderr = runner.stderr();
    expect(stderr).toMatch(/auto-approve.*yolo|permission level set to yolo/i);
  });

  it('PTAH_AUTO_APPROVE=true reaches session.ready and emits the yolo breadcrumb (Bug 2)', async () => {
    runner = await CliRunner.spawn({
      home: tmp,
      args: ['--verbose'],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY, PTAH_AUTO_APPROVE: 'true' },
    });
    expect(runner.ready.protocol_version).toBe('2.0');
    await new Promise((r) => setTimeout(r, 200));
    const stderr = runner.stderr();
    expect(stderr).toMatch(/auto-approve.*yolo|permission level set to yolo/i);
  });

  it('config autopilot set true emits autopilot enabled with yolo permissionLevel (Bug 3)', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['config', 'autopilot', 'set', 'true'],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    expect(result.exitCode).toBe(0);
    const note = result.stdoutLines.find(
      (l): l is { method: string; params: Record<string, unknown> } =>
        isObj(l) && l['method'] === 'config.autopilot',
    );
    expect(note).toBeTruthy();
    expect(note!.params['enabled']).toBe(true);
    // The handler echoes `permissionLevel: 'yolo'` in the wrapped result
    // (verified `apps/ptah-cli/src/cli/commands/config.ts:362`). Allow either
    // a top-level field or nested under the wrapped backend result.
    const haystack = JSON.stringify(note!.params);
    expect(haystack).toMatch(/yolo/);
  });

  it('config autopilot set false emits autopilot disabled with ask permissionLevel (Bug 3)', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['config', 'autopilot', 'set', 'false'],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    expect(result.exitCode).toBe(0);
    const note = result.stdoutLines.find(
      (l): l is { method: string; params: Record<string, unknown> } =>
        isObj(l) && l['method'] === 'config.autopilot',
    );
    expect(note).toBeTruthy();
    expect(note!.params['enabled']).toBe(false);
    const haystack = JSON.stringify(note!.params);
    expect(haystack).toMatch(/ask/);
  });
});

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
