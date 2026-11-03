/**
 * TASK_2026_853 review fix R1 — a catalog built-in skill denial is a bare
 * `skillOverrides` key, which hides every skill of that name. Discovery finds
 * same-name workspace, user and plugin skills so the guard can drop it.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearClaudeSkillNameCache,
  discoverClaudeSkillNames,
  guardClaudeBuiltinSkillDenials,
  installedPluginRoots,
  skillFrontmatterName,
  yamlLineScalar,
} from './claude-skill-name-discovery';

const ALL_SKILLS = [
  'code-review',
  'fewer-permission-prompts',
  'init',
  'keybindings-help',
  'plugin-authoring',
  'update-config',
  'workflow-authoring',
];

interface Layout {
  root: string;
  home: string;
  workspace: string;
  configDir: string;
}

let layout: Layout;

beforeEach(() => {
  clearClaudeSkillNameCache();
  const root = mkdtempSync(join(tmpdir(), 'ptah-skill-discovery-'));
  const home = join(root, 'home');
  const workspace = join(home, 'code', 'repo');
  const configDir = join(root, 'account');
  for (const dir of [home, workspace, configDir])
    mkdirSync(dir, { recursive: true });
  layout = { root, home, workspace, configDir };
});

afterEach(() => {
  rmSync(layout.root, { recursive: true, force: true });
});

function skill(dir: string, name: string, frontmatterName?: string): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, 'SKILL.md'),
    frontmatterName === undefined
      ? '# no frontmatter\n'
      : `---\nname: ${frontmatterName}\ndescription: fixture\n---\nbody\n`,
  );
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

/** Install `fixture@market`; `enabled` writes its user-tier `enabledPlugins`. */
function installPlugin(
  installPath: string,
  enabled: boolean | null = true,
): void {
  writeJson(join(layout.configDir, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'fixture@market': [{ scope: 'user', installPath }] },
  });
  if (enabled !== null) enableInUser({ 'fixture@market': enabled });
}

function enableInUser(enabledPlugins: Record<string, boolean>): void {
  writeJson(join(layout.configDir, 'settings.json'), { enabledPlugins });
}

function discover(settingSources?: readonly string[]) {
  return discoverClaudeSkillNames({
    cwds: [layout.workspace],
    claudeConfigDir: layout.configDir,
    homeDir: layout.home,
    ...(settingSources ? { settingSources } : {}),
  });
}

