/**
 * TASK_2026_853 A-3 — `PtahCliSpawnOptions` reads the same global Claude
 * built-in opt-ins as the main session and carries the resulting policy.
 */

import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv, EffectiveCapabilitySet } from '@ptah-extension/shared';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

// `<home>/.claude` is resolved with `os.homedir()`, which a `HOME` override
// in a Jest sandbox does not reach; the specs point it at a fixture here.
let mockHomeDir: string | undefined;
jest.mock('node:os', () => {
  const actual: { homedir(): string } = jest.requireActual('node:os');
  return { ...actual, homedir: () => mockHomeDir ?? actual.homedir() };
});

jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('EnhancedPromptsService'),
  },
}));

import {
  CLAUDE_BUILTIN_SETTING_KEYS,
  unverifiedCapabilityPolicy,
} from '@ptah-extension/agent-sdk';
import { PtahCliSpawnOptions } from './ptah-cli-spawn-options.service';

const CWD = '/repo';
const AUTH_ENV = {} as AuthEnv;
const DEFAULT_TOOLS = [
  'DesignSync',
  'EnterWorktree',
  'ExitWorktree',
  'PushNotification',
  'ReportFindings',
  'Workflow',
];
const DEFAULT_SKILLS = [
  'code-review',
  'fewer-permission-prompts',
  'init',
  'keybindings-help',
  'plugin-authoring',
  'update-config',
  'workflow-authoring',
];

function verifiedPolicy(
  deniedSkillNames: string[] = [],
): EffectiveCapabilitySet {
  return {
    physicalRoot: CWD,
    policyKey: CWD,
    status: 'verified',
    reasons: [],
    ptahEnabled: true,
    deniedMcpServers: [],
    approvedProjectMcpServers: [],
    deniedSkillNames,
    disabledPluginIds: [],
    harnessFingerprint: 'fp',
  };
}

/** Global file settings as the workspace provider serves them. */
function settingsWorkspace(
  read: (section: string, key: string) => unknown,
): Pick<IWorkspaceProvider, 'getConfiguration'> {
  return {
    getConfiguration: <T>(section: string, key: string): T | undefined =>
      read(section, key) as T | undefined,
  };
}

function buildService(
  workspace?: Pick<IWorkspaceProvider, 'getConfiguration'>,
): PtahCliSpawnOptions {
  const ctor = PtahCliSpawnOptions as unknown as new (
    ...args: unknown[]
  ) => PtahCliSpawnOptions;
  return new ctor(
    createMockLogger() as unknown as Logger,
    { createHooks: jest.fn().mockReturnValue({}) },
    { createHooks: jest.fn().mockReturnValue({}) },
    { getConfig: jest.fn().mockReturnValue({ enabled: false }) },
    { getProjectGuidanceContent: jest.fn().mockResolvedValue(undefined) },
    undefined,
    undefined,
    workspace,
  );
}

async function assemble(
  service: PtahCliSpawnOptions,
  policy?: EffectiveCapabilitySet,
) {
  return service.assembleSpawnOptions(
    AUTH_ENV,
    CWD,
    'opus',
    undefined,
    undefined,
    undefined,
    policy,
  );
}

