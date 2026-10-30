/**
 * `SkillSyncGate`'s migration rule for a workspace with no recorded mode
 * (TASK_2026_853 #17, D-D4): derive `'selected'` with exactly the skill slugs
 * the workspace already owns, never `'all'`. A recorded mode is never changed.
 *
 * Unit level: real `ManagedManifestStore` and `HarnessStateStore` over a temp
 * workspace. The reconcile-level behaviour is covered by
 * `harness-reconciler.skill-consent.spec.ts`.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HarnessStateStore } from '../gitignore/harness-state-store';
import {
  managedEntry,
  ManagedManifestStore,
} from '../manifest-store/managed-manifest';
import { SkillSyncGate } from './skill-sync-gate';

describe('SkillSyncGate', () => {
  let ws: string;
  let manifests: ManagedManifestStore;
  let state: HarnessStateStore;
  let gate: SkillSyncGate;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'skill-sync-gate-ws-'));
    manifests = new ManagedManifestStore();
    state = new HarnessStateStore();
    gate = new SkillSyncGate(manifests, state);
  });

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true });
  });

  describe('resolve() for an undecided workspace', () => {
    it('derives `selected` with exactly the skill slugs the manifests own, deduplicated across targets and sorted', () => {
      manifests.save(ws, 'claude', {
        '.claude/skills/zeta': managedEntry('h1', '/src/zeta', 'skill'),
        '.claude/skills/alpha': managedEntry('h2', '/src/alpha', 'skill'),
        '.claude/commands/run.md': managedEntry('h3', '/src/run', 'command'),
      });
      manifests.save(ws, 'codex', {
        '.agents/skills/alpha': managedEntry('h4', '/src/alpha', 'skill'),
        '.codex/agents/helper.toml': managedEntry('h5', '/src/h', 'agent'),
      });

      expect(gate.resolve(ws)).toEqual({
        mode: 'selected',
        slugs: ['alpha', 'zeta'],
        derived: true,
      });
    });

    it('reads every HARNESS_TARGET_IDS manifest, including a target the host may not register', () => {
      manifests.save(ws, 'vscode', {
        '.vscode/skills/legacy-skill': managedEntry('h', '/legacy', 'skill'),
      });

      expect(gate.resolve(ws)).toEqual({
        mode: 'selected',
        slugs: ['legacy-skill'],
        derived: true,
      });
    });

    it('derives `selected` with `[]` when no manifest owns a skill', () => {
      manifests.save(ws, 'cursor', {
        '.cursor/mcp.json#server': managedEntry('h', '', 'mcp'),
      });

      expect(gate.resolve(ws)).toEqual({
        mode: 'selected',
        slugs: [],
        derived: true,
      });
    });

    it('derives `selected` with `[]` for a workspace with no manifests at all', () => {
      expect(gate.resolve(ws)).toEqual({
        mode: 'selected',
        slugs: [],
        derived: true,
      });
    });

    it('never derives `all`, and persist() records the derived allowlist', () => {
      manifests.save(ws, 'claude', {
        '.claude/skills/owned': managedEntry('h', '/src/owned', 'skill'),
      });

      const decision = gate.resolve(ws);
      expect(decision.mode).toBe('selected');
      expect(gate.persist(ws, decision)).toBe(true);

      const saved = state.load(ws);
      expect(saved.skillSyncMode).toBe('selected');
      expect(saved.enabledSkillSlugs).toEqual(['owned']);
      // Recorded now: the evidence walk does not run again, so an emptied
      // manifest cannot change the answer.
      manifests.save(ws, 'claude', {});
      expect(gate.resolve(ws)).toEqual({
        mode: 'selected',
        slugs: ['owned'],
        derived: false,
      });
    });
  });

  describe('a recorded mode is kept', () => {
    it('a recorded `all` stays `all` even when manifests own skills', () => {
      state.save(ws, { version: 1, skillSyncMode: 'all' });
      manifests.save(ws, 'claude', {
        '.claude/skills/owned': managedEntry('h', '/src/owned', 'skill'),
      });

      expect(gate.resolve(ws)).toEqual({
        mode: 'all',
        slugs: [],
        derived: false,
      });
      expect(gate.persist(ws, { mode: 'selected', slugs: ['owned'] })).toBe(
        true,
      );
      expect(state.load(ws).skillSyncMode).toBe('all');
      expect(state.load(ws).enabledSkillSlugs).toBeUndefined();
    });

    it('a recorded `selected` keeps its own slugs, not the owned ones', () => {
      state.save(ws, {
        version: 1,
        skillSyncMode: 'selected',
        enabledSkillSlugs: ['chosen'],
      });
      manifests.save(ws, 'claude', {
        '.claude/skills/owned': managedEntry('h', '/src/owned', 'skill'),
      });

      expect(gate.resolve(ws)).toEqual({
        mode: 'selected',
        slugs: ['chosen'],
        derived: false,
      });
      expect(gate.persist(ws, { mode: 'all', slugs: [] })).toBe(true);
      expect(state.load(ws).enabledSkillSlugs).toEqual(['chosen']);
    });

    it('a recorded `selected` with `[]` stays empty', () => {
      state.save(ws, {
        version: 1,
        skillSyncMode: 'selected',
        enabledSkillSlugs: [],
      });
      manifests.save(ws, 'claude', {
        '.claude/skills/owned': managedEntry('h', '/src/owned', 'skill'),
      });

      expect(gate.resolve(ws)).toEqual({
        mode: 'selected',
        slugs: [],
        derived: false,
      });
    });
  });
});
