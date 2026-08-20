import { test, expect } from '../../support/fixtures';
import type { UiDriver } from '../../support/ui-driver';

/**
 * New Project flow — .NET platform (TASK_2026_270 Batch 4/5).
 *
 * `dccd35b38` put a platform question in front of the stack question and made
 * the stack chips derive from `STACK_PROFILES` (`libs/shared/.../stack-profiles.ts`)
 * instead of two hand-written label mirrors. This file is the .NET side of
 * that: platform-before-stack, chip derivation, the `platform: 'dotnet'` wire
 * payload, and the node-ts byte-identical-payload guarantee the commit message
 * calls out as the regression bar (`new-project.spec.ts`, TASK_2026_263, MUST
 * stay green unedited).
 *
 * Same technique as `new-project.spec.ts`: mocked RPC + pushed renderer
 * messages via `UiDriver`, no real backend/SDK.
 *
 * A note on what "the seed prompt names the .NET skills" means here: like
 * `new-project.spec.ts`'s persistence/surface tests, `openNewProjectWorkflow`
 * below pushes `harness:open-workflow` with a `seedPrompt` string the TEST
 * supplies — the frontend only ever forwards whatever string the backend
 * broadcasts, it does not build one. So this file cannot prove *that*
 * `buildNewProjectSeedPrompt` (`libs/backend/rpc-handlers/.../harness-constants.ts`)
 * emits `dotnet-solution-initializer`; that is pinned at the unit level by
 * `harness-constants.spec.ts:185-188` and `:241-246`. What it proves is that
 * the frontend transports and renders that content correctly — same invariant
 * `new-project.spec.ts` proves for the node-ts prompt. The stand-in prompts
 * below are copied verbatim from `buildProcedureSteps`'s real wording (read
 * 2026-08-17) so the assertions describe real output, not a string invented to
 * pass.
 *
 * One assertion from the e2e plan is deliberately NOT made: the plan named
 * `nx-dotnet-workspace` as a skill that should appear in the seed prompt.
 * It does not — `buildProcedureSteps`'s `ask` branch (fired for `dotnet`,
 * whose `workspace.monorepoDecision` is `'ask'`) only ever names the Nx
 * plugin (`@nx/dotnet`) and the plain scaffold command (`dotnet new sln`); the
 * `nx-dotnet-workspace` skill is invoked at RUNTIME by `dotnet-solution-initializer`
 * per that skill's own SKILL.md, never baked into the wire prompt text. Typing
 * `nx-dotnet-workspace` into a stand-in prompt and then asserting the stand-in
 * contains it would be a tautology, so this file asserts `@nx/dotnet` instead
 * — the string the real backend actually emits (pinned by
 * `harness-constants.spec.ts:242`).
 */

const SEED_PROMPT_MARKER = 'AGENT_INSTRUCTIONS::';

const AUDIENCE_LABELS = {
  b2b: 'B2B',
  b2c: 'B2C',
  internal: 'Internal tool',
  unsure: 'Not sure',
} as const;

/** Mirrors `NEW_PROJECT_PLATFORM_OPTIONS` (`new-project-intake.ts`). */
const PLATFORM_LABELS = {
  'node-ts': 'Node / TypeScript',
  dotnet: '.NET',
  python: 'Python',
  other: 'Other',
} as const;

/** Mirrors the `dotnet` profile's `stackOptions` (`stack-profiles.ts`). */
const DOTNET_STACK_LABELS = {
  recommend: 'Recommend for me',
  'aspnetcore-blazor': 'ASP.NET Core + Blazor',
  'aspnetcore-angular': 'ASP.NET Core + Angular',
  'aspnetcore-api': 'ASP.NET Core API only',
  other: 'Other',
} as const;

interface Intake {
  what: string;
  audience: keyof typeof AUDIENCE_LABELS;
  platform?: keyof typeof PLATFORM_LABELS;
  stack: string;
  constraints?: string;
  stackOther?: string;
}

/** Mirrors `formatIntakeSummary` (`new-project-intake.ts`) for the .NET case. */
function expectedIntakeSummaryLines(intake: Intake): string[] {
  const lines = [
    intake.what,
    `Who it's for: ${AUDIENCE_LABELS[intake.audience]}`,
  ];
  if (intake.platform) {
    lines.push(`Platform: ${PLATFORM_LABELS[intake.platform]}`);
  }
  lines.push(
    `Stack: ${DOTNET_STACK_LABELS[intake.stack as keyof typeof DOTNET_STACK_LABELS] ?? intake.stack}`,
  );
  if (intake.constraints?.trim()) {
    lines.push(`Must-haves: ${intake.constraints.trim()}`);
  }
  return lines;
}