// The same-name skill guard (R1) and the synced reader (Phase B) read the
// config dir an ambient lane child gets: its safe env's `CLAUDE_CONFIG_DIR`
// (from the auth env), else `<home>/.claude`. The host `CLAUDE_CONFIG_DIR`
// never reaches that child, so it is cleared, and the home dir points at a
// fixture so the developer's own `~/.claude` never leaks in.
let fixtureRoot: string;
let accountDir: string;
let previousConfigDir: string | undefined;
beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ptah-spawn-builtins-'));
  mockHomeDir = join(fixtureRoot, 'home');
  accountDir = join(mockHomeDir, '.claude');
  previousConfigDir = process.env['CLAUDE_CONFIG_DIR'];
  delete process.env['CLAUDE_CONFIG_DIR'];
  // Each case has its own temp config dir, so the synced reader's per-dir
  // cache never carries a result from one case into another.
});
afterEach(() => {
  if (previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
  else process.env['CLAUDE_CONFIG_DIR'] = previousConfigDir;
  mockHomeDir = undefined;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('PtahCliSpawnOptions — Claude built-in policy (TASK_2026_853)', () => {
  it('defaults to every catalog item off when nothing is stored', async () => {
    const assembly = await assemble(
      buildService(settingsWorkspace(() => undefined)),
      verifiedPolicy(['orchestration']),
    );
    expect(assembly.builtinPolicy).toEqual({
      disallowedTools: DEFAULT_TOOLS,
      deniedSkillNames: DEFAULT_SKILLS,
    });
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual([
      'orchestration',
      ...DEFAULT_SKILLS,
    ]);
  });

  it('reads both global keys from the ptah section and applies the opt-ins', async () => {
    const read = jest.fn((_section: string, key: string): unknown =>
      key === CLAUDE_BUILTIN_SETTING_KEYS.tools
        ? ['Workflow']
        : ['workflow-authoring', 'init'],
    );
    const assembly = await assemble(
      buildService(settingsWorkspace(read)),
      verifiedPolicy(),
    );
    expect(read).toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.enabledClaudeBuiltinTools',
    );
    expect(read).toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.enabledClaudeBuiltinSkills',
    );
    expect(assembly.builtinPolicy.disallowedTools).not.toContain('Workflow');
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain(
      'workflow-authoring',
    );
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain('init');
    expect(assembly.capabilityFlags.deniedSkillNames).toContain('code-review');
  });

  it('unverified policy: tool denials kept, skill flag list left as the policy built it', async () => {
    const assembly = await assemble(
      buildService(settingsWorkspace(() => undefined)),
      unverifiedCapabilityPolicy(CWD, 'fixture'),
    );
    expect(assembly.builtinPolicy.disallowedTools).toEqual(DEFAULT_TOOLS);
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual([]);
    expect(assembly.capabilityIsolation).toEqual({
      strictMcpConfig: true,
      skills: [],
    });
  });

  it('a host without a workspace provider, or a failing read, keeps every built-in off', async () => {
    const withoutProvider = await assemble(buildService(), verifiedPolicy());
    expect(withoutProvider.builtinPolicy.disallowedTools).toEqual(
      DEFAULT_TOOLS,
    );
    const failing = await assemble(
      buildService(
        settingsWorkspace(() => {
          throw new Error('settings unreadable');
        }),
      ),
      verifiedPolicy(),
    );
    expect(failing.builtinPolicy).toEqual({
      disallowedTools: DEFAULT_TOOLS,
      deniedSkillNames: DEFAULT_SKILLS,
    });
  });
});

describe('PtahCliSpawnOptions — same-name skill guard (TASK_2026_853 R1)', () => {
  function skillAt(skillsDir: string, name: string): void {
    mkdirSync(join(skillsDir, name), { recursive: true });
    writeFileSync(
      join(skillsDir, name, 'SKILL.md'),
      `---\nname: ${name}\n---\n`,
    );
  }
  function workspaceDir(): string {
    const dir = join(fixtureRoot, 'ws');
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const sources: Record<string, (name: string) => void> = {
    workspace: (name) =>
      skillAt(join(fixtureRoot, 'ws', '.claude', 'skills'), name),
    user: (name) => skillAt(join(accountDir, 'skills'), name),
    plugin: (name) => {
      const plugin = join(fixtureRoot, 'plugin');
      skillAt(join(plugin, 'skills'), name);
      mkdirSync(join(accountDir, 'plugins'), { recursive: true });
      writeFileSync(
        join(accountDir, 'plugins', 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'p@m': [{ installPath: plugin }] } }),
      );
      // Only an enabled plugin loads its skills (R2b N4).
      writeFileSync(
        join(accountDir, 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'p@m': true } }),
      );
    },
  };

  function assembleAt(
    cwd: string,
    policy: EffectiveCapabilitySet,
    skillScope?: {
      cwd?: string;
      claudeConfigDir?: string;
      settingSources?: readonly string[];
    },
  ) {
    return buildService(
      settingsWorkspace(() => undefined),
    ).assembleSpawnOptions(
      AUTH_ENV,
      cwd,
      'opus',
      undefined,
      undefined,
      undefined,
      policy,
      skillScope,
    );
  }

  it.each([
    ['init', 'workspace'],
    ['init', 'user'],
    ['init', 'plugin'],
    ['code-review', 'workspace'],
    ['code-review', 'user'],
    ['code-review', 'plugin'],
  ])('does not hide a %s %s skill', async (name, source) => {
    const cwd = workspaceDir();
    sources[source](name);
    const assembly = await assembleAt(cwd, verifiedPolicy());
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual(
      DEFAULT_SKILLS.filter((entry) => entry !== name),
    );
    expect(assembly.builtinPolicy.deniedSkillNames).not.toContain(name);
    expect(assembly.builtinPolicy.disallowedTools).toEqual(DEFAULT_TOOLS);
  });

  it('still denies every catalog skill when nothing collides', async () => {
    const assembly = await assembleAt(workspaceDir(), verifiedPolicy());
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual(DEFAULT_SKILLS);
  });

  it('scans the named launch config dir and cwd from the skill scope', async () => {
    const account = join(fixtureRoot, 'named-account');
    skillAt(join(account, 'skills'), 'init');
    const certifiedCwd = join(fixtureRoot, 'certified');
    skillAt(join(certifiedCwd, '.claude', 'skills'), 'code-review');
    const assembly = await assembleAt(workspaceDir(), verifiedPolicy(), {
      cwd: certifiedCwd,
      claudeConfigDir: account,
    });
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain('init');
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain(
      'code-review',
    );
    expect(assembly.capabilityFlags.deniedSkillNames).toContain(
      'update-config',
    );
  });

  it('skips the user tier when the named launch does not load it (R2)', async () => {
    const account = join(fixtureRoot, 'named-account');
    skillAt(join(account, 'skills'), 'init');
    const assembly = await assembleAt(workspaceDir(), verifiedPolicy(), {
      claudeConfigDir: account,
      settingSources: ['project', 'local'],
    });
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual(DEFAULT_SKILLS);
  });

  it('keeps a capability-policy denial of the same name', async () => {
    const cwd = workspaceDir();
    sources['workspace']('init');
    const assembly = await assembleAt(cwd, verifiedPolicy(['init']));
    expect(assembly.capabilityFlags.deniedSkillNames).toContain('init');
  });
});

