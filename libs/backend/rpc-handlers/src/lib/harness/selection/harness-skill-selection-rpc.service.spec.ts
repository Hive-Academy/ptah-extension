/**
 * `HarnessSkillSelectionRpcService` — `harness:get-skill-selection` and
 * `harness:set-skill-selection` (TASK_2026_316 Batch 3).
 *
 * The two rules worth pinning are the ones the class comment states as rules
 * rather than incidental behaviour: `get` never writes `state.json` even when
 * it has to derive the answer, and `set` takes the `skipUserLayerRefresh`
 * exception the same way `plugins:save-config` does. Both are asserted against
 * a real `SkillSyncGate` over a temp workspace, not a mock call count, because
 * the class comment's own reasoning — "a derived decision is a write" — is a
 * disk fact, not a wiring fact.
 */

import 'reflect-metadata';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RpcHandler, type Logger } from '@ptah-extension/vscode-core';
import {
  ManagedManifestStore,
  SkillSyncGate,
  harnessStatePath,
  resolveHarnessWorkspaceRoot,
  type HarnessPropagationService,
  type HarnessSourceState,
  type IHarnessSourceResolver,
} from '@ptah-extension/harness-sync';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { HarnessSetSkillSelectionParams } from '@ptah-extension/shared';
import { HarnessSkillSelectionRpcService } from './harness-skill-selection-rpc.service';

/**
 * A temp workspace with its OWN `.git` marker, so
 * `resolveHarnessWorkspaceRoot` resolves to it at depth zero — no ancestor
 * walk, and nothing under the real home directory is ever touched or written.
 */
function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'ptah-skill-selection-ws-'));
  mkdirSync(join(root, '.git'));
  return root;
}

function fakeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function workspaceProviderFor(root: string | undefined): IWorkspaceProvider {
  return { getWorkspaceRoot: () => root } as unknown as IWorkspaceProvider;
}

/** A source resolver whose catalog is deliberately empty — an absent skills root. */
function emptySourceResolver(): IHarnessSourceResolver {
  return {
    resolve: (): HarnessSourceState => ({
      layout: {
        skillsRoot: join(tmpdir(), 'ptah-skill-selection-absent-root'),
        commandsRoot: '',
        agentsRoot: '',
      },
      overlayPluginPaths: [],
      disabledSkillIds: [],
      disabledPluginIds: [],
    }),
  };
}

