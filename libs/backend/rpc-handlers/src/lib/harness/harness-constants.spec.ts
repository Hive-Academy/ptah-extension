import type {
  NewProjectIntake,
  ToolchainProbeResult,
} from '@ptah-extension/shared';
import { getStackProfile } from '@ptah-extension/shared';
import { buildNewProjectSeedPrompt } from './harness-constants';

const BASE_INTAKE: NewProjectIntake = {
  what: 'A booking tool for physiotherapy clinics',
  audience: 'b2b',
  stack: 'recommend',
};

const DOTNET_INTAKE: NewProjectIntake = {
  what: 'A claims processing service',
  audience: 'b2b',
  platform: 'dotnet',
  stack: 'aspnetcore-api',
};

const DOTNET_TOOLCHAIN = getStackProfile('dotnet').toolchain;

const DOTNET_MISSING: ToolchainProbeResult = {
  profileId: 'dotnet',
  command: DOTNET_TOOLCHAIN.probe,
  installed: false,
  satisfiesMin: false,
  minVersion: DOTNET_TOOLCHAIN.minVersion,
  installHint: DOTNET_TOOLCHAIN.installHint,
};

describe('buildNewProjectSeedPrompt', () => {
  it('opens with a Project intake block carrying the brief verbatim', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);

    expect(prompt).toContain('## Project intake');
    expect(prompt).toContain('A booking tool for physiotherapy clinics');
    expect(prompt.indexOf('## Project intake')).toBeLessThan(
      prompt.indexOf('## How to proceed'),
    );
  });

  it('renders each audience as a readable label rather than the wire value', () => {
    const audiences: NewProjectIntake['audience'][] = [
      'b2b',
      'b2c',
      'internal',
      'unsure',
    ];
    const labels = audiences.map((audience) =>
      buildNewProjectSeedPrompt({ ...BASE_INTAKE, audience }),
    );

    expect(labels[0]).toContain('Businesses (B2B)');
    expect(labels[1]).toContain('Consumers (B2C)');
    expect(labels[2]).toContain('Internal tool');
    expect(labels[3]).toContain('Not sure yet');
    for (const prompt of labels) {
      expect(prompt).not.toMatch(
        /Who is it for\?\*\* (b2b|b2c|internal|unsure)/,
      );
    }
  });

  it('defers the stack choice to the agent when the user has no preference', () => {
    // The label is the registry's chip label now, not a second copy of it that
    // this file used to own.
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('**Tech stack preference:** Recommend for me');
  });

  it('appends the free-text stack when the user picked Other', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      stack: 'other',
      stackOther: 'Remix + Go',
    });
    expect(prompt).toContain('Other — Remix + Go');
  });

  it('omits the stack free text when Other was not selected', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      stack: 'angular-nestjs',
      stackOther: 'stale value',
    });
    expect(prompt).toContain('Angular + NestJS');
    expect(prompt).not.toContain('stale value');
  });

  it('omits the constraints section entirely when none were given', () => {
    expect(buildNewProjectSeedPrompt(BASE_INTAKE)).not.toContain(
      'Must-haves / constraints',
    );
    expect(
      buildNewProjectSeedPrompt({
        ...BASE_INTAKE,
        constraints: 'Must run on-premise',
      }),
    ).toContain('Must run on-premise');
  });

  it('treats whitespace-only constraints as absent', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      constraints: '   \n  ',
    });
    expect(prompt).not.toContain('Must-haves / constraints');
  });

  it('mandates AskUserQuestion discovery and forbids self-answering', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('AskUserQuestion');
    expect(prompt).toContain('never answer a discovery question on my behalf');
    expect(prompt).toContain(
      'Skip any question the intake above already answers',
    );
  });

  it('omits the platform line entirely when the intake did not answer it', () => {
    // An absent platform means Node/TypeScript. Printing a line the user never
    // picked would change the prompt every existing project gets.
    expect(buildNewProjectSeedPrompt(BASE_INTAKE)).not.toContain(
      '**Platform:**',
    );
  });

  it('sequences the Stage A skills: initializer, then ddd, then nx', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    const initializer = prompt.indexOf('saas-workspace-initializer');
    const ddd = prompt.indexOf('ddd-architecture');
    const nx = prompt.indexOf('nx-workspace-architect');

    expect(initializer).toBeGreaterThan(-1);
    expect(initializer).toBeLessThan(ddd);
    expect(ddd).toBeLessThan(nx);
  });

  it('asks for the roadmap, a foundation-only scaffold, then a stop', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('.ptah/roadmap.md');
    expect(prompt).toContain('ONLY the foundation');
    expect(prompt).toContain('then stop');
  });

  it('closes with the harness design pass and a complete proposeConfig', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toContain('ptah.harness');
    expect(prompt).toContain('proposeConfig with isConfigComplete=true');
  });

  it('stays vendor-neutral so any adapter can serve it', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      constraints: 'None',
    }).toLowerCase();

    for (const vendor of [
      'claude',
      'anthropic',
      'openai',
      'codex',
      'copilot',
      'gemini',
    ]) {
      expect(prompt).not.toContain(vendor);
    }
  });

  it('numbers exactly six steps, as it did before profiles existed', () => {
    const prompt = buildNewProjectSeedPrompt(BASE_INTAKE);
    expect(prompt).toMatch(/^6\. /m);
    expect(prompt).not.toMatch(/^7\. /m);
  });
});

