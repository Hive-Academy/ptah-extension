/**
 * Spec for the harness skill-selection backward-compat contract.
 *
 * `selectedSkills` stays a `string[]` (every preset on disk carries that shape)
 * and origin metadata lives in the parallel optional `selectedSkillRefs`.
 * `normalizeHarnessSkillSelection` is the single reconciliation point, used by
 * both `HarnessConfigUpdatesSchema` and `HarnessConfigStore.normalizeHarnessConfig`.
 */

import {
  HarnessConfigUpdatesSchema,
  formatHarnessConfigIssue,
  normalizeHarnessSkillSelection,
} from './rpc-harness.schemas';

describe('normalizeHarnessSkillSelection', () => {
  it('passes a legacy string[] through unchanged with no refs', () => {
    expect(normalizeHarnessSkillSelection(['a', 'b'], undefined)).toEqual({
      selectedSkills: ['a', 'b'],
      selectedSkillRefs: [],
    });
  });

  it('handles a fully absent selection', () => {
    expect(normalizeHarnessSkillSelection(undefined, undefined)).toEqual({
      selectedSkills: [],
      selectedSkillRefs: [],
    });
  });

  it('splits refs inlined into selectedSkills into ids plus refs', () => {
    expect(
      normalizeHarnessSkillSelection(
        [
          'local-one',
          {
            skillId: 'frontend-design',
            source: 'skills.sh',
            installSource: 'anthropics/skills',
          },
        ],
        undefined,
      ),
    ).toEqual({
      selectedSkills: ['local-one', 'frontend-design'],
      selectedSkillRefs: [
        {
          skillId: 'frontend-design',
          source: 'skills.sh',
          installSource: 'anthropics/skills',
        },
      ],
    });
  });

  it('treats a ref-only entry as a selection', () => {
    expect(
      normalizeHarnessSkillSelection(undefined, [
        { skillId: 'x', source: 'skills.sh', installSource: 'o/r' },
      ]),
    ).toEqual({
      selectedSkills: ['x'],
      selectedSkillRefs: [
        { skillId: 'x', source: 'skills.sh', installSource: 'o/r' },
      ],
    });
  });

  it('infers source from the presence of installSource', () => {
    const { selectedSkillRefs } = normalizeHarnessSkillSelection(undefined, [
      { skillId: 'remote', installSource: 'o/r' },
      { skillId: 'plain' },
    ]);
    expect(selectedSkillRefs).toEqual([
      { skillId: 'remote', source: 'skills.sh', installSource: 'o/r' },
      { skillId: 'plain', source: 'local' },
    ]);
  });

  it('dedupes ids and lets an explicit ref win over an inlined one', () => {
    const { selectedSkills, selectedSkillRefs } =
      normalizeHarnessSkillSelection(
        ['dup', { skillId: 'dup', source: 'local' }],
        [{ skillId: 'dup', source: 'skills.sh', installSource: 'o/r' }],
      );
    expect(selectedSkills).toEqual(['dup']);
    expect(selectedSkillRefs).toEqual([
      { skillId: 'dup', source: 'skills.sh', installSource: 'o/r' },
    ]);
  });
});

describe('HarnessConfigUpdatesSchema — skills', () => {
  it('accepts the legacy string[] shape', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      skills: { selectedSkills: ['tribunal'] },
    });
    expect(parsed.skills).toMatchObject({
      selectedSkills: ['tribunal'],
      selectedSkillRefs: [],
    });
  });

  it('normalizes refs the agent inlined into selectedSkills', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      skills: {
        selectedSkills: [
          { skillId: 'frontend-design', installSource: 'anthropics/skills' },
        ],
      },
    });
    expect(parsed.skills).toMatchObject({
      selectedSkills: ['frontend-design'],
      selectedSkillRefs: [
        {
          skillId: 'frontend-design',
          source: 'skills.sh',
          installSource: 'anthropics/skills',
        },
      ],
    });
  });

  it('leaves the selection untouched when only createdSkills is updated', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      skills: {
        createdSkills: [{ name: 'a', description: 'A skill', content: '# A' }],
      },
    });
    expect(parsed.skills?.selectedSkills).toBeUndefined();
    expect(parsed.skills?.selectedSkillRefs).toBeUndefined();
  });

  it('rejects a non-object entry in selectedSkills', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        skills: { selectedSkills: [42] },
      }).success,
    ).toBe(false);
  });
});