describe('PtahCliSpawnOptions — account-synced skills (TASK_2026_853 Phase B)', () => {
  const ACCOUNT =
    '09058677-0000-4000-8000-000000000001_6563c852-0000-4000-8000-000000000001';
  const SYNCED = ['anthropic-skills:docs', 'anthropic-skills:pdf'];

  function syncedAt(configDir: string, names: readonly string[]): void {
    const dir = join(configDir, 'skills', 'synced', ACCOUNT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        lastUpdated: 1,
        skills: names.map((name) => ({
          skillId: name,
          name,
          description: `${name} skill`,
          source: 'anthropic',
        })),
      }),
    );
  }

  function assembleWith(
    options: {
      cwd?: string;
      policy?: EffectiveCapabilitySet;
      authEnv?: AuthEnv;
      enabledSkills?: string[];
      skillScope?: {
        cwd?: string;
        claudeConfigDir?: string;
        settingSources?: readonly string[];
      };
    } = {},
  ) {
    return buildService(
      settingsWorkspace((_section, key) =>
        key === CLAUDE_BUILTIN_SETTING_KEYS.skills
          ? options.enabledSkills
          : undefined,
      ),
    ).assembleSpawnOptions(
      options.authEnv ?? AUTH_ENV,
      options.cwd ?? CWD,
      'opus',
      undefined,
      undefined,
      undefined,
      options.policy ?? verifiedPolicy(),
      options.skillScope,
    );
  }

  it('ambient lane: hides every synced skill of the config dir by its qualified key', async () => {
    syncedAt(accountDir, ['docs', 'pdf']);
    const assembly = await assembleWith();
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual(
      [...DEFAULT_SKILLS, ...SYNCED].sort(),
    );
    expect(assembly.builtinPolicy.disallowedTools).toEqual(DEFAULT_TOOLS);
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain('docs');
  });

  it('ambient lane: ignores a host-only CLAUDE_CONFIG_DIR the child never gets (decision #42)', async () => {
    syncedAt(accountDir, ['pdf']);
    const hostDir = join(fixtureRoot, 'host-account');
    syncedAt(hostDir, ['docs']);
    process.env['CLAUDE_CONFIG_DIR'] = hostDir;
    const assembly = await assembleWith();
    expect(assembly.capabilityFlags.deniedSkillNames).toContain(
      'anthropic-skills:pdf',
    );
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain(
      'anthropic-skills:docs',
    );
  });

  it('ambient lane: reads the auth env CLAUDE_CONFIG_DIR the child gets, not the host one', async () => {
    syncedAt(accountDir, ['pdf']);
    process.env['CLAUDE_CONFIG_DIR'] = accountDir;
    const authDir = join(fixtureRoot, 'auth-account');
    syncedAt(authDir, ['docs']);
    const assembly = await assembleWith({
      // Not part of the AuthEnv type; a lane child still receives it.
      authEnv: Object.assign<AuthEnv, Record<string, string>>(
        {},
        { CLAUDE_CONFIG_DIR: authDir },
      ),
    });
    expect(assembly.capabilityFlags.deniedSkillNames).toContain(
      'anthropic-skills:docs',
    );
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain(
      'anthropic-skills:pdf',
    );
  });

  it('named lane: reads the certified config dir over the auth and host dirs', async () => {
    syncedAt(accountDir, ['pdf']);
    process.env['CLAUDE_CONFIG_DIR'] = accountDir;
    const authDir = join(fixtureRoot, 'auth-account');
    syncedAt(authDir, ['pdf']);
    const named = join(fixtureRoot, 'named-account');
    syncedAt(named, ['docs']);
    const assembly = await assembleWith({
      authEnv: Object.assign<AuthEnv, Record<string, string>>(
        {},
        { CLAUDE_CONFIG_DIR: authDir },
      ),
      skillScope: { claudeConfigDir: named },
    });
    expect(assembly.capabilityFlags.deniedSkillNames).toContain(
      'anthropic-skills:docs',
    );
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain(
      'anthropic-skills:pdf',
    );
  });

  it('shows a synced skill the user opted in to', async () => {
    syncedAt(accountDir, ['docs', 'pdf']);
    const assembly = await assembleWith({
      enabledSkills: ['anthropic-skills:pdf'],
    });
    expect(assembly.capabilityFlags.deniedSkillNames).toContain(
      'anthropic-skills:docs',
    );
    expect(assembly.capabilityFlags.deniedSkillNames).not.toContain(
      'anthropic-skills:pdf',
    );
  });

  it('keeps a same-name workspace skill visible', async () => {
    syncedAt(accountDir, ['docs', 'init']);
    const cwd = join(fixtureRoot, 'ws');
    for (const name of ['docs', 'init']) {
      mkdirSync(join(cwd, '.claude', 'skills', name), { recursive: true });
      writeFileSync(
        join(cwd, '.claude', 'skills', name, 'SKILL.md'),
        `---\nname: ${name}\n---\n`,
      );
    }
    const assembly = await assembleWith({ cwd });
    const denied = assembly.capabilityFlags.deniedSkillNames;
    expect(denied).toContain('anthropic-skills:docs');
    expect(denied).toContain('anthropic-skills:init');
    expect(denied).not.toContain('docs');
    expect(denied).not.toContain('init');
  });

  it('unverified policy: no synced keys, flag list as the policy built it', async () => {
    syncedAt(accountDir, ['docs', 'pdf']);
    const assembly = await assembleWith({
      policy: unverifiedCapabilityPolicy(CWD, 'fixture'),
    });
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual([]);
    expect(assembly.capabilityIsolation).toEqual({
      strictMcpConfig: true,
      skills: [],
    });
    expect(assembly.builtinPolicy.disallowedTools).toEqual(DEFAULT_TOOLS);
  });

  it('proxy route without the user tier: the qualified keys are still carried', async () => {
    syncedAt(accountDir, ['docs', 'pdf']);
    const assembly = await assembleWith({
      authEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080' },
      skillScope: { settingSources: ['project', 'local'] },
    });
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual(
      expect.arrayContaining(SYNCED),
    );
    expect(assembly.builtinPolicy.disallowedTools).toEqual(DEFAULT_TOOLS);
  });

  it('a malformed manifest is not fatal: Phase A denials only', async () => {
    const dir = join(accountDir, 'skills', 'synced', ACCOUNT);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), '{ not json');
    const assembly = await assembleWith();
    expect(assembly.capabilityFlags.deniedSkillNames).toEqual(DEFAULT_SKILLS);
  });
});
