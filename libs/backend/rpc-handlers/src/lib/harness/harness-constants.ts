import {
  resolveStackProfileForPlatform,
  stackLabelForPlatform,
} from '@ptah-extension/shared';
import type {
  ExternalPluginRef,
  NewProjectIntake,
  StackProfile,
  ToolchainProbeResult,
} from '@ptah-extension/shared';

export const WIZARD_VIEW_TYPE = 'ptah.setupWizard';

const AUDIENCE_LABELS: Record<NewProjectIntake['audience'], string> = {
  b2b: 'Businesses (B2B)',
  b2c: 'Consumers (B2C)',
  internal: 'Internal tool',
  unsure: 'Not sure yet',
};

/**
 * What the handler learned about the machine before composing the prompt.
 *
 * Both fields are bad news carriers, and both are optional because "nothing to
 * report" is the normal case. They exist so the agent can tell the user about a
 * gap BEFORE it starts scaffolding into it — a missing SDK discovered halfway
 * through `dotnet new` is a much worse experience than a sentence up front.
 */
export interface NewProjectPromptContext {
  /**
   * Outcome of probing the selected profile's toolchain. Absent when no probe
   * was run (see `RUNTIME_PROVIDED_PROFILE_IDS` in the handler) or when no
   * profile resolved.
   */
  readonly toolchain?: ToolchainProbeResult;
  /**
   * Required external-marketplace plugins that the consent flow has NOT
   * installed on this machine. Never installed silently — the prompt names
   * them so the agent can tell the user what is missing and where to approve
   * it, and so it does not invoke skills that are not there.
   */
  readonly missingExternalPlugins?: readonly ExternalPluginRef[];
  /**
   * Skill ids the agent can actually invoke on this machine, as the host
   * discovered them (bare directory-name slugs, the same vocabulary
   * `StackProfile.skills` uses).
   *
   * Absent means "we could not find out", and that is deliberately treated the
   * same as empty: the prompt falls back to the generic Stage A contract rather
   * than naming a skill nobody has verified is there.
   */
  readonly availableSkillIds?: readonly string[];
}

/** `owner/repo → plugin` rendered for a human. */
function renderPluginRef(ref: ExternalPluginRef): string {
  return `\`${ref.plugin}\` from the \`${ref.marketplace}\` marketplace`;
}

/**
 * Render the intake answers as a human-readable block.
 *
 * Kept separate from {@link buildNewProjectSeedPrompt} so the wording the
 * agent reads is identical to what a reviewer sees in the transcript, and so
 * the block can be asserted on its own in tests.
 *
 * Every label here comes from the stack registry. There used to be a private
 * `STACK_LABELS` table in this file whose doc comment promised not to drift
 * from the frontend chips; deriving both from `STACK_PROFILES` is how that
 * promise stops being manual.
 */
function renderIntakeBlock(
  intake: NewProjectIntake,
  profile: StackProfile | null,
): string {
  const stackOther = intake.stackOther?.trim();
  const stackLabel = stackLabelForPlatform(intake.platform, intake.stack);
  const stackLine =
    intake.stack === 'other' && stackOther
      ? `${stackLabel} — ${stackOther}`
      : stackLabel;
  const constraints = intake.constraints?.trim();

  const lines = [
    '## Project intake',
    '',
    '**What are you building?**',
    intake.what.trim(),
    '',
    `**Who is it for?** ${AUDIENCE_LABELS[intake.audience]}`,
    '',
  ];

  // Only rendered when the user actually answered the platform question. An
  // absent `platform` means Node/TypeScript by default, and printing a line
  // the user never chose would change the prompt every existing project gets.
  if (intake.platform) {
    lines.push(`**Platform:** ${profile?.label ?? 'Other / not listed'}`, '');
  }

  lines.push(`**Tech stack preference:** ${stackLine}`);

  if (constraints) {
    lines.push('', '**Must-haves / constraints**', constraints);
  }

  return lines.join('\n');
}

