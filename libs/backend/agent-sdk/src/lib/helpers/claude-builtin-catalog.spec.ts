import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  CLAUDE_BUILTIN_SETTING_KEYS,
  CLAUDE_BUILTIN_TERMINAL_SKILLS,
  CLAUDE_BUILTIN_TOOLS,
  PROTECTED_CLAUDE_TOOLS,
  SYNCED_CLAUDE_SKILL_PREFIX,
  isSyncedClaudeSkillId,
  syncedClaudeSkillId,
  normalizeClaudeBuiltinIds,
  readClaudeBuiltinOptIns,
  readClaudeBuiltinOptInSettings,
  resolveClaudeBuiltinPolicy,
  withoutCollidingBuiltinSkillDenials,
  type ClaudeSkillSourceKind,
} from './claude-builtin-catalog';

/** A settings fake: `read` sees each (section, key) and returns its raw value. */
function settingsReader(
  read: (section: string, key: string) => unknown,
): Pick<IWorkspaceProvider, 'getConfiguration'> {
  return {
    getConfiguration: <T>(section: string, key: string): T | undefined =>
      read(section, key) as T | undefined,
  };
}

const ALL_TOOLS = [
  'DesignSync',
  'EnterWorktree',
  'ExitWorktree',
  'PushNotification',
  'ReportFindings',
  'Workflow',
];
const ALL_SKILLS = [
  'code-review',
  'fewer-permission-prompts',
  'init',
  'keybindings-help',
  'plugin-authoring',
  'update-config',
  'workflow-authoring',
];

describe('Claude built-in catalog', () => {
  it('lists exactly the six default-off tools and seven terminal skills', () => {
    expect(CLAUDE_BUILTIN_TOOLS.map((row) => row.id).sort()).toEqual(ALL_TOOLS);
    expect(CLAUDE_BUILTIN_TERMINAL_SKILLS.map((row) => row.id).sort()).toEqual(
      ALL_SKILLS,
    );
  });

  it('never contains a protected tool', () => {
    const protectedSet = new Set(PROTECTED_CLAUDE_TOOLS);
    expect(
      CLAUDE_BUILTIN_TOOLS.filter((row) => protectedSet.has(row.id)),
    ).toEqual([]);
  });

  it('keeps the tool and skill dependency maps consistent', () => {
    for (const skill of CLAUDE_BUILTIN_TERMINAL_SKILLS) {
      if (skill.needsTool === undefined) continue;
      const tool = CLAUDE_BUILTIN_TOOLS.find(
        (row) => row.id === skill.needsTool,
      );
      expect(tool?.skillsNeedingIt).toContain(skill.id);
    }
    for (const tool of CLAUDE_BUILTIN_TOOLS) {
      for (const skillId of tool.skillsNeedingIt) {
        const skill = CLAUDE_BUILTIN_TERMINAL_SKILLS.find(
          (row) => row.id === skillId,
        );
        expect(skill?.needsTool).toBe(tool.id);
      }
    }
  });

  it('carries the measured costs', () => {
    const cost = (id: string) =>
      [...CLAUDE_BUILTIN_TOOLS, ...CLAUDE_BUILTIN_TERMINAL_SKILLS].find(
        (row) => row.id === id,
      )?.approxTokens;
    expect(cost('Workflow')).toBe(2000);
    expect(cost('ReportFindings')).toBe(850);
    expect(cost('code-review')).toBe(460);
    expect(cost('update-config')).toBe(270);
  });

  it('names the two global opt-in settings', () => {
    expect(CLAUDE_BUILTIN_SETTING_KEYS).toEqual({
      tools: 'agentOrchestration.enabledClaudeBuiltinTools',
      skills: 'agentOrchestration.enabledClaudeBuiltinSkills',
    });
  });
});