/**
 * The four record fields an authoring agent kept sending as lists. Measured
 * 2026-09-21: one harness build was rejected on `mcp.enabledTools`,
 * `agents.enabledAgents`, then `prompt.enhancedSections` and
 * `claudeMd.customSections` together, and the run that finally parsed had lost
 * its agents. A list that carries its own keys is folded; a list that does not
 * is still refused, because keying it would invent the user's configuration.
 */
describe('HarnessConfigUpdatesSchema — record fields sent as lists', () => {
  it('keys a bare agent-id list by id and enables each one', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      agents: { enabledAgents: ['catalog-reviewer', 'listing-author'] },
    });
    expect(parsed.agents?.enabledAgents).toEqual({
      'catalog-reviewer': { enabled: true },
      'listing-author': { enabled: true },
    });
  });

  it('keys an agent-object list by agentId and keeps the override', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      agents: {
        enabledAgents: [
          { agentId: 'catalog-reviewer', modelTier: 'opus' },
          { agentId: 'retired', enabled: false },
        ],
      },
    });
    expect(parsed.agents?.enabledAgents).toEqual({
      'catalog-reviewer': { enabled: true, modelTier: 'opus' },
      retired: { enabled: false },
    });
  });

  it('keys an enabledTools list by server name', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      mcp: {
        enabledTools: [
          { name: 'firecrawl', tools: ['firecrawl_scrape'] },
          { server: 'shopify-dev-mcp', tools: [] },
        ],
      },
    });
    expect(parsed.mcp?.enabledTools).toEqual({
      firecrawl: ['firecrawl_scrape'],
      'shopify-dev-mcp': [],
    });
  });

  it('keys section lists by title on both prompt and claudeMd', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      prompt: {
        enhancedSections: [{ title: 'Safety', content: 'Drafts by default.' }],
      },
      claudeMd: {
        customSections: [{ heading: 'Catalog', body: 'GraphQL only.' }],
      },
    });
    expect(parsed.prompt?.enhancedSections).toEqual({
      Safety: 'Drafts by default.',
    });
    expect(parsed.claudeMd?.customSections).toEqual({
      Catalog: 'GraphQL only.',
    });
  });

  it('still accepts the record shape unchanged', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      mcp: { enabledTools: { firecrawl: ['firecrawl_scrape'] } },
    });
    expect(parsed.mcp?.enabledTools).toEqual({
      firecrawl: ['firecrawl_scrape'],
    });
  });

  it('refuses a keyless list rather than inventing a key', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        mcp: { enabledTools: ['firecrawl_scrape', 'firecrawl_crawl'] },
      }).success,
    ).toBe(false);
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        claudeMd: { customSections: ['Safety rules'] },
      }).success,
    ).toBe(false);
  });

  it('names the wanted shape in the message for a refused record field', () => {
    const result = HarnessConfigUpdatesSchema.safeParse({
      mcp: { enabledTools: ['firecrawl_scrape'] },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(
      formatHarnessConfigIssue(issue.path.join('.'), issue.message),
    ).toContain('{"<server-name>": ["<tool-name>"]}');
  });

  it('normalizes an empty list to an empty record for every record field', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      agents: { enabledAgents: [] },
      mcp: { enabledTools: [] },
      prompt: { enhancedSections: [] },
      claudeMd: { customSections: [] },
    });
    expect(parsed.agents?.enabledAgents).toEqual({});
    expect(parsed.mcp?.enabledTools).toEqual({});
    expect(parsed.prompt?.enhancedSections).toEqual({});
    expect(parsed.claudeMd?.customSections).toEqual({});
  });

  it('trims the key it takes from a list entry', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      agents: { enabledAgents: ['  catalog-reviewer  '] },
      mcp: { enabledTools: [{ name: '  firecrawl  ', tools: [] }] },
    });
    expect(parsed.agents?.enabledAgents).toEqual({
      'catalog-reviewer': { enabled: true },
    });
    expect(parsed.mcp?.enabledTools).toEqual({ firecrawl: [] });
  });

  it('refuses a blank agent id instead of dropping it', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        agents: { enabledAgents: ['   '] },
      }).success,
    ).toBe(false);
  });

  it('refuses two list entries whose trimmed keys collide instead of overwriting', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        mcp: {
          enabledTools: [
            { name: 'srv', tools: ['a'] },
            { name: ' srv ', tools: ['b'] },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects "no" instead of silently enabling the entry', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        agents: { enabledAgents: [{ agentId: 'reviewer', enabled: 'no' }] },
      }).success,
    ).toBe(false);
  });

  it('reads an enabled flag the agent wrote as a string or a number', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      agents: {
        enabledAgents: [
          { agentId: 'stringly', enabled: 'false' },
          { agentId: 'numerically', enabled: 0 },
          { agentId: 'truthy', enabled: 'true' },
        ],
      },
    });
    expect(parsed.agents?.enabledAgents).toEqual({
      stringly: { enabled: false },
      numerically: { enabled: false },
      truthy: { enabled: true },
    });
  });

  it('refuses a key that cannot survive a plain object', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        mcp: { enabledTools: [{ name: '__proto__', tools: ['a'] }] },
      }).success,
    ).toBe(false);
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        agents: { enabledAgents: ['__proto__'] },
      }).success,
    ).toBe(false);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it('refuses a mixed string-and-object agent list', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        agents: { enabledAgents: ['a', { agentId: 'b' }] },
      }).success,
    ).toBe(false);
  });

  it('refuses a list entry whose value field is the wrong type', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        mcp: { enabledTools: [{ name: 'srv', tools: 'not-an-array' }] },
      }).success,
    ).toBe(false);
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        prompt: { enhancedSections: [{ title: 'T', content: 123 }] },
      }).success,
    ).toBe(false);
  });
});

