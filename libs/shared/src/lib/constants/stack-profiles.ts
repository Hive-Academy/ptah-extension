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
  StackOption,
  StackProfile,
  StackProfileId,
} from '../types/stack-profile.types';
import type { NewProjectPlatform } from '../types/rpc/rpc-harness.types';

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
    // `given`, because the scaffold command IS Nx — you do not add Nx to a
    // workspace `create-nx-workspace` just made. Asking would be a new
    // question in an existing flow, which is exactly the behaviour change the
    // node-ts entry exists to prevent.
    monorepoDecision: 'given',
    nxPlugins: ['@nx/js'],
    scaffoldCommands: ['npx create-nx-workspace@latest'],
  },
  skills: {
    initializer: 'saas-workspace-initializer',
    architect: 'nx-workspace-architect',
    domain: 'ddd-architecture',
  },
  requiredPlugins: ['ptah-nx-saas'],
  // THE intake vocabulary for this stack. `NEW_PROJECT_STACK_OPTIONS`
  // (frontend chips) and `STACK_LABELS` (backend prompt rendering) used to
  // mirror this list and both were deleted; the chips and the prompt now read
  // these labels directly, so there is nothing left to drift.
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
    // The one `ask` in the registry. `dotnet new sln` stands on its own and Nx
    // goes on top of it, so whether it should is a property of the project,
    // not of the language.
    monorepoDecision: 'ask',
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
    // `given` because there is nothing to decide: with no first-party Nx
    // plugin, uv workspaces are the only honest answer, so raising the
    // question would offer a choice Ptah cannot follow through on.
    monorepoDecision: 'given',
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
 * The stack chips offered when no profile applies — the `other` platform.
 *
 * Only the two platform-independent values survive: defer to the agent, or
 * describe it yourself. Anything more would be guessing at a stack we have
 * just been told we do not know.
 */
export const PLATFORM_AGNOSTIC_STACK_OPTIONS: readonly StackOption[] = [
  { value: 'recommend', label: 'Recommend for me' },
  { value: 'other', label: 'Other' },
];

/**
 * The profile behind an intake's platform answer, or `null` when there is none.
 *
 * `undefined` maps to `node-ts`: absence on the wire means the client predates
 * the platform question, and every such client meant Node/TypeScript. `other`
 * maps to `null` — deliberately not to `node-ts`, because "none of these" is an
 * answer, not a missing one.
 *
 * Unlike {@link getStackProfile} this never throws: its input is a wire value,
 * and a wire value that does not resolve is a `null`, not a bug.
 */
export function resolveStackProfileForPlatform(
  platform: NewProjectPlatform | undefined,
): StackProfile | null {
  if (platform === 'other') {
    return null;
  }
  const id = platform ?? 'node-ts';
  return STACK_PROFILES.find((candidate) => candidate.id === id) ?? null;
}

/**
 * The stack chips to render for a platform answer.
 *
 * This is the whole platform-to-stack derivation: pick the profile, hand back
 * its `stackOptions`. There is no second list anywhere.
 */
export function stackOptionsForPlatform(
  platform: NewProjectPlatform | undefined,
): readonly StackOption[] {
  return (
    resolveStackProfileForPlatform(platform)?.stackOptions ??
    PLATFORM_AGNOSTIC_STACK_OPTIONS
  );
}

/**
 * The label a stack value carries under a given platform, falling back to the
 * raw value so an unknown pairing degrades to something readable rather than
 * to `undefined`.
 */
export function stackLabelForPlatform(
  platform: NewProjectPlatform | undefined,
  stack: string,
): string {
  const options = stackOptionsForPlatform(platform);
  return options.find((option) => option.value === stack)?.label ?? stack;
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