/**
 * The "before you scaffold, know this" block: a toolchain that is missing or
 * too old, and required plugins that are not installed.
 *
 * Returns an empty array when there is nothing wrong, so the caller can splice
 * it in unconditionally and a healthy machine produces the prompt it always
 * produced.
 */
function renderEnvironmentBlock(
  profile: StackProfile | null,
  context: NewProjectPromptContext,
): string[] {
  const notes: string[] = [];

  const toolchain = context.toolchain;
  if (toolchain && !toolchain.installed) {
    notes.push(
      `- The \`${toolchain.command}\` toolchain is NOT installed on this machine. ` +
        `${toolchain.installHint} Tell me this before you scaffold anything, and ` +
        'wait for me to confirm it is installed — do not start and fail halfway.',
    );
  } else if (toolchain && !toolchain.satisfiesMin) {
    const found = toolchain.version
      ? `reports version ${toolchain.version}`
      : 'did not report a version we could read';
    notes.push(
      `- \`${toolchain.command}\` ${found}, and this stack needs ${toolchain.minVersion} or newer. ` +
        `${toolchain.installHint} Raise it with me before scaffolding.`,
    );
  }

  const missing = context.missingExternalPlugins ?? [];
  if (missing.length > 0) {
    notes.push(
      '- This stack normally leans on plugins that are NOT installed here: ' +
        `${missing.map(renderPluginRef).join(', ')}. ` +
        'They come from an external marketplace, so installing them is my ' +
        'decision, not yours — do not try to install or invoke them. Tell me ' +
        'they are missing and that I can add them from the Marketplace ' +
        'Plugins view, then carry on using only the skills you do have.',
    );
  }

  if (notes.length === 0) {
    return [];
  }

  return ['', '## Before you start', '', ...notes];
}

/**
 * The Stage A instruction steps, derived from the profile.
 *
 * Returned unnumbered; {@link buildNewProjectSeedPrompt} numbers them, so
 * inserting the Nx-decision step for `.NET` does not leave the following steps
 * mislabelled.
 *
 * `availableSkillIds` gates the two skill names the profile carries. A profile
 * may name a skill whose plugin has not shipped yet, and an agent told to run a
 * skill that is not there improvises rather than stopping — so a name is
 * printed only once discovery has actually seen it. Gating on the live set is
 * what makes this self-healing: the day the plugin ships, the name becomes
 * discoverable and the fallback stops firing with no edit here.
 *
 * The initializer and the architect are checked independently. A platform can
 * ship one and not the other, and collapsing them into one flag would silence a
 * skill that is genuinely installed.
 */
