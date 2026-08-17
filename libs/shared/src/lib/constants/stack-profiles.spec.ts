import {
  NEW_PROJECT_PLATFORM_VALUES,
  NEW_PROJECT_STACK_VALUES,
  isNewProjectStack,
} from '../types/rpc/rpc-harness.types';
import {
  PLATFORM_AGNOSTIC_STACK_OPTIONS,
  STACK_MANIFEST_FILES,
  STACK_PROFILES,
  STACK_SOURCE_EXTENSIONS,
  detectStackProfiles,
  getStackProfile,
  matchesStackGlob,
  matchesStackProfile,
  resolveStackProfileForPlatform,
  stackLabelForPlatform,
  stackOptionsForPlatform,
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

  it('only asks about the workspace tool where there is something to ask', () => {
    // `given` means the stack's own scaffolding settles it; `ask` means the
    // tool is layered on top and the answer is per-project. Only .NET is the
    // latter, and node-ts being `given` is what keeps its seed prompt as it was.
    expect(
      STACK_PROFILES.map((profile) => [
        profile.id,
        profile.workspace.monorepoDecision,
      ]),
    ).toEqual([
      ['node-ts', 'given'],
      ['dotnet', 'ask'],
      ['python', 'given'],
    ]);
  });

  it('never marks a stack `ask` when it has no tool to argue about', () => {
    for (const profile of STACK_PROFILES) {
      if (profile.workspace.monorepoTool === 'none') {
        expect(profile.workspace.monorepoDecision).toBe('given');
      }
    }
  });
});

/**
 * The drift guard that replaced the two hand-written label mirrors. Before
 * this, `NEW_PROJECT_STACK_OPTIONS` (frontend chips) and `STACK_LABELS`
 * (backend prompt) each carried their own copy of these values and agreed only
 * because someone checked.
 */
describe('intake vocabulary parity', () => {
  it('offers exactly the registered platforms, plus `other`', () => {
    expect(NEW_PROJECT_PLATFORM_VALUES).toEqual([
      ...STACK_PROFILES.map((profile) => profile.id),
      'other',
    ]);
  });

  it('lists every profile chip value on the wire union', () => {
    for (const profile of STACK_PROFILES) {
      for (const option of profile.stackOptions) {
        expect(isNewProjectStack(option.value)).toBe(true);
      }
    }
  });

  it('has no wire stack value that no profile offers', () => {
    const offered = new Set(
      [...STACK_PROFILES, { stackOptions: PLATFORM_AGNOSTIC_STACK_OPTIONS }]
        .flatMap((profile) => [...profile.stackOptions])
        .map((option) => option.value),
    );
    expect([...NEW_PROJECT_STACK_VALUES].sort()).toEqual([...offered].sort());
  });

  it('gives every profile the two platform-independent chips', () => {
    // `recommend` is what `selectPlatform` resets to, so a profile missing it
    // would leave the intake on a stack with no chip on screen.
    for (const profile of STACK_PROFILES) {
      const values = profile.stackOptions.map((option) => option.value);
      expect(values).toContain('recommend');
      expect(values).toContain('other');
    }
  });
});

describe('platform → profile resolution', () => {
  it('treats an absent platform as node-ts', () => {
    // Absence is what every client that predates the platform question sends.
    expect(resolveStackProfileForPlatform(undefined)).toBe(
      getStackProfile('node-ts'),
    );
  });

  it('resolves each registered platform to its own profile', () => {
    for (const profile of STACK_PROFILES) {
      expect(resolveStackProfileForPlatform(profile.id)).toBe(profile);
    }
  });

  it('resolves `other` to no profile at all, not to node-ts', () => {
    // "None of these" is an answer. Falling back to node-ts would scaffold an
    // Nx/TypeScript workspace for someone who just declined it.
    expect(resolveStackProfileForPlatform('other')).toBeNull();
  });
});

describe('platform → stack chip derivation', () => {
  it('renders each platform its own chips, from the registry', () => {
    for (const profile of STACK_PROFILES) {
      expect(stackOptionsForPlatform(profile.id)).toBe(profile.stackOptions);
    }
  });

  it('falls back to the two platform-independent chips for `other`', () => {
    expect(
      stackOptionsForPlatform('other').map((option) => option.value),
    ).toEqual(['recommend', 'other']);
  });

  it('gives .NET the ASP.NET chips and no Node ones', () => {
    const values = stackOptionsForPlatform('dotnet').map(
      (option) => option.value,
    );
    expect(values).toContain('aspnetcore-blazor');
    expect(values).not.toContain('angular-nestjs');
  });

  it('labels a stack under its own platform', () => {
    expect(stackLabelForPlatform('dotnet', 'aspnetcore-api')).toBe(
      'ASP.NET Core API only',
    );
    expect(stackLabelForPlatform(undefined, 'angular-nestjs')).toBe(
      'Angular + NestJS',
    );
  });

  it('degrades to the raw value when the pairing is impossible', () => {
    // A .NET chip value under the Node platform cannot come from the UI, but a
    // hand-built RPC payload can carry it — better readable than `undefined`.
    expect(stackLabelForPlatform('node-ts', 'aspnetcore-api')).toBe(
      'aspnetcore-api',
    );
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