/**
 * The point of Batch 4: the skill names in the prompt come from the profile the
 * platform answer selected, not from three TypeScript constants.
 */
describe('buildNewProjectSeedPrompt — profile-driven skills', () => {
  it('names the .NET Stage A skills, and none of the TypeScript ones', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE);

    expect(prompt).toContain('`dotnet-solution-initializer`');
    expect(prompt).toContain('`dotnet-solution-architect`');
    expect(prompt).not.toContain('saas-workspace-initializer');
    expect(prompt).not.toContain('nx-workspace-architect');
  });

  it('keeps ddd-architecture on every platform', () => {
    for (const intake of [BASE_INTAKE, DOTNET_INTAKE]) {
      expect(buildNewProjectSeedPrompt(intake)).toContain('`ddd-architecture`');
    }
  });

  it('names the Python skills for the Python platform', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      platform: 'python',
      stack: 'fastapi',
    });

    expect(prompt).toContain('`python-workspace-initializer`');
    expect(prompt).toContain('**Tech stack preference:** FastAPI');
  });

  it('renders the chosen platform and its own stack label', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE);
    expect(prompt).toContain('**Platform:** .NET');
    expect(prompt).toContain(
      '**Tech stack preference:** ASP.NET Core API only',
    );
  });

  it('names no preset skill when the platform is one we have no profile for', () => {
    const prompt = buildNewProjectSeedPrompt({
      ...BASE_INTAKE,
      platform: 'other',
      stack: 'other',
      stackOther: 'Elixir + Phoenix',
    });

    expect(prompt).toContain('**Platform:** Other / not listed');
    expect(prompt).toContain('Other — Elixir + Phoenix');
    // The user declined every preset, so inventing one for them is the one
    // thing this branch must not do.
    expect(prompt).not.toContain('saas-workspace-initializer');
    expect(prompt).not.toContain('dotnet-solution-initializer');
    expect(prompt).toContain(
      'ask me which language, runtime and package manager',
    );
    expect(prompt).toContain('`ddd-architecture`');
  });
});

