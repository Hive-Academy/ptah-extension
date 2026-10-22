import 'reflect-metadata';
import { join } from 'node:path';
import { SkillRegistryCatalogService } from './skill-registry-catalog.service';
import type { CloneEntry, UserLayerRoots } from '@ptah-extension/agent-generation';

const roots: UserLayerRoots = {
  skills: '/u/skills', agents: '/u/agents', commands: '/u/commands',
};

function clone(overrides: Partial<CloneEntry> = {}): CloneEntry {
  return {
    slug: 'deep-research', kind: 'skill', pluginId: 'ptah-core',
    sourceHash: 'sha256:abc', diverged: false, lastEnhancedAt: null,
    pendingSourceHash: null, orphaned: false, ...overrides,
  };
}

function harness() {
  const upsert = jest.fn();
  const service = new SkillRegistryCatalogService(
    { info: jest.fn() } as never,
    { upsert } as never,
    {} as never,
  );
  return { service, upsert };
}

describe('SkillRegistryCatalogService', () => {
  it('upserts plugin clone sidecars', () => {
    const { service, upsert } = harness();
    expect(service.syncFromClones([clone()], roots)).toEqual({ upserted: 1, linked: 0 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'deep-research', kind: 'skill',
      userPath: join('/u/skills', 'deep-research'),
      cloneStatus: 'clone', candidateId: null,
    }));
  });

  it('keeps authored and diverged status from sidecars', () => {
    const { service, upsert } = harness();
    service.syncFromClones([
      clone({ slug: 'mine', pluginId: null }),
      clone({ kind: 'agent', slug: 'reviewer', diverged: true }),
    ], roots);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'mine', cloneStatus: 'authored',
    }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      slug: 'reviewer', cloneStatus: 'diverged',
      userPath: join('/u/agents', 'reviewer'),
    }));
  });
});