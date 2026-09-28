/**
 * HarnessPolicySync (TASK_2026_560, C5a / N4).
 *
 * Pins the four rules: force when the fingerprint is not the acknowledged one,
 * one extra forced pass when a pass applied another fingerprint (which is what
 * a joined pass looks like), acknowledge only through
 * `isHarnessPassAcknowledged`, and a legacy `plugins:save-config` write moving
 * the fingerprint so the next session forces.
 */

import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IOutputChannel,
  IStateStorage,
} from '@ptah-extension/platform-core';
import type {
  HarnessHealth,
  HarnessSourcesStatus,
  HarnessTargetHealth,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { ExternalPluginStateStore } from '@ptah-extension/plugin-marketplace';

import { PluginLoaderService } from '../helpers/plugin-loader.service';
import type {
  HarnessPreflightRequest,
  IHarnessPreflight,
} from './harness-preflight.port';
import { HarnessPolicySync } from './harness-policy-sync';

const ROOT = path.join(os.tmpdir(), 'ptah-policy-sync-root');

function health(options: {
  fingerprint?: string;
  sources?: HarnessSourcesStatus;
  writeFailed?: boolean;
}): HarnessHealth {
  const target = {
    target: 'claude',
    detected: true,
    writeFailed: options.writeFailed
      ? [{ path: '/x/.claude/skills/a', error: 'EPERM' }]
      : [],
  } as unknown as HarnessTargetHealth;
  return {
    workspaceRoot: ROOT,
    generatedAt: '2026-09-25T00:00:00.000Z',
    mode: 'preflight',
    reason: 'session-start',
    sources: options.sources ?? 'ok',
    targets: [target],
    collisions: [],
    ...(options.fingerprint === undefined
      ? {}
      : { policyFingerprint: options.fingerprint }),
  };
}

/** A preflight answering from a queue, recording every call. */
function createPreflight(
  answer: (
    call: number,
    options: HarnessPreflightRequest | undefined,
  ) => HarnessHealth | null,
): IHarnessPreflight & { calls: Array<HarnessPreflightRequest | undefined> } {
  const calls: Array<HarnessPreflightRequest | undefined> = [];
  return {
    calls,
    ensure: async (_cwd, options) => {
      calls.push(options);
      return answer(calls.length, options);
    },
  };
}

function createOutput(): IOutputChannel & { lines: string[] } {
  const lines: string[] = [];
  return {
    name: 'test',
    lines,
    appendLine: (message: string) => {
      lines.push(message);
    },
    append: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
  };
}

describe('HarnessPolicySync', () => {
  it('acknowledges a pass that applied the fingerprint, and does not force it again', async () => {
    const preflight = createPreflight(() => health({ fingerprint: 'fp-1' }));
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: true,
    });
    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: true,
    });

    expect(preflight.calls).toEqual([{ force: true }, { force: false }]);
  });

  it('a pass that applied another fingerprint (joined or older) gets exactly one more forced pass', async () => {
    const preflight = createPreflight((call) =>
      health({ fingerprint: call === 1 ? 'fp-old' : 'fp-new' }),
    );
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await expect(sync.apply(ROOT, 'fp-new')).resolves.toEqual({
      acknowledged: true,
    });
    expect(preflight.calls).toEqual([{ force: true }, { force: true }]);
  });

  it('stops after the one extra pass even when it still mismatches', async () => {
    const preflight = createPreflight(() => health({ fingerprint: 'fp-old' }));
    const output = createOutput();
    const sync = new HarnessPolicySync(output, preflight);

    await expect(sync.apply(ROOT, 'fp-new')).resolves.toEqual({
      acknowledged: false,
    });
    expect(preflight.calls).toHaveLength(2);
    expect(output.lines.join('\n')).toContain('applied policy fp-old');
  });

  it('a pass with a write failure is not acknowledged, and the next call forces', async () => {
    const preflight = createPreflight(() =>
      health({ fingerprint: 'fp-1', writeFailed: true }),
    );
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: false,
    });
    // Matching fingerprint: no second pass for a write failure.
    expect(preflight.calls).toEqual([{ force: true }]);

    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: false,
    });
    expect(preflight.calls[1]).toEqual({ force: true });
  });

  it('a failed acknowledgement drops the previous one, so an unchanged policy forces next time', async () => {
    let failing = false;
    const preflight = createPreflight(() =>
      health({ fingerprint: 'fp-1', writeFailed: failing }),
    );
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await sync.apply(ROOT, 'fp-1');
    failing = true;
    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: false,
    });
    failing = false;
    await sync.apply(ROOT, 'fp-1');

    expect(preflight.calls).toEqual([
      { force: true },
      { force: false },
      { force: true },
    ]);
  });

  it('unreadable sources are not acknowledged', async () => {
    const preflight = createPreflight(() =>
      health({ fingerprint: 'fp-1', sources: 'policy-unknown' }),
    );
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: false,
    });
  });

  it('null (no pass ran) is not acknowledged and runs no extra pass', async () => {
    const preflight = createPreflight(() => null);
    const output = createOutput();
    const sync = new HarnessPolicySync(output, preflight);

    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: false,
    });
    expect(preflight.calls).toEqual([{ force: true }]);
    expect(output.lines.join('\n')).toContain('no pass ran');
  });

  it('null after a fingerprint change keeps forcing until a real pass acknowledges (null keeps the stale lastAck)', async () => {
    const answers: Array<HarnessHealth | null> = [
      health({ fingerprint: 'fp-1' }),
      null,
      null,
      health({ fingerprint: 'fp-2' }),
    ];
    const preflight = createPreflight((call) => answers[call - 1] ?? null);
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: true,
    });
    // The policy changed; no pass ran, twice. The old fp-1 entry stays, and it
    // can never equal fp-2, so neither null is an acknowledgement and every
    // call forces.
    await expect(sync.apply(ROOT, 'fp-2')).resolves.toEqual({
      acknowledged: false,
    });
    await expect(sync.apply(ROOT, 'fp-2')).resolves.toEqual({
      acknowledged: false,
    });
    await expect(sync.apply(ROOT, 'fp-2')).resolves.toEqual({
      acknowledged: true,
    });

    expect(preflight.calls).toEqual([
      { force: true },
      { force: true },
      { force: true },
      { force: true },
    ]);
  });

  it('null on an unchanged, acknowledged policy keeps lastAck, so the next call is not forced', async () => {
    const answers: Array<HarnessHealth | null> = [
      health({ fingerprint: 'fp-1' }),
      null,
      health({ fingerprint: 'fp-1' }),
    ];
    const preflight = createPreflight((call) => answers[call - 1] ?? null);
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await sync.apply(ROOT, 'fp-1');
    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: false,
    });
    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: true,
    });

    expect(preflight.calls).toEqual([
      { force: true },
      { force: false },
      { force: false },
    ]);
  });

  it('a host without a preflight answers unacknowledged and says so once', async () => {
    const output = createOutput();
    const sync = new HarnessPolicySync(output, null);

    await expect(sync.apply(ROOT, 'fp-1')).resolves.toEqual({
      acknowledged: false,
    });
    await sync.apply(ROOT, 'fp-1');
    expect(output.lines).toHaveLength(1);
  });

  it('keys acknowledgements per root', async () => {
    const preflight = createPreflight(() => health({ fingerprint: 'fp-1' }));
    const sync = new HarnessPolicySync(createOutput(), preflight);

    await sync.apply(ROOT, 'fp-1');
    await sync.apply(`${ROOT}-other`, 'fp-1');

    expect(preflight.calls).toEqual([{ force: true }, { force: true }]);
  });

  describe('a legacy CLI plugins:save-config write (AC-3.3)', () => {
    const created: string[] = [];
    afterEach(() => {
      for (const dir of created.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('changes the fingerprint, so the next apply forces a pass', async () => {
      const pluginsBasePath = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ptah-policy-sync-plugins-'),
      );
      created.push(pluginsBasePath);
      const raw = new Map<string, unknown>([
        [
          'ptah.plugins.config',
          { enabledPluginIds: ['ptah-core'], disabledSkillIds: [] },
        ],
      ]);
      const storage: IStateStorage = {
        get: <T>(key: string, defaultValue?: T): T | undefined =>
          (raw.get(key) as T | undefined) ?? defaultValue,
        update: async (key: string, value: unknown) => {
          raw.set(key, value);
        },
        keys: () => [...raw.keys()],
      };
      const externalStore = new ExternalPluginStateStore();
      externalStore.initialize(pluginsBasePath);
      const loader = new PluginLoaderService(
        createMockLogger() as unknown as Logger,
        externalStore,
      );
      loader.initialize(pluginsBasePath, storage);

      // The reconciler stamps whatever policy it read; model that directly.
      let current = (await loader.getEffectivePluginConfig()).fingerprint;
      const preflight = createPreflight(() => health({ fingerprint: current }));
      const sync = new HarnessPolicySync(createOutput(), preflight);

      await expect(sync.apply(ROOT, current)).resolves.toEqual({
        acknowledged: true,
      });

      // `ptah plugins save-config` passes only the two legacy lists.
      await loader.saveWorkspacePluginConfig({
        enabledPluginIds: ['ptah-core'],
        disabledSkillIds: ['orchestration'],
      });
      const next = (await loader.getEffectivePluginConfig()).fingerprint;
      expect(next).not.toBe(current);
      current = next;

      await expect(sync.apply(ROOT, next)).resolves.toEqual({
        acknowledged: true,
      });
      expect(preflight.calls).toEqual([{ force: true }, { force: true }]);
    });
  });
});
