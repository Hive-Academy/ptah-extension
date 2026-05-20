/**
 * 5 RPC handlers registered.
 *
 * The fix added registration for `config:model-set`, `auth:setApiKey`,
 * `auth:getStatus`, `settings:export`, `settings:import` against the
 * in-process `cli-message-transport`. Pre-fix, calling these via
 * `ptah <subcommand>` returned "method not found" and the subcommand
 * exited with `internal_failure`.
 *
 * Per architect's Q3 verification, these handlers are NOT registered on
 * `ptah interact`'s inbound JSON-RPC channel — interact only registers
 * `task.submit / task.cancel / session.shutdown / session.history`
 * (verified `apps/ptah-cli/src/cli/commands/interact.ts:504-643`). The
 * proper observable surface is therefore a subcommand spawn whose stderr
 * we scan for `method not found`.
 *
 * Each test asserts that:
 *   - the subcommand does NOT emit a `task.error` with `ptah_code:'internal_failure'`
 *     and a message containing "method not found";
 *   - the relevant success notification (e.g. `auth.status`,
 *     `settings.exported`, `config.model`) lands on stdout.
 */

import * as path from 'node:path';
import {
  CliRunner,
  createTmpHome,
  type OneshotResult,
  type TmpHome,
} from './_harness';

jest.setTimeout(60_000);

const FAKE_API_KEY = 'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';

describe('5 RPC handlers registered (Bug 6)', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('config:model-set is registered (config model-switch <model>)', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['config', 'model-switch', 'sonnet'],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    assertNoMethodNotFound(result, 'config:model-set');
    // The command emits `config.model` notification on success/dispatch.
    const seen = methods(result);
    expect(seen).toEqual(expect.arrayContaining(['config.model']));
  });

  it('auth:getStatus is registered (auth status)', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['auth', 'status'],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    assertNoMethodNotFound(result, 'auth:getStatus');
    const seen = methods(result);
    expect(seen).toEqual(expect.arrayContaining(['auth.status']));
  });

  it('auth:setApiKey is registered (provider set-key)', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'provider',
        'set-key',
        '--provider',
        'anthropic',
        '--key',
        FAKE_API_KEY,
      ],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    assertNoMethodNotFound(result, 'auth:setApiKey');
    const seen = methods(result);
    expect(seen).toEqual(expect.arrayContaining(['provider.key.set']));
  });

  it('settings:export is registered (settings export)', async () => {
    const target = path.join(tmp.path, 'exported-settings.json');
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['settings', 'export', '--out', target],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    assertNoMethodNotFound(result, 'settings:export');
    const seen = methods(result);
    expect(seen).toEqual(expect.arrayContaining(['settings.exported']));
  });

  it('settings:import is registered (settings import)', async () => {
    // Pre-seed a minimal settings JSON for import.
    const importPath = path.join(tmp.path, 'import-me.json');
    await tmp.writeFile('import-me.json', JSON.stringify({ provider: {} }));
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['settings', 'import', '--in', importPath],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    assertNoMethodNotFound(result, 'settings:import');
    const seen = methods(result);
    expect(seen).toEqual(expect.arrayContaining(['settings.imported']));
  });
});

function methods(result: OneshotResult): string[] {
  return result.stdoutLines
    .filter(
      (l): l is { method: string } =>
        typeof l === 'object' &&
        l !== null &&
        typeof (l as { method?: unknown }).method === 'string',
    )
    .map((l) => l.method);
}

function assertNoMethodNotFound(result: OneshotResult, method: string): void {
  // The CLI surfaces backend "method not found" via `task.error` notification
  // OR via the structured stderr emitFatalError line. Scan both surfaces.
  for (const line of result.stdoutLines) {
    if (typeof line !== 'object' || line === null) continue;
    const obj = line as Record<string, unknown>;
    if (obj['method'] !== 'task.error') continue;
    const params = obj['params'];
    if (typeof params === 'object' && params !== null) {
      const message = String(
        (params as Record<string, unknown>)['message'] ?? '',
      ).toLowerCase();
      if (message.includes('method not found')) {
        throw new Error(
          `RPC method '${method}' surfaced 'method not found': ${JSON.stringify(params)}`,
        );
      }
    }
  }
  expect(result.stderr.toLowerCase()).not.toMatch(/method not found/);
}
