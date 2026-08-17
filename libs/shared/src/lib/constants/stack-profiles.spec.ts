import {
  STACK_MANIFEST_FILES,
  STACK_PROFILES,
  STACK_SOURCE_EXTENSIONS,
  detectStackProfiles,
  getStackProfile,
  matchesStackGlob,
  matchesStackProfile,
} from './stack-profiles';

/**
 * Fixture root listings, one per stack. These are the exact inputs the
 * detectors see (a flat list of workspace-root filenames), so a profile that
 * passes here passes for `ProjectDetectorService`, the harness workspace probe
 * and the emptiness check alike.
 */
const NODE_TS_ROOT = ['package.json', 'tsconfig.json', 'src', 'README.md'];
const DOTNET_SOLUTION_ROOT = ['MyApp.sln', 'MyApp.csproj', 'README.md'];
const DOTNET_CPM_ROOT = ['Directory.Packages.props', 'global.json', 'src'];
const PYTHON_UV_ROOT = ['pyproject.toml', 'uv.lock', 'src'];
const PYTHON_LEGACY_ROOT = ['requirements.txt', 'setup.py', 'app'];

describe('STACK_PROFILES registry', () => {
  it('exposes exactly the three profiles, node-ts first', () => {
    expect(STACK_PROFILES.map((profile) => profile.id)).toEqual([
      'node-ts',
      'dotnet',
      'python',
    ]);
  });

  it('resolves each profile by id', () => {
    for (const profile of STACK_PROFILES) {
      expect(getStackProfile(profile.id)).toBe(profile);
    }
  });

  it('throws for an id that is not in the registry', () => {
    expect(() =>
      getStackProfile('rust' as (typeof STACK_PROFILES)[number]['id']),
    ).toThrow('Unknown stack profile: rust');
  });

  it('gives every profile a non-empty toolchain probe and install hint', () => {
    for (const profile of STACK_PROFILES) {
      expect(profile.toolchain.probe.trim()).not.toBe('');
      expect(profile.toolchain.installHint.trim()).not.toBe('');
      expect(profile.toolchain.minVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('pins ddd-architecture as the shared domain skill', () => {
    for (const profile of STACK_PROFILES) {
      expect(profile.skills.domain).toBe('ddd-architecture');
    }
  });
});

/**
 * The regression bar. Every assertion here is a restatement of what the
 * pre-registry detectors did for TypeScript workspaces; if one of these fails,
 * existing users' behaviour has changed.
 */
describe('node-ts profile (regression bar)', () => {
  const profile = getStackProfile('node-ts');

  it('detects on package.json alone, as the old probes did', () => {
    expect(profile.detect.manifests).toEqual(['package.json']);
    expect(profile.detect.globs).toEqual([]);
  });

  it('keeps the emptiness check source extensions verbatim', () => {
    expect(profile.detect.sourceExtensions).toEqual([
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
    ]);
  });

  it('reports TypeScript as its language', () => {
    expect(profile.language).toBe('TypeScript');
  });

  it('reproduces the intake stack vocabulary', () => {
    expect(profile.stackOptions.map((option) => option.value)).toEqual([
      'recommend',
      'angular-nestjs',
      'react-nestjs',
      'other',
    ]);
  });

  it('keeps the saas-workspace-initializer Stage A wiring', () => {
    expect(profile.skills.initializer).toBe('saas-workspace-initializer');
    expect(profile.skills.architect).toBe('nx-workspace-architect');
    expect(profile.requiredPlugins).toEqual(['ptah-nx-saas']);
  });
});

describe('matchesStackGlob', () => {
  it('matches a *.ext pattern by suffix', () => {
    expect(matchesStackGlob('*.csproj', 'MyApp.csproj')).toBe(true);
    expect(matchesStackGlob('*.csproj', 'MyApp.fsproj')).toBe(false);
  });

  it('matches case-insensitively, because Windows paths are', () => {
    expect(matchesStackGlob('*.sln', 'MyApp.SLN')).toBe(true);
  });

  it('refuses a bare extension with no stem', () => {
    expect(matchesStackGlob('*.sln', '.sln')).toBe(false);
  });

  it('treats a pattern without a wildcard as an exact name', () => {
    expect(matchesStackGlob('global.json', 'global.json')).toBe(true);
    expect(matchesStackGlob('global.json', 'globals.json')).toBe(false);
  });
});

describe('matchesStackProfile', () => {
  it.each([
    ['node-ts', NODE_TS_ROOT],
    ['dotnet', DOTNET_SOLUTION_ROOT],
    ['dotnet', DOTNET_CPM_ROOT],
    ['python', PYTHON_UV_ROOT],
    ['python', PYTHON_LEGACY_ROOT],
  ] as const)('matches %s against its own fixture root', (id, root) => {
    expect(matchesStackProfile(getStackProfile(id), root)).toBe(true);
  });

  it('does not match .NET on a Node workspace', () => {
    expect(matchesStackProfile(getStackProfile('dotnet'), NODE_TS_ROOT)).toBe(
      false,
    );
  });

  it('does not match Python on a .NET solution', () => {
    expect(
      matchesStackProfile(getStackProfile('python'), DOTNET_SOLUTION_ROOT),
    ).toBe(false);
  });

  it('ignores source extensions when deciding the stack', () => {
    // A stray script is not a project. This is the rule that stops one `.py`
    // file in a TypeScript repo from routing the user to Python scaffolding.
    expect(
      matchesStackProfile(getStackProfile('python'), [
        'package.json',
        'tool.py',
      ]),
    ).toBe(false);
  });

  it('recognises every .NET project-file extension', () => {
    for (const projectFile of [
      'App.csproj',
      'App.fsproj',
      'App.vbproj',
      'App.sln',
      'App.slnx',
    ]) {
      expect(
        matchesStackProfile(getStackProfile('dotnet'), [projectFile]),
      ).toBe(true);
    }
  });

  it('recognises every Python manifest', () => {
    for (const manifest of [
      'pyproject.toml',
      'requirements.txt',
      'setup.py',
      'setup.cfg',
      'Pipfile',
      'uv.lock',
      'poetry.lock',
    ]) {
      expect(matchesStackProfile(getStackProfile('python'), [manifest])).toBe(
        true,
      );
    }
  });
});

describe('detectStackProfiles', () => {
  it('returns nothing for an empty root', () => {
    expect(detectStackProfiles([])).toEqual([]);
  });

  it('returns every matching profile, in registry order', () => {
    const mixed = ['package.json', 'MyApp.sln', 'pyproject.toml'];
    expect(detectStackProfiles(mixed).map((profile) => profile.id)).toEqual([
      'node-ts',
      'dotnet',
      'python',
    ]);
  });

  it('returns only .NET for a solution-only workspace', () => {
    expect(
      detectStackProfiles(DOTNET_SOLUTION_ROOT).map((profile) => profile.id),
    ).toEqual(['dotnet']);
  });
});

describe('derived unions', () => {
  it('unions source extensions without duplicates', () => {
    expect(STACK_SOURCE_EXTENSIONS).toEqual([
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.cs',
      '.fs',
      '.vb',
      '.py',
    ]);
  });

  it('unions manifest filenames without duplicates', () => {
    expect(new Set(STACK_MANIFEST_FILES).size).toBe(
      STACK_MANIFEST_FILES.length,
    );
    expect(STACK_MANIFEST_FILES).toContain('package.json');
    expect(STACK_MANIFEST_FILES).toContain('Directory.Packages.props');
    expect(STACK_MANIFEST_FILES).toContain('uv.lock');
  });

  it('omits glob-shaped rules, which are not filenames', () => {
    expect(STACK_MANIFEST_FILES).not.toContain('*.sln');
  });
});