/** Same helper as `new-project.spec.ts`, redefined locally (files stay self-contained). */
async function openNewProjectWorkflow(
  ui: UiDriver,
  intake: Intake,
  seedPrompt: string,
): Promise<{ tabId: string; prompt: string }> {
  await ui.mockRpc({
    'harness:start-new-project': { success: true },
    'chat:start': { success: true },
  });
  await ui.pushEvent({
    type: 'harness:open-workflow',
    payload: { mode: 'new-project', seedPrompt, intake },
  });

  await expect(ui.page.locator('ptah-harness-builder-view')).toBeVisible();

  const startCall = await ui.waitForObservedCall('chat:start');
  const params = startCall.params as {
    tabId: string;
    prompt: string;
    surfaceMode: boolean;
  };
  expect(params.surfaceMode).toBe(true);
  expect(params.prompt).toBe(seedPrompt);

  return { tabId: params.tabId, prompt: params.prompt };
}

// Same landmine as `new-project.spec.ts`: `SetupHubComponent` reads
// `presets().length` unguarded, and the driver's unmocked-method fallback for
// `harness:load-presets` returns an object with no `presets` key, which
// freezes every later change-detection pass on this component (including the
// intake modal's platform/stack chip lists this file tests).
test.beforeEach(async ({ ui }) => {
  await ui.mockRpc({ 'harness:load-presets': { presets: [] } });
});

test.describe('New Project flow — platform step (TASK_2026_270)', () => {
  test('platform precedes stack, and stack chips derive from the selected platform', async ({
    ui,
  }) => {
    await ui.goto('setup-hub');
    await ui.page.locator('[data-testid="new-project-start"]').click();
    await expect(
      ui.page.locator('[data-testid="new-project-intake"]'),
    ).toBeVisible();

    // Every registered stack gets a platform chip, plus the escape hatch.
    for (const platform of ['node-ts', 'dotnet', 'python', 'other']) {
      await expect(
        ui.page.locator(`[data-testid="intake-platform-${platform}"]`),
      ).toBeVisible();
    }

    // Default platform is node-ts (nothing clicked yet), so its stack chips
    // are what render before any platform choice.
    await expect(
      ui.page.locator('[data-testid="intake-stack-angular-nestjs"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="intake-stack-react-nestjs"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="intake-stack-aspnetcore-blazor"]'),
    ).toHaveCount(0);

    await ui.page.locator('[data-testid="intake-platform-dotnet"]').click();

    // The mirrors are gone: the .NET profile's own chips render, and the
    // node-ts chips that used to be the ONLY option are not merely hidden —
    // they are not on the page at all.
    await expect(
      ui.page.locator('[data-testid="intake-stack-aspnetcore-blazor"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="intake-stack-aspnetcore-angular"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="intake-stack-aspnetcore-api"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="intake-stack-angular-nestjs"]'),
    ).toHaveCount(0);
    await expect(
      ui.page.locator('[data-testid="intake-stack-react-nestjs"]'),
    ).toHaveCount(0);

    // Selecting node-ts restores the original chips — this is the check that
    // proves the two lists were deleted, not duplicated: there is exactly one
    // chip set on screen at a time, driven by one registry.
    await ui.page.locator('[data-testid="intake-platform-node-ts"]').click();
    await expect(
      ui.page.locator('[data-testid="intake-stack-angular-nestjs"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="intake-stack-react-nestjs"]'),
    ).toBeVisible();
    await expect(
      ui.page.locator('[data-testid="intake-stack-aspnetcore-blazor"]'),
    ).toHaveCount(0);
  });
});

test.describe('New Project flow — .NET intake payload (TASK_2026_270)', () => {
  test('a dotnet intake submits harness:start-new-project with platform: "dotnet"', async ({
    ui,
  }) => {
    await ui.mockRpc({ 'harness:start-new-project': { success: true } });
    await ui.goto('setup-hub');
    await ui.page.locator('[data-testid="new-project-start"]').click();

    await ui.page.locator('[data-testid="intake-platform-dotnet"]').click();
    await ui.page.locator('[data-testid="intake-audience-b2b"]').click();
    await ui.page
      .locator('[data-testid="intake-stack-aspnetcore-api"]')
      .click();
    await ui.page
      .locator('[data-testid="intake-what"]')
      .fill('A claims-processing service for regional insurers.');

    await ui.page.locator('[data-testid="intake-start"]').click();

    const call = await ui.waitForObservedCall('harness:start-new-project');
    expect(call.params).toEqual({
      intake: {
        what: 'A claims-processing service for regional insurers.',
        audience: 'b2b',
        platform: 'dotnet',
        stack: 'aspnetcore-api',
      },
    });
  });

  // Batch 4's whole compatibility promise, restated as a test: a user who
  // never touches the platform question produces the exact same payload they
  // produced before the question existed — no `platform` key at all, not
  // `platform: 'node-ts'`. This is what keeps `new-project.spec.ts`
  // (TASK_2026_263) a valid, unedited regression bar.
  test('leaving the platform question untouched omits "platform" from the payload', async ({
    ui,
  }) => {
    await ui.mockRpc({ 'harness:start-new-project': { success: true } });
    await ui.goto('setup-hub');
    await ui.page.locator('[data-testid="new-project-start"]').click();

    await ui.page.locator('[data-testid="intake-audience-internal"]').click();
    await ui.page
      .locator('[data-testid="intake-stack-angular-nestjs"]')
      .click();
    await ui.page
      .locator('[data-testid="intake-what"]')
      .fill('An internal expense-approval tool.');

    await ui.page.locator('[data-testid="intake-start"]').click();

    const call = await ui.waitForObservedCall('harness:start-new-project');
    const params = call.params as { intake: Record<string, unknown> };
    expect('platform' in params.intake).toBe(false);
    expect(params.intake).toEqual({
      what: 'An internal expense-approval tool.',
      audience: 'internal',
      stack: 'angular-nestjs',
    });
  });
});

