/**
 * End-to-end integration smoke for `ptah session start --task` against the
 * built dist binary.
 *
 * Gated on `PTAH_INTEGRATION_TESTS=1` so it stays out of the default unit-test
 * matrix. When enabled, the suite:
 *
 *   1. Requires `dist/apps/ptah-cli/main.mjs` to exist (run `nx build ptah-cli`
 *      first).
 *   2. Spawns a stub `claude` binary on PATH that emits a single Claude SDK
 *      JSON line and exits 0.
 *   3. Invokes the CLI in --json --auto-approve session start --task mode.
 *   4. Asserts the CLI emits `session.created` + at least one `chat:chunk`
 *      notification (proving the stub claude was actually invoked and its
 *      output flowed through the bridge), and exits 0 within 30 seconds.
 *
 * STATUS — currently SKIP-with-rationale.
 *
 * Wiring up a Windows-friendly stub `claude` binary that satisfies the SDK
 * adapter's auth + spawn checks is non-trivial and out of scope for this
 * test pass:
 *
 *   - The SDK adapter (libs/agent-sdk) initialize() probes for the real
 *     `@anthropic-ai/claude-agent-sdk` import, validates auth providers
 *     (anthropic / aws-bedrock / vertex / etc.), and may resolve OAuth
 *     credentials. A bare PowerShell stub on PATH does not satisfy this.
 *   - The proper integration setup needs either:
 *       a) A test-mode flag on the SDK adapter that bypasses real auth and
 *          uses an injected `query()` stub; or
 *       b) A workspace-local `.ptah/settings.json` override that maps
 *          `provider: 'mock'` to a local IPC stub.
 *   - Adding a Windows .cmd / .ps1 stub here would either silently fall
 *     through to "auth not configured" (testing the failure path, not the
 *     happy path) or require duplicating the entire SDK provider-resolution
 *     logic.
 *
 * MANUAL VERIFICATION until this gap closes:
 *
 *   1. `nx build ptah-cli`
 *   2. Configure a real Claude provider (Anthropic API key in
 *      `~/.ptah/settings.json` or env).
 *   3. `node dist/apps/ptah-cli/main.mjs --json --auto-approve session start \
 *        --profile claude_code --task "ping"`
 *   4. Observe stdout JSON-RPC stream contains `session.created` →
 *      `chat:chunk` → `chat:complete` → exit 0.
 *
 * Smoke coverage of the bundle launch (without spawning claude) is provided
 * by `apps/ptah-cli/src/smoke.spec.ts` — that suite catches the bootstrap-
 * level regression class.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DIST_BIN = path.join(REPO_ROOT, 'dist', 'apps', 'ptah-cli', 'main.mjs');

const integrationsEnabled = process.env['PTAH_INTEGRATION_TESTS'] === '1';

// Triple-gated: explicit env opt-in + dist exists + stub-claude wiring is in
// place. The third gate is currently always false (TODO above).
const STUB_CLAUDE_AVAILABLE = false;
const shouldRun =
  integrationsEnabled && existsSync(DIST_BIN) && STUB_CLAUDE_AVAILABLE;

const maybeDescribe = shouldRun ? describe : describe.skip;

maybeDescribe(
  'ptah session start --task — headless integration (gated)',
  () => {
    it('emits session.created → chat:chunk and exits 0', async () => {
      // TODO(integration): wire up a Windows-friendly stub `claude` binary that
      // satisfies the SDK adapter's auth probe, then implement:
      //
      //   const result = await spawnAsync(process.execPath, [
      //     DIST_BIN,
      //     '--json',
      //     '--auto-approve',
      //     'session', 'start',
      //     '--profile', 'claude_code',
      //     '--task', 'ping',
      //   ], { env: { ...process.env, PATH: stubBinDir + path.delimiter + process.env.PATH } });
      //
      //   const lines = result.stdout.split('\n').filter(Boolean).map(JSON.parse);
      //   const methods = lines.map(l => l.method);
      //   expect(methods).toContain('session.created');
      //   expect(methods.some(m => m === 'agent.message' || m === 'chat:chunk')).toBe(true);
      //   expect(result.exitCode).toBe(0);
      //
      // See file header for the wiring plan.
      expect(shouldRun).toBe(true); // unreachable when shouldRun=false; describe.skip handles that
    }, 30_000);
  },
);

// Placeholder describe so the file always has at least one test target the
// runner can report on (e.g. "0 tests, all skipped" beats "no tests found"
// in CI dashboards). When STUB_CLAUDE_AVAILABLE flips true, this becomes
// the integration coverage.
describe('ptah session start --task — headless integration (placeholder)', () => {
  it.skip('see file header — integration test gated on PTAH_INTEGRATION_TESTS=1 and stub-claude wiring', () => {
    /* placeholder */
  });
});
