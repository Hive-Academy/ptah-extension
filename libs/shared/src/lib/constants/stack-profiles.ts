/**
 * `STACK_PROFILES` — the stack registry every language detector reads.
 *
 * See `stack-profile.types.ts` for why this table exists. The rules for
 * changing it:
 *
 * 1. **`node-ts` is a regression bar, not a design space.** Its `detect` rules
 *    reproduce, exactly, what the pre-registry detectors did for TypeScript
 *    workspaces (`package.json`; `.ts`/`.tsx`/`.js`/`.jsx` as source), and its
 *    `stackOptions` reproduce the intake chips. Broadening it is a behaviour
 *    change for every existing user and needs its own justification —
 *    `dotnet` and `python` are where new coverage belongs.
 * 2. **Order is meaningful.** Detectors iterate this array, so the order here
 *    is the order languages appear in an agent prompt. `node-ts` stays first.
 * 3. **No I/O, no imports.** This module is imported by frontend and backend
 *    alike; it must stay pure data plus pure predicates.
 */

import type {
  StackProfile,
  StackProfileId,
} from '../types/stack-profile.types';

/**
 * Node / TypeScript.
 *
 * Every rule below is inherited, not invented. `detect.manifests` is
 * `package.json` because that is the only file the harness probe and
 * `ProjectDetectorService` ever tested. `sourceExtensions` is the TypeScript
 * slice of the emptiness check's old inline array — verbatim, including the
 * absence of `.mjs`/`.cjs`.
 */
const NODE_TS_PROFILE: StackProfile = {
  id: 'node-ts',
  label: 'Node / TypeScript',
  language: 'TypeScript',
  detect: {
    manifests: ['package.json'],
    globs: [],
    sourceExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  toolchain: {
    probe: 'node --version',
    minVersion: '20.0.0',
    installHint: 'Install Node.js 20 or newer from https://nodejs.org.',
  },
  workspace: {
    monorepoTool: 'nx',
    nxPlugins: ['@nx/js'],
    scaffoldCommands: ['npx create-nx-workspace@latest'],
  },
  skills: {
    initializer: 'saas-workspace-initializer',
    architect: 'nx-workspace-architect',
    domain: 'ddd-architecture',
  },
  requiredPlugins: ['ptah-nx-saas'],
  // Mirrors NEW_PROJECT_STACK_OPTIONS (frontend intake chips) and STACK_LABELS
  // (backend prompt rendering). Both mirrors are deleted in Batch 4, which
  // makes this the only copy; until then `stack-profiles.spec.ts` pins the
  // values so the three cannot drift apart in the meantime.
  stackOptions: [
    { value: 'recommend', label: 'Recommend for me' },
    { value: 'angular-nestjs', label: 'Angular + NestJS' },
    { value: 'react-nestjs', label: 'React + NestJS' },
    { value: 'other', label: 'Other' },
  ],
};

/**
 * .NET (C# / F# / VB).
 *
 * `globs` rather than `manifests` for the project files because .NET names
 * them after the project (`MyApp.csproj`), which is precisely the shape the old
 * detectors could not express and why a solution-only workspace read as empty.
 *
 * `monorepoTool: 'nx'` is a default for the *question*, not an answer:
 * `@nx/dotnet` is officially experimental, so a single service should stay on
 * plain `dotnet new sln`.
 */
const DOTNET_PROFILE: StackProfile = {
  id: 'dotnet',
  label: '.NET',
  language: '.NET',
  detect: {
    manifests: [
      'global.json',
      'Directory.Build.props',
      'Directory.Packages.props',
    ],
    globs: ['*.sln', '*.slnx', '*.csproj', '*.fsproj', '*.vbproj'],
    sourceExtensions: ['.cs', '.fs', '.vb'],
  },
  toolchain: {
    probe: 'dotnet --version',
    // @nx/dotnet ships an MSBuild analyzer that requires the 8.0 SDK, and it is
    // the lowest SDK still in support. Below this, scaffolding is not viable.
    minVersion: '8.0.0',
    installHint:
      'Install the .NET SDK 8.0 or newer from https://dotnet.microsoft.com/download.',
  },
  workspace: {
    monorepoTool: 'nx',
    nxPlugins: ['@nx/dotnet'],
    scaffoldCommands: ['dotnet new sln'],
  },
  skills: {
    initializer: 'dotnet-solution-initializer',
    architect: 'dotnet-solution-architect',
    domain: 'ddd-architecture',
  },
  // `ptah-dotnet` is Ptah's own glue plugin (Batch 3); `dotnet/skills` is
  // Microsoft's marketplace, installed through the external-marketplace path
  // (Batch 2) with explicit user consent. Ptah owns discovery and layout;
  // Microsoft owns `dotnet new`, testing, EF and MSBuild.
  requiredPlugins: [
    'ptah-dotnet',
    { marketplace: 'dotnet/skills', plugin: 'dotnet' },
    { marketplace: 'dotnet/skills', plugin: 'dotnet-template-engine' },
  ],
  stackOptions: [
    { value: 'recommend', label: 'Recommend for me' },
    { value: 'aspnetcore-blazor', label: 'ASP.NET Core + Blazor' },
    { value: 'aspnetcore-angular', label: 'ASP.NET Core + Angular' },
    { value: 'aspnetcore-api', label: 'ASP.NET Core API only' },
    { value: 'other', label: 'Other' },
  ],
};

/**
 * Python.
 *
 * `monorepoTool: 'none'` because Python has no first-party Nx plugin —
 * `@nxlv/python` is community-maintained, so uv workspaces are the honest
 * default. The initializer/architect skills named here ship with the Python
 * glue plugin; until that plugin exists `requiredPlugins` is empty and the
 * generic Stage A contract applies, which is why nothing routes to them yet.
 */
const PYTHON_PROFILE: StackProfile = {
  id: 'python',
  label: 'Python',
  language: 'Python',
  detect: {
    manifests: [
      'pyproject.toml',
      'requirements.txt',
      'setup.py',
      'setup.cfg',
      'Pipfile',
      'uv.lock',
      'poetry.lock',
    ],
    globs: [],
    sourceExtensions: ['.py'],
  },
  toolchain: {
    probe: 'python --version',
    minVersion: '3.10.0',
    installHint:
      'Install Python 3.10 or newer from https://www.python.org/downloads.',
  },
  workspace: {
    monorepoTool: 'none',
    nxPlugins: [],
    scaffoldCommands: ['uv init'],
  },
  skills: {
    initializer: 'python-workspace-initializer',
    architect: 'python-workspace-architect',
    domain: 'ddd-architecture',
  },
  requiredPlugins: [],
  stackOptions: [
    { value: 'recommend', label: 'Recommend for me' },
    { value: 'fastapi', label: 'FastAPI' },
    { value: 'django', label: 'Django' },
    { value: 'flask', label: 'Flask' },
    { value: 'other', label: 'Other' },
  ],
};

/**
 * The registry. Iteration order is the order languages are reported, so
 * `node-ts` stays first — that is what keeps a TypeScript workspace's language
 * list byte-identical to what it was before the registry existed.
 */
export const STACK_PROFILES: readonly StackProfile[] = [
  NODE_TS_PROFILE,
  DOTNET_PROFILE,
  PYTHON_PROFILE,
];

/**
 * Look a profile up by id.
 *
 * Throws rather than returning `undefined`: `StackProfileId` is a closed union,
 * so a miss means the registry and the union have drifted — a programming
 * error every caller would otherwise have to re-narrow for no benefit.
 */
export function getStackProfile(id: StackProfileId): StackProfile {
  const profile = STACK_PROFILES.find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error(`Unknown stack profile: ${id}`);
  }
  return profile;
}