/**
 * The element contract. Validating a list container and not its elements let a
 * malformed entry reach Apply, where it threw or wrote an empty file. Each
 * case below is a shape an authoring agent actually reaches for.
 */
describe('HarnessConfigUpdatesSchema — list element shapes', () => {
  const subagent = {
    id: 'catalog-reviewer',
    name: 'Catalog reviewer',
    description: 'Reviews listings',
    role: 'reviewer',
    tools: ['Read'],
    executionMode: 'on-demand' as const,
    instructions: 'Review before publication.',
  };

  it('accepts a complete subagent', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      agents: { harnessSubagents: [subagent] },
    });
    expect(parsed.agents?.harnessSubagents).toEqual([subagent]);
  });

  it('refuses a subagent whose tools is a comma-joined string', () => {
    const result = HarnessConfigUpdatesSchema.safeParse({
      agents: {
        harnessSubagents: [{ ...subagent, tools: 'Read,Glob' }],
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues[0];
    expect(
      formatHarnessConfigIssue(issue.path.join('.'), issue.message),
    ).toContain('not a comma-joined string');
  });

  it('refuses a created skill that carries instructions instead of content', () => {
    const result = HarnessConfigUpdatesSchema.safeParse({
      skills: {
        createdSkills: [
          { name: 'review', description: 'Review', instructions: 'Inspect' },
        ],
      },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('skills.createdSkills.0.content');
  });

  it('defaults an MCP server entry to enabled', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      mcp: {
        servers: [
          {
            name: 'firecrawl',
            url: 'https://example.test/mcp',
            config: { type: 'http', url: 'https://example.test/mcp' },
          },
        ],
      },
    });
    expect(parsed.mcp?.servers?.[0]).toMatchObject({ enabled: true });
  });

  it('refuses a transport config whose env is not a string map', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        mcp: {
          servers: [
            {
              name: 'demo',
              url: '',
              config: { type: 'stdio', command: 'npx', env: { PORT: 3000 } },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('refuses an agent override whose value is a bare boolean', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({
        agents: { enabledAgents: { reviewer: true } },
      }).success,
    ).toBe(false);
  });
});

/**
 * The tool description has always promised that an unknown key is rejected and
 * the error names its path. The schema stripped them instead, so a misspelled
 * key parsed to `{}`, broadcast an empty update and returned success.
 */
describe('HarnessConfigUpdatesSchema — unknown keys', () => {
  it('reports an unknown key inside a section instead of stripping it', () => {
    const result = HarnessConfigUpdatesSchema.safeParse({
      prompt: { instructions: 'Require review before deployment.' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path.join('.')).toContain('prompt');
  });

  it('reports an unknown top-level key', () => {
    expect(
      HarnessConfigUpdatesSchema.safeParse({ systemPrompt: 'hello' }).success,
    ).toBe(false);
  });

  it('formats a root-level issue without a leading empty-path separator', () => {
    expect(formatHarnessConfigIssue('', 'Unrecognized key(s)')).toBe(
      'Unrecognized key(s)',
    );
  });

  it('still strips the retired skill-ref scope key', () => {
    const parsed = HarnessConfigUpdatesSchema.parse({
      skills: {
        selectedSkillRefs: [{ skillId: 'review', scope: 'workspace' }],
      },
    });
    expect(parsed.skills?.selectedSkillRefs).toEqual([
      { skillId: 'review', source: 'local' },
    ]);
  });
});