describe('discoverClaudeSkillNames', () => {
  it('finds nothing in empty sources', async () => {
    expect(await discover()).toEqual({ status: 'known', found: new Map() });
  });

  it.each(['init', 'code-review'])(
    'finds a workspace skill named %s',
    async (name) => {
      skill(join(layout.workspace, '.claude', 'skills'), name);
      expect(await discover()).toEqual({
        status: 'known',
        found: new Map([[name, ['workspace']]]),
      });
    },
  );

  it.each(['init', 'code-review'])(
    'finds a user skill named %s in the account config dir',
    async (name) => {
      skill(join(layout.configDir, 'skills'), name);
      expect(await discover()).toEqual({
        status: 'known',
        found: new Map([[name, ['user']]]),
      });
    },
  );

  it.each(['init', 'code-review'])(
    'finds a plugin skill named %s under an installed plugin',
    async (name) => {
      const plugin = join(layout.root, 'plugin-cache', 'fixture');
      skill(join(plugin, 'skills'), name);
      installPlugin(plugin);
      expect(await discover()).toEqual({
        status: 'known',
        found: new Map([[name, ['plugin']]]),
      });
    },
  );

  it('matches a frontmatter name, a command file and a parent directory', async () => {
    skill(
      join(layout.workspace, '.claude', 'skills'),
      'my-reviewer',
      'code-review',
    );
    mkdirSync(join(layout.configDir, 'commands'), { recursive: true });
    writeFileSync(join(layout.configDir, 'commands', 'init.md'), 'body');
    skill(join(layout.home, 'code', '.claude', 'skills'), 'update-config');
    const result = await discover();
    expect(result).toEqual({
      status: 'known',
      found: new Map([
        ['code-review', ['workspace']],
        ['init', ['user']],
        ['update-config', ['workspace']],
      ]),
    });
  });

  it('ignores skills with other names and stops the parent walk at home', async () => {
    skill(
      join(layout.workspace, '.claude', 'skills'),
      'orchestration',
      'orchestration',
    );
    // `<home>/.claude` is the user layer, never read as a project directory.
    skill(join(layout.home, '.claude', 'skills'), 'init');
    expect(await discover()).toEqual({ status: 'known', found: new Map() });
  });

  it('matches a quoted frontmatter name with a trailing comment under another directory name (R2 N1)', async () => {
    const skills = join(layout.workspace, '.claude', 'skills');
    mkdirSync(join(skills, 'my-reviewer'), { recursive: true });
    writeFileSync(
      join(skills, 'my-reviewer', 'SKILL.md'),
      '---\nname: "code-review" # reviewer note\ndescription: fixture\n---\nbody\n',
    );
    expect(await discover()).toEqual({
      status: 'known',
      found: new Map([['code-review', ['workspace']]]),
    });
  });

  it('matches a frontmatter name when the rest of the block is not valid YAML (R2 N1)', async () => {
    const skills = join(layout.configDir, 'skills');
    mkdirSync(join(skills, 'setup'), { recursive: true });
    writeFileSync(
      join(skills, 'setup', 'SKILL.md'),
      "---\nname: 'init' # setup\ndescription: Run this: then that\n---\n",
    );
    expect(await discover()).toEqual({
      status: 'known',
      found: new Map([['init', ['user']]]),
    });
  });

  it('skips the user tier when the setting sources drop it (proxy route, R2 N2)', async () => {
    skill(join(layout.configDir, 'skills'), 'init');
    mkdirSync(join(layout.configDir, 'commands'), { recursive: true });
    writeFileSync(join(layout.configDir, 'commands', 'code-review.md'), 'x');
    skill(join(layout.workspace, '.claude', 'skills'), 'update-config');
    expect(await discover(['project', 'local'])).toEqual({
      status: 'known',
      found: new Map([['update-config', ['workspace']]]),
    });
    expect(await discover()).toEqual({
      status: 'known',
      found: new Map([
        ['code-review', ['user']],
        ['init', ['user']],
        ['update-config', ['workspace']],
      ]),
    });
  });

  it('skips the workspace tier without `project`, and scans nothing with no sources (R2 N2)', async () => {
    skill(join(layout.workspace, '.claude', 'skills'), 'init');
    const plugin = join(layout.root, 'plugin-cache', 'fixture');
    skill(join(plugin, 'skills'), 'code-review');
    installPlugin(plugin);
    expect(await discover(['user'])).toEqual({
      status: 'known',
      found: new Map([['code-review', ['plugin']]]),
    });
    expect(await discover([])).toEqual({ status: 'known', found: new Map() });
  });

  it('reuses an unchanged SKILL.md name and re-reads it when the file changes (R2 N3)', async () => {
    const skills = join(layout.workspace, '.claude', 'skills');
    skill(skills, 'my-helper', 'helper');
    // The module object the source's own `open` import resolves to.
    const openSpy = jest.spyOn(
      jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises'),
      'open',
    );
    try {
      expect(await discover()).toEqual({ status: 'known', found: new Map() });
      expect(openSpy).toHaveBeenCalledTimes(1);
      openSpy.mockClear();
      expect(await discover()).toEqual({ status: 'known', found: new Map() });
      expect(openSpy).not.toHaveBeenCalled();
      // A frontmatter edit leaves the directory's own stat alone.
      writeFileSync(
        join(skills, 'my-helper', 'SKILL.md'),
        '---\nname: workflow-authoring\n---\nlonger body\n',
      );
      expect(await discover()).toEqual({
        status: 'known',
        found: new Map([['workflow-authoring', ['workspace']]]),
      });
      expect(openSpy).toHaveBeenCalledTimes(1);
    } finally {
      openSpy.mockRestore();
    }
  });

  it('sees a skill directory added after a cached scan (R2 N3)', async () => {
    const skills = join(layout.workspace, '.claude', 'skills');
    skill(skills, 'orchestration', 'orchestration');
    expect(await discover()).toEqual({ status: 'known', found: new Map() });
    skill(skills, 'init');
    expect(await discover()).toEqual({
      status: 'known',
      found: new Map([['init', ['workspace']]]),
    });
  });

  it.each([
    ['disabled', false],
    ['never enabled', null],
  ] as const)(
    'ignores an installed but %s plugin (R2b N4)',
    async (_label, enabled) => {
      const plugin = join(layout.root, 'plugin-cache', 'fixture');
      skill(join(plugin, 'skills'), 'init');
      installPlugin(plugin, enabled);
      expect(await discover()).toEqual({ status: 'known', found: new Map() });
    },
  );

  it('applies local over project over user to enabledPlugins (R2b N4)', async () => {
    const plugin = join(layout.root, 'plugin-cache', 'fixture');
    skill(join(plugin, 'skills'), 'init');
    installPlugin(plugin, true);
    const project = join(layout.workspace, '.claude', 'settings.json');
    const local = join(layout.workspace, '.claude', 'settings.local.json');
    writeJson(project, { enabledPlugins: { 'fixture@market': false } });
    expect(await discover()).toEqual({ status: 'known', found: new Map() });
    writeJson(local, { enabledPlugins: { 'fixture@market': true } });
    expect(await discover()).toEqual({
      status: 'known',
      found: new Map([['init', ['plugin']]]),
    });
    // Without the local tier, the project tier's `false` wins again.
    expect(await discover(['user', 'project'])).toEqual({
      status: 'known',
      found: new Map(),
    });
    // Without the user tier, nothing enables it.
    rmSync(local);
    expect(await discover(['project', 'local'])).toEqual({
      status: 'known',
      found: new Map(),
    });
  });

  it.each([
    ['unparseable', '{not json', 'ESETTINGSPARSE'],
    ['malformed enabledPlugins', '{"enabledPlugins":[]}', 'ESETTINGSFORMAT'],
  ])(
    'is unknown when a loaded settings file is %s (R2b N4)',
    async (_label, body, code) => {
      mkdirSync(join(layout.workspace, '.claude'), { recursive: true });
      writeFileSync(join(layout.workspace, '.claude', 'settings.json'), body);
      expect(await discover()).toEqual({ status: 'unknown', errorCode: code });
    },
  );

  it('is unknown when a higher tier has a non-boolean enabledPlugins entry over a valid lower tier (N5)', async () => {
    enableInUser({ 'fixture@market': true });
    mkdirSync(join(layout.workspace, '.claude'), { recursive: true });
    writeFileSync(
      join(layout.workspace, '.claude', 'settings.json'),
      '{"enabledPlugins":{"fixture@market":"false"}}',
    );
    expect(await discover()).toEqual({
      status: 'unknown',
      errorCode: 'ESETTINGSFORMAT',
    });
  });

  it('is unknown when the plugin registry cannot be parsed', async () => {
    enableInUser({ 'fixture@market': true });
    mkdirSync(join(layout.configDir, 'plugins'), { recursive: true });
    writeFileSync(
      join(layout.configDir, 'plugins', 'installed_plugins.json'),
      '{not json',
    );
    expect(await discover()).toEqual({
      status: 'unknown',
      errorCode: 'EPLUGINPARSE',
    });
  });

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  (process.platform === 'win32' || isRoot ? it.skip : it)(
    'is unknown when a skills directory cannot be read',
    async () => {
      const skills = join(layout.workspace, '.claude', 'skills');
      mkdirSync(skills, { recursive: true });
      chmodSync(skills, 0o000);
      try {
        expect(await discover()).toEqual({
          status: 'unknown',
          errorCode: 'EACCES',
        });
      } finally {
        chmodSync(skills, 0o755);
      }
    },
  );
});