describe('resolveClaudeBuiltinPolicy', () => {
  it('denies every catalog tool and skill with no opt-ins, sorted', () => {
    expect(
      resolveClaudeBuiltinPolicy({ enabledTools: [], enabledSkills: [] }),
    ).toEqual({ disallowedTools: ALL_TOOLS, deniedSkillNames: ALL_SKILLS });
  });

  it('allows an enabled tool', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: ['Workflow'],
      enabledSkills: [],
    });
    expect(policy.disallowedTools).not.toContain('Workflow');
    expect(policy.disallowedTools).toHaveLength(5);
  });

  it('keeps code-review denied when only ReportFindings is enabled', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: ['ReportFindings'],
      enabledSkills: [],
    });
    expect(policy.disallowedTools).not.toContain('ReportFindings');
    expect(policy.deniedSkillNames).toContain('code-review');
  });

  it('keeps code-review denied while its tool is off', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: ['code-review'],
    });
    expect(policy.deniedSkillNames).toContain('code-review');
  });

  it('allows code-review when the skill and its tool are both on', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: ['ReportFindings'],
      enabledSkills: ['code-review', 'init'],
    });
    expect(policy.deniedSkillNames).not.toContain('code-review');
    expect(policy.deniedSkillNames).not.toContain('init');
    expect(policy.deniedSkillNames).toContain('workflow-authoring');
  });

  it('ignores names outside the catalog and the synced set', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: ['Bash', 'Agent', 'Nope'],
      enabledSkills: ['orchestration', 'anthropic-skills:unknown'],
    });
    expect(policy).toEqual({
      disallowedTools: ALL_TOOLS,
      deniedSkillNames: ALL_SKILLS,
    });
  });

  it('denies synced skill ids unless enabled', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: ['anthropic-skills:pdf'],
      syncedSkillIds: ['anthropic-skills:pdf', 'anthropic-skills:docs'],
    });
    expect(policy.deniedSkillNames).toContain('anthropic-skills:docs');
    expect(policy.deniedSkillNames).not.toContain('anthropic-skills:pdf');
    expect(policy.deniedSkillNames).toEqual(
      [...policy.deniedSkillNames].sort(),
    );
  });
});

describe('synced skill ids in the policy (TASK_2026_853 Phase B)', () => {
  const SYNCED = ['anthropic-skills:docs', 'anthropic-skills:pdf'];

  it('qualifies a synced name and recognises only qualified ids', () => {
    expect(SYNCED_CLAUDE_SKILL_PREFIX).toBe('anthropic-skills:');
    expect(syncedClaudeSkillId('docs')).toBe('anthropic-skills:docs');
    expect(isSyncedClaudeSkillId('anthropic-skills:docs')).toBe(true);
    expect(isSyncedClaudeSkillId('anthropic-skills:')).toBe(false);
    expect(isSyncedClaudeSkillId('docs')).toBe(false);
    expect(isSyncedClaudeSkillId('init')).toBe(false);
  });

  it('denies every synced id by default, next to the Phase A defaults', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: [],
      syncedSkillIds: SYNCED,
    });
    expect(policy).toEqual({
      disallowedTools: ALL_TOOLS,
      deniedSkillNames: [...ALL_SKILLS, ...SYNCED].sort(),
    });
  });

  it('never denies a bare name passed as a synced id', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: [],
      syncedSkillIds: ['docs', 'orchestration', 'anthropic-skills:', 'pdf'],
    });
    expect(policy.deniedSkillNames).toEqual(ALL_SKILLS);
  });

  it('a synced opt-in and a terminal opt-in are independent', () => {
    const syncedOnly = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: ['anthropic-skills:init'],
      syncedSkillIds: ['anthropic-skills:init'],
    });
    expect(syncedOnly.deniedSkillNames).toContain('init');
    expect(syncedOnly.deniedSkillNames).not.toContain('anthropic-skills:init');
    const terminalOnly = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: ['init'],
      syncedSkillIds: ['anthropic-skills:init'],
    });
    expect(terminalOnly.deniedSkillNames).not.toContain('init');
    expect(terminalOnly.deniedSkillNames).toContain('anthropic-skills:init');
  });

  it('keeps the dependency rule with synced ids present', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: ['code-review', 'anthropic-skills:pdf'],
      syncedSkillIds: SYNCED,
    });
    expect(policy.deniedSkillNames).toContain('code-review');
    expect(policy.deniedSkillNames).not.toContain('anthropic-skills:pdf');
  });

  it('an opt-in for a synced id that is not on this machine denies nothing', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: ['anthropic-skills:gone'],
      syncedSkillIds: [],
    });
    expect(policy.deniedSkillNames).toEqual(ALL_SKILLS);
  });

  it('the same-name guard drops a colliding terminal denial and keeps the qualified synced one', () => {
    const policy = resolveClaudeBuiltinPolicy({
      enabledTools: [],
      enabledSkills: [],
      syncedSkillIds: ['anthropic-skills:init'],
    });
    const result = withoutCollidingBuiltinSkillDenials(
      policy.deniedSkillNames,
      new Map([['init', ['workspace'] as ClaudeSkillSourceKind[]]]),
    );
    expect(result.deniedSkillNames).toContain('anthropic-skills:init');
    expect(result.deniedSkillNames).not.toContain('init');
  });
});

