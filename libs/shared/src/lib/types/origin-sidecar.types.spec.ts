import {
  SKILLS_SH_OWNER_MARKER,
  SKILLS_SH_RETIRED_FILE,
  SKILLS_SH_SOURCE_REF_PREFIX,
  isRetiredSkillsShRoot,
  isRetiredSourceRef,
  parseOriginSidecar,
  parseSkillsShRetiredRegistry,
} from './origin-sidecar.types';
import {
  HARNESS_RETIRED_KEPT_REASONS,
  harnessPathIdentity,
  mcpRetiredItemId,
  skillsShRetiredItemId,
} from './harness-sync.types';

/** A sidecar as written before `sourceRef`/`sourceLabel` existed. */
const legacySidecar = {
  kind: 'agent',
  slug: 'reviewer',
  pluginId: 'toolkit',
  version: '2.1.0',
  sourceHash: 'abc',
  clonedAt: 1,
  diverged: false,
  lastEnhancedAt: null,
  historyDir: '.history',
};

describe('parseOriginSidecar', () => {
  it('parses a sidecar written before the source identity fields', () => {
    const parsed = parseOriginSidecar(legacySidecar);
    expect(parsed).not.toBeNull();
    expect(parsed?.sourceRef).toBeUndefined();
    expect(parsed?.sourceLabel).toBeUndefined();
    expect(parsed?.pluginId).toBe('toolkit');
  });

  it('keeps sourceRef and sourceLabel when present', () => {
    const parsed = parseOriginSidecar({
      ...legacySidecar,
      sourceRef: 'external:acme/toolkit/toolkit',
      sourceLabel: 'Acme Toolkit',
    });
    expect(parsed?.sourceRef).toBe('external:acme/toolkit/toolkit');
    expect(parsed?.sourceLabel).toBe('Acme Toolkit');
  });

  it('rejects a non-string sourceRef as no sidecar', () => {
    expect(parseOriginSidecar({ ...legacySidecar, sourceRef: 42 })).toBeNull();
  });
});

describe('retired skills.sh registry', () => {
  it('spells the registry file and owner marker exactly', () => {
    expect(SKILLS_SH_RETIRED_FILE).toBe('.ptah-skillssh-retired.json');
    expect(SKILLS_SH_OWNER_MARKER).toBe('ptah.skills-sh.root.v2');
    expect(SKILLS_SH_SOURCE_REF_PREFIX).toBe('skills-sh:');
  });

  const registry = parseSkillsShRetiredRegistry({
    version: 1,
    roots: {
      'ptah-skillssh-anthropics-skills': {
        retiredAt: '2026-10-30T00:00:00.000Z',
      },
    },
  });

  it('parses a v1 registry', () => {
    expect(registry).not.toBeNull();
    expect(Object.keys(registry?.roots ?? {})).toEqual([
      'ptah-skillssh-anthropics-skills',
    ]);
  });

  it('rejects an unknown version or a malformed root as no registry', () => {
    expect(parseSkillsShRetiredRegistry({ version: 2, roots: {} })).toBeNull();
    expect(
      parseSkillsShRetiredRegistry({ version: 1, roots: { a: {} } }),
    ).toBeNull();
    expect(parseSkillsShRetiredRegistry(null)).toBeNull();
  });

  it('matches only a skills-sh sourceRef whose root is listed', () => {
    expect(
      isRetiredSourceRef('skills-sh:ptah-skillssh-anthropics-skills', registry),
    ).toBe(true);
    expect(isRetiredSourceRef('skills-sh:ptah-skillssh-other', registry)).toBe(
      false,
    );
    expect(
      isRetiredSourceRef('harness:ptah-skillssh-anthropics-skills', registry),
    ).toBe(false);
    expect(isRetiredSourceRef('skills-sh:', registry)).toBe(false);
    expect(isRetiredSourceRef(undefined, registry)).toBe(false);
    expect(
      isRetiredSourceRef('skills-sh:ptah-skillssh-anthropics-skills', null),
    ).toBe(false);
  });

  it('never matches through the prototype chain', () => {
    expect(isRetiredSkillsShRoot('constructor', registry)).toBe(false);
    expect(isRetiredSourceRef('skills-sh:__proto__', registry)).toBe(false);
  });
});

describe('retired path identity (harness-sync.types)', () => {
  it('joins a workspace path onto one normalized root', () => {
    expect(harnessPathIdentity('/ws/app', '.claude/skills/pdf')).toBe(
      '/ws/app/.claude/skills/pdf',
    );
    expect(harnessPathIdentity('/ws/app/', '.mcp.json#github')).toBe(
      '/ws/app/.mcp.json#github',
    );
    expect(harnessPathIdentity('C:\\ws\\app\\', '.vscode\\mcp.json#x')).toBe(
      'C:/ws/app/.vscode/mcp.json#x',
    );
  });

  it('keeps a home-config path workspace-independent', () => {
    expect(harnessPathIdentity('/ws/a', '~/.codex/config.toml#x')).toBe(
      harnessPathIdentity('/ws/b', '~/.codex/config.toml#x'),
    );
  });

  it('builds item ids that equal the sidecar sourceRef for skills.sh', () => {
    expect(skillsShRetiredItemId('ptah-skillssh-acme')).toBe(
      `${SKILLS_SH_SOURCE_REF_PREFIX}ptah-skillssh-acme`,
    );
    expect(mcpRetiredItemId('context7')).toBe('mcp:context7');
    expect(HARNESS_RETIRED_KEPT_REASONS).toEqual([
      'edited',
      'git-tracked',
      'unverifiable',
    ]);
  });
});