describe('skillFrontmatterName / installedPluginRoots', () => {
  it('reads a quoted or plain frontmatter name only', () => {
    expect(skillFrontmatterName('---\nname: "init"\n---\n')).toBe('init');
    expect(skillFrontmatterName('---\nname: code-review\n')).toBe(
      'code-review',
    );
    expect(skillFrontmatterName('name: init\n')).toBeUndefined();
    expect(
      skillFrontmatterName('---\ndescription: x\n---\nname: init\n'),
    ).toBeUndefined();
  });

  it('parses YAML scalars with comments and quotes (R2 N1)', () => {
    expect(
      skillFrontmatterName('---\nname: "code-review" # reviewer note\n---\n'),
    ).toBe('code-review');
    expect(skillFrontmatterName("---\nname: 'init' # x\n---\n")).toBe('init');
    expect(skillFrontmatterName('---\nname: init # plain\n---\n')).toBe('init');
    expect(skillFrontmatterName('---\nname: 42\n---\n')).toBeUndefined();
    // Invalid YAML elsewhere in the block falls back to the line reader.
    expect(
      skillFrontmatterName(
        '---\nname: "init" # c\ndescription: a: b: c\n---\n',
      ),
    ).toBe('init');
  });

  it('reads one scalar from a key line', () => {
    expect(yamlLineScalar(' "code-review" # note')).toBe('code-review');
    expect(yamlLineScalar(String.raw`"a\"b"`)).toBe('a"b');
    expect(yamlLineScalar("'it''s' # x")).toBe("it's");
    expect(yamlLineScalar('init # x')).toBe('init');
    expect(yamlLineScalar('a#b')).toBe('a#b');
    expect(yamlLineScalar('"open')).toBeUndefined();
  });

  it('accepts the v1 and v2 registry shapes and refuses anything else', () => {
    expect(
      installedPluginRoots({ plugins: { a: [{ installPath: '/a' }] } }),
    ).toEqual(['/a']);
    expect(
      installedPluginRoots({ plugins: { b: { installPath: '/b' } } }),
    ).toEqual(['/b']);
    expect(() => installedPluginRoots({ plugins: { c: [{}] } })).toThrow();
    expect(() => installedPluginRoots([])).toThrow();
    expect(
      installedPluginRoots(
        {
          plugins: {
            'a@m': [{ installPath: '/a' }],
            'b@m': { installPath: '/b' },
          },
        },
        (id) => id === 'b@m',
      ),
    ).toEqual(['/b']);
  });
});

