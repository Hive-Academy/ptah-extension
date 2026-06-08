import 'reflect-metadata';
import { join } from 'node:path';
import { SkillRegistryCatalogService } from './skill-registry-catalog.service';
import type { SkillRegistryStore } from './skill-registry.store';
import type { SkillCandidateStore } from './skill-candidate.store';
import type {
  CloneEntry,
  UserLayerMirrorService,
  UserLayerRoots,
} from '@ptah-extension/agent-generation';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const roots: UserLayerRoots = {
  skills: '/u/skills',
  agents: '/u/agents',
  commands: '/u/commands',
};

interface Harness {
  service: SkillRegistryCatalogService;
  upsert: jest.Mock;
  findByName: jest.Mock;
}

function makeHarness(
  findByNameImpl: (name: string) => unknown = () => null,
): Harness {
  const upsert = jest.fn();
  const findByName = jest.fn(findByNameImpl);
  const registry = { upsert } as unknown as SkillRegistryStore;
  const candidates = { findByName } as unknown as SkillCandidateStore;
  const mirror = {} as unknown as UserLayerMirrorService;
  const service = new SkillRegistryCatalogService(
    noopLogger as never,
    registry,
    candidates,
    mirror,
  );
  return { service, upsert, findByName };
}

function clone(overrides: Partial<CloneEntry> = {}): CloneEntry {
  return {
    slug: 'deep-research',
    kind: 'skill',
    pluginId: 'ptah-core',
    sourceHash: 'sha256:abc',
    diverged: false,
    lastEnhancedAt: null,
    ...overrides,
  };
}

describe('SkillRegistryCatalogService.syncFromClones', () => {
  it('maps a plugin clone to a clone_status row with origin + user_path', () => {
    const { service, upsert } = makeHarness();
    const result = service.syncFromClones([clone()], roots);
    expect(result.upserted).toBe(1);
    expect(result.linked).toBe(0);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'deep-research',
        kind: 'skill',
        userPath: join('/u/skills', 'deep-research'),
        originPluginId: 'ptah-core',
        sourceHash: 'sha256:abc',
        cloneStatus: 'clone',
        diverged: false,
        candidateId: null,
      }),
    );
  });

  it('links a synth skill to its candidate and sets clone_status synth', () => {
    const { service, upsert, findByName } = makeHarness((name) =>
      name === 'my-synth' ? { id: 'cand_42' } : null,
    );
    const result = service.syncFromClones(
      [clone({ slug: 'my-synth', pluginId: null })],
      roots,
    );
    expect(findByName).toHaveBeenCalledWith('my-synth');
    expect(result.linked).toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'my-synth',
        cloneStatus: 'synth',
        candidateId: 'cand_42',
      }),
    );
  });

  it('maps a non-plugin non-synth clone to authored', () => {
    const { service, upsert } = makeHarness();
    service.syncFromClones([clone({ slug: 'mine', pluginId: null })], roots);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'mine', cloneStatus: 'authored' }),
    );
  });

  it('passes diverged through and forces clone_status diverged', () => {
    const { service, upsert } = makeHarness();
    service.syncFromClones([clone({ diverged: true })], roots);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ diverged: true, cloneStatus: 'diverged' }),
    );
  });

  it('does not look up candidates for agent/command kinds', () => {
    const { service, upsert, findByName } = makeHarness();
    service.syncFromClones(
      [
        clone({ kind: 'agent', slug: 'reviewer', pluginId: null }),
        clone({ kind: 'command', slug: 'ship', pluginId: 'ptah-core' }),
      ],
      roots,
    );
    expect(findByName).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agent',
        userPath: join('/u/agents', 'reviewer'),
        cloneStatus: 'authored',
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'command',
        userPath: join('/u/commands', 'ship'),
        cloneStatus: 'clone',
      }),
    );
  });
});