describe('normalizeClaudeBuiltinIds', () => {
  it('drops unknown ids, dedupes and sorts', () => {
    expect(
      normalizeClaudeBuiltinIds(
        ['Workflow', 'Bash', 'DesignSync', 'Workflow'],
        CLAUDE_BUILTIN_TOOLS.map((row) => row.id),
      ),
    ).toEqual(['DesignSync', 'Workflow']);
  });
});

describe('readClaudeBuiltinOptIns', () => {
  it('reads a non-array as no opt-ins and keeps only strings', () => {
    expect(readClaudeBuiltinOptIns(undefined)).toEqual([]);
    expect(readClaudeBuiltinOptIns('Workflow')).toEqual([]);
    expect(readClaudeBuiltinOptIns(['Workflow', 3, null, 'init'])).toEqual([
      'Workflow',
      'init',
    ]);
  });
});

describe('readClaudeBuiltinOptInSettings', () => {
  it('reads both keys from the ptah section', () => {
    const read = jest.fn((_section: string, key: string): unknown =>
      key === CLAUDE_BUILTIN_SETTING_KEYS.tools
        ? ['Workflow', 'Bash', 'Workflow']
        : ['init', 'anthropic-skills:pdf'],
    );
    const optIns = readClaudeBuiltinOptInSettings(settingsReader(read));
    expect(read).toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.enabledClaudeBuiltinTools',
    );
    expect(read).toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.enabledClaudeBuiltinSkills',
    );
    expect(optIns).toEqual({
      enabledTools: ['Workflow'],
      enabledSkills: ['anthropic-skills:pdf', 'init'],
    });
  });

  it('treats a missing provider or a read failure as empty', () => {
    expect(readClaudeBuiltinOptInSettings(undefined)).toEqual({
      enabledTools: [],
      enabledSkills: [],
    });
    const warn = jest.fn();
    const optIns = readClaudeBuiltinOptInSettings(
      settingsReader(() => {
        throw new Error('settings unreadable');
      }),
      { warn },
    );
    expect(optIns).toEqual({ enabledTools: [], enabledSkills: [] });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('withoutCollidingBuiltinSkillDenials (TASK_2026_853 R1)', () => {
  const SYNCED = 'anthropic-skills:docs';
  const denied = [...ALL_SKILLS, 'orchestration', SYNCED];

  it.each<[string, ClaudeSkillSourceKind]>([
    ['init', 'workspace'],
    ['init', 'user'],
    ['init', 'plugin'],
    ['code-review', 'workspace'],
    ['code-review', 'user'],
    ['code-review', 'plugin'],
  ])('drops the %s denial when a %s skill shares the name', (name, source) => {
    const result = withoutCollidingBuiltinSkillDenials(
      denied,
      new Map([[name, [source]]]),
    );
    expect(result.deniedSkillNames).not.toContain(name);
    expect(result.keptVisible).toEqual([
      { name, reason: 'same-name-skill', sources: [source] },
    ]);
    // Every other denial is still emitted.
    expect(result.deniedSkillNames).toEqual(
      denied.filter((entry) => entry !== name),
    );
  });

  it('keeps every denial when no same-name skill exists', () => {
    const result = withoutCollidingBuiltinSkillDenials(denied, new Map());
    expect(result.deniedSkillNames).toEqual(denied);
    expect(result.keptVisible).toEqual([]);
  });

  it('unknown discovery drops every catalog denial and keeps the rest', () => {
    const result = withoutCollidingBuiltinSkillDenials(denied, null);
    expect(result.deniedSkillNames).toEqual(['orchestration', SYNCED]);
    expect(result.keptVisible.map((row) => row.name)).toEqual(ALL_SKILLS);
    expect(
      result.keptVisible.every((row) => row.reason === 'discovery-unknown'),
    ).toBe(true);
  });

  it('never guards a non-catalog name, even when one of that name is found', () => {
    const result = withoutCollidingBuiltinSkillDenials(
      ['orchestration'],
      new Map([['orchestration', ['workspace'] as ClaudeSkillSourceKind[]]]),
    );
    expect(result.deniedSkillNames).toEqual(['orchestration']);
  });
});
