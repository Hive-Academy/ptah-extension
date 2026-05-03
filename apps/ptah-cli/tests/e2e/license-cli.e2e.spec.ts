/**
 * Bug 8 — `--key` flag normalisation: commander may surface a repeated
 * `--key` flag as a `string[]`; the CLI must coerce to the first element
 * so the downstream RPC sees a raw string (not `['abc']`).
 *
 * Bug 9 (commit `5dd76fd0`) — cold-start license cache hydration: the
 * `LicenseCache` must hydrate from the persisted snapshot in
 * `~/.ptah/global-state.json` (key `ptah.licenseCache`) on cold start so
 * `license get` reflects the previously-stored tier without waiting for
 * a server round-trip.
 *
 * The `license:setKey` RPC contacts the production license server, which
 * will reject `sk-ant-e2e-fake-key-not-real-do-not-call-upstream` with a
 * 4xx response. Bug 8 is observable BEFORE that round-trip via the CLI's
 * stderr trace and the absence of a `usage_error` exit. We therefore
 * assert the absence of the pre-fix symptom (stderr containing
 * `["ptah_lic_...]"` or "TypeError"), not server success.
 *
 * Bug 9 is direct: pre-seed `global-state.json`, run `license status`,
 * assert the persisted tier appears in the `license.status` notification
 * BEFORE any network call could complete. The pre-fix code returned
 * `tier: 'free'` cold; post-fix it returns the persisted snapshot.
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
const FAKE_LICENSE_KEY =
  'ptah_lic_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('license CLI flag handling + cold-start cache (Bug 8 + Bug 9)', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome();
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('license set --key <raw> coerces array to string (Bug 8)', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['license', 'set', '--key', FAKE_LICENSE_KEY],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    // The pre-fix symptom was a `TypeError` or stringified array on stderr.
    // Server-side rejection is acceptable; client-side flag mishandling is not.
    expect(result.stderr).not.toMatch(/TypeError/);
    expect(result.stderr).not.toMatch(/\[\s*"ptah_lic_/);
    // Either license.updated (success) OR a structured task.error landed.
    const seen = methodsOf(result);
    expect(
      seen.some(
        (m) =>
          m === 'license.updated' ||
          m === 'task.error' ||
          m === 'license.status',
      ),
    ).toBe(true);
  });

  it('provider set-key --key <raw> coerces array to string (Bug 8)', async () => {
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
    expect(result.stderr).not.toMatch(/TypeError/);
    expect(result.stderr).not.toMatch(/\[\s*"sk-ant-/);
    const seen = methodsOf(result);
    expect(seen).toEqual(expect.arrayContaining(['provider.key.set']));
  });

  it('websearch set-key --key <raw> coerces array to string (Bug 8)', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: [
        'websearch',
        'set-key',
        '--provider',
        'tavily',
        '--key',
        'tvly-fake-e2e-key',
      ],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    expect(result.stderr).not.toMatch(/TypeError/);
    expect(result.stderr).not.toMatch(/\[\s*"tvly-/);
  });

  it('license status reflects pre-seeded global-state.json snapshot on cold start (Bug 9)', async () => {
    // Pre-seed the persisted cache. CliStateStorage stores under
    // ~/.ptah/global-state.json with key `ptah.licenseCache`.
    // Shape is `PersistedLicenseCache` from
    // `libs/backend/vscode-core/src/services/license/license-types.ts` —
    // `{ status: LicenseStatus, persistedAt: number, lastValidatedAt: number }`.
    // `LicenseCache.loadPersistedCache()` validates the structural fields
    // (`status` + numeric `persistedAt`) and clears the entry if the shape
    // is wrong, so the snapshot must mirror the canonical envelope exactly.
    const stateFile = path.join(tmp.ptahDir, 'global-state.json');
    const now = Date.now();
    const persisted = {
      'ptah.licenseCache': {
        status: {
          valid: true,
          tier: 'pro',
          plan: { name: 'Pro' },
          expiresAt: new Date(now + 86_400_000).toISOString(),
        },
        persistedAt: now,
        lastValidatedAt: now,
      },
    };
    // tmp.writeFile writes relative to tmp.path; use absolute path via fs API.
    // The tmp helper exposes ptahDir; write directly into the .ptah directory.
    const fs = await import('node:fs/promises');
    await fs.writeFile(stateFile, JSON.stringify(persisted), 'utf8');

    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['license', 'status'],
      env: { ANTHROPIC_API_KEY: FAKE_API_KEY },
      timeoutMs: 30_000,
    });
    const note = result.stdoutLines.find(
      (l): l is { method: string; params: Record<string, unknown> } =>
        isObj(l) && l['method'] === 'license.status',
    );
    expect(note).toBeTruthy();
    // The persisted tier must surface in the notification — cold start
    // hydration proves Bug 9's fix is live. The serialized payload may
    // nest the value differently, so we scan the JSON for 'pro'.
    const haystack = JSON.stringify(note!.params).toLowerCase();
    expect(haystack).toContain('pro');
  });
});

function methodsOf(result: OneshotResult): string[] {
  return result.stdoutLines
    .filter(
      (l): l is { method: string } =>
        isObj(l) && typeof (l as { method?: unknown }).method === 'string',
    )
    .map((l) => l.method);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