describe('guardClaudeBuiltinSkillDenials', () => {
  const policy = {
    disallowedTools: ['Workflow'],
    deniedSkillNames: [...ALL_SKILLS, 'anthropic-skills:docs'],
  };

  function logger() {
    return { info: jest.fn(), warn: jest.fn() };
  }

  it('keeps every denial when nothing collides', async () => {
    const log = logger();
    const guarded = await guardClaudeBuiltinSkillDenials(
      policy,
      {
        cwds: [layout.workspace],
        claudeConfigDir: layout.configDir,
        homeDir: layout.home,
      },
      log,
    );
    expect(guarded).toEqual(policy);
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('drops a colliding denial and logs the name and source, never a path', async () => {
    skill(join(layout.workspace, '.claude', 'skills'), 'init');
    const log = logger();
    const guarded = await guardClaudeBuiltinSkillDenials(
      policy,
      {
        cwds: [layout.workspace],
        claudeConfigDir: layout.configDir,
        homeDir: layout.home,
      },
      log,
    );
    expect(guarded.deniedSkillNames).not.toContain('init');
    expect(guarded.deniedSkillNames).toContain('code-review');
    expect(guarded.disallowedTools).toEqual(['Workflow']);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('kept visible'),
      {
        keptVisible: [
          { name: 'init', reason: 'same-name-skill', sources: ['workspace'] },
        ],
      },
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(layout.root);
  });

  it('unknown discovery: no catalog denial, synced ids kept, a warning with the code', async () => {
    enableInUser({ 'fixture@market': true });
    mkdirSync(join(layout.configDir, 'plugins'), { recursive: true });
    writeFileSync(
      join(layout.configDir, 'plugins', 'installed_plugins.json'),
      '[]',
    );
    const log = logger();
    const guarded = await guardClaudeBuiltinSkillDenials(
      policy,
      {
        cwds: [layout.workspace],
        claudeConfigDir: layout.configDir,
        homeDir: layout.home,
      },
      log,
    );
    expect(guarded.deniedSkillNames).toEqual(['anthropic-skills:docs']);
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), {
      errorCode: 'EPLUGINFORMAT',
      keptVisible: ALL_SKILLS,
    });
  });

  it.each([
    ['disabled', false, true],
    ['enabled', true, false],
  ] as const)(
    'a %s installed plugin with skills/init: init denied = %s (R2b N4)',
    async (_label, enabled, initDenied) => {
      const plugin = join(layout.root, 'plugin-cache', 'fixture');
      skill(join(plugin, 'skills'), 'init');
      installPlugin(plugin, enabled);
      const guarded = await guardClaudeBuiltinSkillDenials(
        policy,
        {
          cwds: [layout.workspace],
          claudeConfigDir: layout.configDir,
          homeDir: layout.home,
        },
        logger(),
      );
      expect(guarded.deniedSkillNames.includes('init')).toBe(initDenied);
      expect(guarded.deniedSkillNames).toContain('code-review');
    },
  );

  it('skips discovery when no catalog skill is denied', async () => {
    const empty = {
      disallowedTools: [],
      deniedSkillNames: ['anthropic-skills:docs'],
    };
    const guarded = await guardClaudeBuiltinSkillDenials(
      empty,
      { cwds: ['/does/not/matter'] },
      logger(),
    );
    expect(guarded).toBe(empty);
  });
});