/**
 * Match one filename against one `detect.globs` entry.
 *
 * Deliberately not a glob engine. Every pattern in the registry is either a
 * literal name or a `*.ext` suffix, and keeping the matcher to those two shapes
 * is what lets this module stay dependency-free. A pattern needing more than
 * that belongs in `manifests`, or the pattern is wrong.
 */
export function matchesStackGlob(pattern: string, fileName: string): boolean {
  if (pattern.startsWith('*')) {
    const suffix = pattern.slice(1);
    return (
      fileName.length > suffix.length &&
      fileName.toLowerCase().endsWith(suffix.toLowerCase())
    );
  }
  return fileName === pattern;
}

/**
 * Does this set of root filenames declare the given stack?
 *
 * Reads `manifests` and `globs` only. `sourceExtensions` is deliberately NOT
 * consulted: a stray `.py` file in a TypeScript repo must not make it a Python
 * project. Callers that want "is there any source here at all" (emptiness
 * checks) read `sourceExtensions` themselves.
 */
export function matchesStackProfile(
  profile: StackProfile,
  fileNames: Iterable<string>,
): boolean {
  const manifests = new Set(profile.detect.manifests);
  for (const fileName of fileNames) {
    if (manifests.has(fileName)) {
      return true;
    }
    for (const pattern of profile.detect.globs) {
      if (matchesStackGlob(pattern, fileName)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Every profile the given root filenames declare, in registry order.
 *
 * A workspace can legitimately match several — a .NET solution with an Angular
 * frontend matches both — so this returns all of them rather than picking one.
 */
export function detectStackProfiles(
  fileNames: Iterable<string>,
): StackProfile[] {
  const names = [...fileNames];
  return STACK_PROFILES.filter((profile) =>
    matchesStackProfile(profile, names),
  );
}

/**
 * The union of every profile's source extensions, deduplicated, in registry
 * order. For emptiness checks, which ask "is there source of ANY known stack
 * here" rather than "which stack is this".
 */
export const STACK_SOURCE_EXTENSIONS: readonly string[] = [
  ...new Set(
    STACK_PROFILES.flatMap((profile) => profile.detect.sourceExtensions),
  ),
];

/**
 * The union of every profile's exact manifest filenames, deduplicated, in
 * registry order. Companion to {@link STACK_SOURCE_EXTENSIONS}; glob-shaped
 * rules are not representable here, so callers that need those must go through
 * {@link matchesStackProfile}.
 */
export const STACK_MANIFEST_FILES: readonly string[] = [
  ...new Set(STACK_PROFILES.flatMap((profile) => profile.detect.manifests)),
];