function buildProcedureSteps(
  profile: StackProfile | null,
  availableSkillIds: ReadonlySet<string>,
): string[] {
  const steps: string[] = [];

  const initializer =
    profile && availableSkillIds.has(profile.skills.initializer)
      ? profile.skills.initializer
      : null;
  const architect =
    profile && availableSkillIds.has(profile.skills.architect)
      ? profile.skills.architect
      : null;

  if (initializer) {
    steps.push(`Use the \`${initializer}\` skill and run its Stage A.`);
  } else if (profile) {
    // The platform IS settled — the intake block above states it — but its
    // preset skill is not on this machine. Naming it anyway is the whole defect
    // this branch exists to prevent, so hand over the contract, not the name.
    steps.push(
      'No preset Stage A skill is installed for this platform, so follow the ' +
        'generic Stage A contract directly (discovery, then domain model, then ' +
        'roadmap, then a foundation-only scaffold), using the conventions of ' +
        'the platform we settled on. Do not go looking for a preset skill by name.',
    );
  } else {
    // The `other` platform: the user told us none of the presets fit, so the
    // first job is finding out what does. Naming a preset skill here would be
    // inventing an answer they explicitly declined to give.
    steps.push(
      'I picked a platform that has no preset here, so start by establishing ' +
        'it: ask me which language, runtime and package manager this project ' +
        'targets, and follow the generic Stage A contract (discovery, then ' +
        'domain model, then roadmap, then a foundation-only scaffold).',
    );
  }

  steps.push(
    "Run Stage A's two-round discovery (business first, then stack) using " +
      'the AskUserQuestion tool — one round of questions at a time, and wait ' +
      'for my answers. Skip any question the intake above already answers, ' +
      'and never answer a discovery question on my behalf: if you need my ' +
      'input, ask for it.',
  );

  // `ask` means the workspace tool is layered on top of the stack's native
  // scaffolding rather than being it, so the answer is per-project. `given`
  // adds nothing here, which is what keeps the Node/TypeScript prompt as it was.
  if (profile && profile.workspace.monorepoDecision === 'ask') {
    const plugins = profile.workspace.nxPlugins;
    const pluginNote =
      plugins.length > 0 ? ` (via \`${plugins.join('`, `')}\`)` : '';
    steps.push(
      'In that same discovery, ask me whether this workspace should be ' +
        `managed by \`${profile.workspace.monorepoTool}\`${pluginNote} or stay ` +
        `on plain \`${profile.workspace.scaffoldCommands.join('`, `')}\`. ` +
        'Recommend yes for a multi-project solution or one that mixes this ' +
        'stack with a frontend, and no for a single service — then take my ' +
        'answer, whichever way it goes.',
    );
  }

  const architectClause = architect
    ? `then the \`${architect}\` skill to derive the library layout from them`
    : 'then derive the library layout from them using the conventions of the platform we settled on';
  steps.push(
    `Once discovery is settled, invoke the \`${profile?.skills.domain ?? 'ddd-architecture'}\` ` +
      `skill to name the bounded contexts, ${architectClause}.`,
  );

  steps.push('Write the phased plan to `.ptah/roadmap.md`.');
  steps.push(
    'Scaffold ONLY the foundation described by Stage A, then stop. The ' +
      'remaining roadmap items each run later as their own task.',
  );
  steps.push(
    "Finally, design this project's AI team with the ptah.harness tools " +
      '(searchSkills, searchMcpRegistry, createSkill, proposeConfig): choose ' +
      'the agents, skills, and MCP servers that fit what we settled on, then ' +
      'call proposeConfig with isConfigComplete=true so I can review and apply ' +
      'it — applying is my call, not yours.',
  );

  return steps;
}

/**
 * Build the first user turn for the New Project workflow.
 *
 * The prompt has three parts:
 *   1. The user's intake answers, verbatim, so discovery starts from what they
 *      already told us instead of asking it again.
 *   2. Anything wrong with the machine — a missing toolchain, a required
 *      plugin the user has not consented to installing — so the agent raises
 *      it before scaffolding rather than failing into it.
 *   3. The Stage A instruction sequence, whose skill names come from the stack
 *      profile the platform answer selected — and only for the skills
 *      `context.availableSkillIds` says are installed — followed by the
 *      AI-team design pass over the ptah.harness tools.
 *
 * Deliberately model-agnostic: no vendor or product names, so the same prompt
 * is valid on every adapter the runtime can dispatch to.
 */
export function buildNewProjectSeedPrompt(
  intake: NewProjectIntake,
  context: NewProjectPromptContext = {},
): string {
  const profile = resolveStackProfileForPlatform(intake.platform);
  const steps = buildProcedureSteps(
    profile,
    new Set(context.availableSkillIds ?? []),
  ).map((step, index) => `${index + 1}. ${step}`);

  return [
    "I'm starting a new project. Here is what I already know about it.",
    '',
    renderIntakeBlock(intake, profile),
    ...renderEnvironmentBlock(profile, context),
    '',
    '## How to proceed',
    '',
    ...steps,
  ].join('\n');
}