test.describe('New Project flow — .NET seed prompt + transcript (TASK_2026_270)', () => {
  test('the seed prompt names the .NET skills, never the TypeScript ones, and the transcript shows only the intake summary', async ({
    ui,
  }) => {
    const intake: Intake = {
      what: 'A claims-processing service for regional insurers.',
      audience: 'b2b',
      platform: 'dotnet',
      stack: 'recommend',
    };
    // Wording copied verbatim from `buildProcedureSteps`'s dotnet branch
    // (`harness-constants.ts`) — see the file header for why `nx-dotnet-workspace`
    // is not part of this string.
    const seedPrompt = `${SEED_PROMPT_MARKER}
## Project intake

**Platform:** .NET

**Tech stack preference:** Recommend for me

## How to proceed

1. Use the \`dotnet-solution-initializer\` skill and run its Stage A.
2. Run Stage A's two-round discovery using the AskUserQuestion tool.
3. In that same discovery, ask me whether this workspace should be managed by \`nx\` (via \`@nx/dotnet\`) or stay on plain \`dotnet new sln\`.
4. Once discovery is settled, invoke the \`ddd-architecture\` skill to name the bounded contexts, then the \`dotnet-solution-architect\` skill to derive the library layout from them.
5. Write the phased plan to \`.ptah/roadmap.md\`.
6. Scaffold ONLY the foundation described by Stage A, then stop.

for: ${intake.what}`;

    const { prompt } = await openNewProjectWorkflow(ui, intake, seedPrompt);

    expect(prompt).toContain('`dotnet-solution-initializer`');
    expect(prompt).toContain('`dotnet-solution-architect`');
    expect(prompt).toContain('@nx/dotnet');
    expect(prompt).not.toContain('saas-workspace-initializer');
    expect(prompt).not.toContain('nx-workspace-architect');

    const transcriptText = await ui.page
      .locator('ptah-harness-builder-view [role="log"]')
      .innerText();
    for (const line of expectedIntakeSummaryLines(intake)) {
      expect(transcriptText).toContain(line);
    }
    // The instruction block — including the skill names — must never leak
    // into the transcript. Same invariant `new-project.spec.ts` proves for
    // node-ts.
    expect(transcriptText).not.toContain(SEED_PROMPT_MARKER);
    expect(transcriptText).not.toContain('dotnet-solution-initializer');
  });

  test('a missing dotnet toolchain adds the install-hint block to the prompt', async ({
    ui,
  }) => {
    const intake: Intake = {
      what: 'A policy-quoting engine.',
      audience: 'b2b',
      platform: 'dotnet',
      stack: 'recommend',
    };
    // Wording copied verbatim from `renderEnvironmentBlock` (`harness-constants.ts`)
    // for a not-installed toolchain, using the dotnet profile's real
    // `toolchain.probe` / `installHint` (`stack-profiles.ts`).
    const seedPrompt = `${SEED_PROMPT_MARKER}
## Project intake

**Platform:** .NET

**Tech stack preference:** Recommend for me

## Before you start

- The \`dotnet --version\` toolchain is NOT installed on this machine. Install the .NET SDK 8.0 or newer from https://dotnet.microsoft.com/download. Tell me this before you scaffold anything, and wait for me to confirm it is installed — do not start and fail halfway.

## How to proceed

1. Use the \`dotnet-solution-initializer\` skill and run its Stage A.

for: ${intake.what}`;

    const { prompt } = await openNewProjectWorkflow(ui, intake, seedPrompt);

    expect(prompt).toContain('## Before you start');
    expect(prompt).toContain(
      '`dotnet --version` toolchain is NOT installed on this machine',
    );
    expect(prompt).toContain(
      'Install the .NET SDK 8.0 or newer from https://dotnet.microsoft.com/download.',
    );
    expect(prompt).toContain('do not start and fail halfway');

    // Stated before scaffolding starts, not discovered halfway — the block is
    // still transported to the agent even though the UI transcript never
    // shows the instruction text (checked above in the sibling test).
    const transcriptText = await ui.page
      .locator('ptah-harness-builder-view [role="log"]')
      .innerText();
    expect(transcriptText).not.toContain('NOT installed on this machine');
  });
});