function writeSkillMd(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`,
  );
}

const dirsToClean: string[] = [];
function track(dir: string): string {
  dirsToClean.push(dir);
  return dir;
}

afterEach(() => {
  while (dirsToClean.length > 0) {
    const dir = dirsToClean.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('HarnessSkillSelectionRpcService', () => {
  describe('harness:get-skill-selection', () => {
    it('never writes state.json — a derived decision is not a write', () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const gate = new SkillSyncGate(new ManagedManifestStore());
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        emptySourceResolver(),
        { propagate: jest.fn() } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );
      const statePath = harnessStatePath(root);
      expect(existsSync(statePath)).toBe(false);

      const result = service.getSelection();

      // The mode had to be DERIVED (no manifests exist for a fresh workspace,
      // so `SkillSyncGate.resolve` falls back to 'selected' with no slugs) —
      // exactly the case the class comment calls out as the one a poll must
      // not be able to persist.
      expect(result.derived).toBe(true);
      expect(result.mode).toBe('selected');
      expect(existsSync(statePath)).toBe(false);
    });

    it('still reports nothing written when a prior selection already exists on disk', () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const gate = new SkillSyncGate(new ManagedManifestStore());
      gate.select(root, ['already-chosen']);
      const before = readFileSync(harnessStatePath(root), 'utf-8');

      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        emptySourceResolver(),
        { propagate: jest.fn() } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );

      const result = service.getSelection();

      expect(result.mode).toBe('selected');
      expect(result.slugs).toEqual(['already-chosen']);
      expect(readFileSync(harnessStatePath(root), 'utf-8')).toBe(before);
    });
  });

  describe('harness:set-skill-selection', () => {
    it('propagates with skipUserLayerRefresh — the second documented exception to the user-layer refresh', async () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const gate = new SkillSyncGate(new ManagedManifestStore());
      const propagate = jest.fn().mockResolvedValue(null);
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        emptySourceResolver(),
        { propagate } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );

      await service.setSelection({ mode: 'all' });

      // Not a bare `reconcile`, and not `propagate` without the flag — a
      // `propagate` call missing this third argument is the regression this
      // pins, because it would refresh the user layer for a change that never
      // touched a source's contents.
      expect(propagate).toHaveBeenCalledWith(
        root,
        'harness:set-skill-selection',
        { skipUserLayerRefresh: true },
      );
    });

    it("clears the allowlist under mode: 'all' rather than leaving a stale one behind", async () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const gate = new SkillSyncGate(new ManagedManifestStore());
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        emptySourceResolver(),
        {
          propagate: jest.fn().mockResolvedValue(null),
        } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );

      await service.setSelection({
        mode: 'selected',
        slugs: ['alpha', 'beta'],
      });
      const selected = JSON.parse(
        readFileSync(harnessStatePath(root), 'utf-8'),
      );
      expect(selected.enabledSkillSlugs).toEqual(['alpha', 'beta']);

      const result = await service.setSelection({ mode: 'all' });

      const state = JSON.parse(readFileSync(harnessStatePath(root), 'utf-8'));
      expect(state.skillSyncMode).toBe('all');
      expect(state.enabledSkillSlugs).toBeUndefined();
      expect(result.mode).toBe('all');
      expect(result.slugs).toEqual([]);
    });

    it("records exactly the given slugs, trimmed/deduplicated/sorted, under mode: 'selected'", async () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const gate = new SkillSyncGate(new ManagedManifestStore());
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        emptySourceResolver(),
        {
          propagate: jest.fn().mockResolvedValue(null),
        } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );

      const result = await service.setSelection({
        mode: 'selected',
        slugs: [' beta ', 'alpha', 'alpha', '  ', 'alpha'],
      });

      expect(result.mode).toBe('selected');
      expect(result.slugs).toEqual(['alpha', 'beta']);
      const state = JSON.parse(readFileSync(harnessStatePath(root), 'utf-8'));
      expect(state.enabledSkillSlugs).toEqual(['alpha', 'beta']);
    });

    it('short-circuits before the propagate pass when the write fails — the OLD selection is still on disk', async () => {
      const propagate = jest.fn().mockResolvedValue(null);
      // A mocked gate: forcing a real atomic-write failure portably is not
      // practical, and this case is entirely about what the SERVICE does with
      // a `false` result, not about what makes a write fail.
      const gate = {
        resolve: jest.fn().mockReturnValue({
          mode: 'selected',
          slugs: ['kept-from-before'],
          derived: false,
        }),
        select: jest.fn().mockReturnValue(false),
        enableAll: jest.fn().mockReturnValue(false),
      } as unknown as SkillSyncGate;
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        emptySourceResolver(),
        { propagate } as unknown as HarnessPropagationService,
        workspaceProviderFor('D:/ws/does-not-exist-blocked'),
      );

      const result = await service.setSelection({
        mode: 'selected',
        slugs: ['attempted'],
      });

      expect(propagate).not.toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          saved: false,
          mode: 'selected',
          slugs: ['kept-from-before'],
          health: null,
        }),
      );
    });
  });

  describe('the prefix guard', () => {
    it('both methods register through the already-allowed `harness:` prefix', async () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const gate = new SkillSyncGate(new ManagedManifestStore());
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        emptySourceResolver(),
        {
          propagate: jest.fn().mockResolvedValue(null),
        } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );
      // Third arg is the optional ITracer used for the slow-handler breadcrumb
      // (TASK_2026_323); this spec only exercises method registration.
      const rpcHandler = new RpcHandler(fakeLogger(), undefined, undefined);

      expect(() => {
        rpcHandler.registerMethod('harness:get-skill-selection', async () =>
          service.getSelection(),
        );
        rpcHandler.registerMethod(
          'harness:set-skill-selection',
          async (params) =>
            service.setSelection(params as HarnessSetSkillSelectionParams),
        );
      }).not.toThrow();

      const getResponse = await rpcHandler.handleMessage({
        method: 'harness:get-skill-selection',
        params: {},
        correlationId: 'get-1',
      });
      expect(getResponse.success).toBe(true);

      const setResponse = await rpcHandler.handleMessage({
        method: 'harness:set-skill-selection',
        params: { mode: 'all' },
        correlationId: 'set-1',
      });
      expect(setResponse.success).toBe(true);
    });
  });

  describe('`available`', () => {
    it('includes an overlay-only slug — dropping it would let the first `selected` save reap it silently', () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const skillsRoot = track(
        mkdtempSync(join(tmpdir(), 'ptah-skill-selection-user-')),
      );
      const pluginRoot = track(
        mkdtempSync(join(tmpdir(), 'ptah-skill-selection-overlay-')),
      );
      const pluginDir = join(pluginRoot, 'ptah-harness-demo');
      writeSkillMd(
        join(pluginDir, 'skills', 'overlay-only-skill'),
        'Overlay Only',
        'Lives only in the overlay; no bundled plugin sits above it.',
      );
      const gate = new SkillSyncGate(new ManagedManifestStore());
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        {
          resolve: (): HarnessSourceState => ({
            layout: {
              skillsRoot,
              commandsRoot: skillsRoot,
              agentsRoot: skillsRoot,
            },
            overlayPluginPaths: [pluginDir],
            disabledSkillIds: [],
            disabledPluginIds: [],
          }),
        },
        { propagate: jest.fn() } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );

      const result = service.getSelection();

      const candidate = result.available.find(
        (c) => c.slug === 'overlay-only-skill',
      );
      expect(candidate).toBeDefined();
      expect(candidate?.pluginId).toBe('ptah-harness-demo');
    });

    it('reports a null pluginId for a user-authored (or synth) skill without treating it as an error', () => {
      const root = resolveHarnessWorkspaceRoot(track(makeWorkspace()));
      const skillsRoot = track(
        mkdtempSync(join(tmpdir(), 'ptah-skill-selection-user-')),
      );
      writeSkillMd(
        join(skillsRoot, 'hand-authored-skill'),
        'Hand Authored',
        'No plugin above this one — no .ptah-origin.json sidecar at all.',
      );
      const gate = new SkillSyncGate(new ManagedManifestStore());
      const service = new HarnessSkillSelectionRpcService(
        fakeLogger(),
        gate,
        {
          resolve: (): HarnessSourceState => ({
            layout: {
              skillsRoot,
              commandsRoot: skillsRoot,
              agentsRoot: skillsRoot,
            },
            overlayPluginPaths: [],
            disabledSkillIds: [],
            disabledPluginIds: [],
          }),
        },
        { propagate: jest.fn() } as unknown as HarnessPropagationService,
        workspaceProviderFor(root),
      );

      const result = service.getSelection();

      const candidate = result.available.find(
        (c) => c.slug === 'hand-authored-skill',
      );
      expect(candidate).toBeDefined();
      expect(candidate?.pluginId).toBeNull();
    });
  });
});
