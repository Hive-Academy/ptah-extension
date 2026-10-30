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

// The same-name skill guard (R1) reads the account config dir; point it at an
// empty fixture so the developer's own `~/.claude` never leaks in.
let fixtureRoot: string;
let previousConfigDir: string | undefined;
beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ptah-spawn-builtins-'));
  previousConfigDir = process.env['CLAUDE_CONFIG_DIR'];
  process.env['CLAUDE_CONFIG_DIR'] = join(fixtureRoot, 'account');
});
afterEach(() => {
  if (previousConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
  else process.env['CLAUDE_CONFIG_DIR'] = previousConfigDir;
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
    user: (name) => skillAt(join(fixtureRoot, 'account', 'skills'), name),
    plugin: (name) => {
      const plugin = join(fixtureRoot, 'plugin');
      skillAt(join(plugin, 'skills'), name);
      mkdirSync(join(fixtureRoot, 'account', 'plugins'), { recursive: true });
      writeFileSync(
        join(fixtureRoot, 'account', 'plugins', 'installed_plugins.json'),
        JSON.stringify({ plugins: { 'p@m': [{ installPath: plugin }] } }),
      );
      // Only an enabled plugin loads its skills (R2b N4).
      writeFileSync(
        join(fixtureRoot, 'account', 'settings.json'),
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