describe('buildNewProjectSeedPrompt — the workspace-tool decision', () => {
  it('tells the agent to ask about Nx during .NET discovery', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE);

    expect(prompt).toContain('In that same discovery, ask me whether');
    expect(prompt).toContain('@nx/dotnet');
    expect(prompt).toContain('`dotnet new sln`');
    // "Ask, default to Nx" — the recommendation is stated, the decision is not.
    expect(prompt).toContain('Recommend yes for a multi-project solution');
    expect(prompt).toContain('take my answer, whichever way it goes');
  });

  it('adds a seventh step for .NET and leaves the rest in order', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE);
    expect(prompt).toMatch(/^7\. /m);
    expect(prompt.indexOf('In that same discovery')).toBeLessThan(
      prompt.indexOf('`ddd-architecture`'),
    );
  });

  it('asks nothing where the tool is settled by the stack itself', () => {
    // node-ts: the scaffold command IS Nx. python: there is no Nx plugin.
    for (const intake of [
      BASE_INTAKE,
      { ...BASE_INTAKE, platform: 'python' as const, stack: 'django' as const },
    ]) {
      expect(buildNewProjectSeedPrompt(intake)).not.toContain(
        'In that same discovery, ask me whether',
      );
    }
  });
});

describe('buildNewProjectSeedPrompt — what is wrong with this machine', () => {
  it('says nothing at all when there is nothing wrong', () => {
    expect(buildNewProjectSeedPrompt(DOTNET_INTAKE, {})).not.toContain(
      '## Before you start',
    );
  });

  it('carries a missing toolchain and its install hint before any scaffolding', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE, {
      toolchain: DOTNET_MISSING,
    });

    expect(prompt).toContain('## Before you start');
    expect(prompt).toContain('`dotnet --version` toolchain is NOT installed');
    expect(prompt).toContain(DOTNET_TOOLCHAIN.installHint);
    expect(prompt).toContain('do not start and fail halfway');
    // It has to land before the instructions, or the agent reads it too late.
    expect(prompt.indexOf('## Before you start')).toBeLessThan(
      prompt.indexOf('## How to proceed'),
    );
  });

  it('distinguishes an SDK that is too old from one that is absent', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE, {
      toolchain: {
        ...DOTNET_MISSING,
        installed: true,
        version: '6.0.400',
      },
    });

    expect(prompt).toContain('reports version 6.0.400');
    expect(prompt).toContain('needs 8.0.0 or newer');
    expect(prompt).not.toContain('NOT installed');
  });

  it('treats an unreadable version as not good enough, and says so', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE, {
      toolchain: { ...DOTNET_MISSING, installed: true },
    });
    expect(prompt).toContain('did not report a version we could read');
  });

  it('names an uninstalled external plugin instead of pretending it is there', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE, {
      missingExternalPlugins: [
        { marketplace: 'dotnet/skills', plugin: 'dotnet-template-engine' },
      ],
    });

    expect(prompt).toContain('`dotnet-template-engine`');
    expect(prompt).toContain('`dotnet/skills`');
    // The consent protocol is the whole point: the agent must not route around
    // it, and the user must be told where the decision lives.
    expect(prompt).toContain('do not try to install or invoke them');
    expect(prompt).toContain('Marketplace');
    expect(prompt).toContain('carry on using only the skills you do have');
  });

  it('reports a missing toolchain and missing plugins together', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE, {
      toolchain: DOTNET_MISSING,
      missingExternalPlugins: [
        { marketplace: 'dotnet/skills', plugin: 'dotnet' },
      ],
    });

    expect(prompt).toContain('NOT installed on this machine');
    expect(prompt).toContain('are NOT installed');
  });

  it('stays vendor-neutral on the .NET path too', () => {
    const prompt = buildNewProjectSeedPrompt(DOTNET_INTAKE, {
      toolchain: DOTNET_MISSING,
      missingExternalPlugins: [
        { marketplace: 'dotnet/skills', plugin: 'dotnet' },
      ],
    }).toLowerCase();

    for (const vendor of [
      'claude',
      'anthropic',
      'openai',
      'copilot',
      'gemini',
    ]) {
      expect(prompt).not.toContain(vendor);
    }
  });
});
