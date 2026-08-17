import type { NewProjectIntake } from '@ptah-extension/shared';

export const SAAS_WORKSPACE_INITIALIZER_PLUGIN_ID = 'ptah-nx-saas';

export const WIZARD_VIEW_TYPE = 'ptah.setupWizard';

const AUDIENCE_LABELS: Record<NewProjectIntake['audience'], string> = {
  b2b: 'Businesses (B2B)',
  b2c: 'Consumers (B2C)',
  internal: 'Internal tool',
  unsure: 'Not sure yet',
};

const STACK_LABELS: Record<NewProjectIntake['stack'], string> = {
  recommend: 'No preference — recommend a stack for me',
  'angular-nestjs': 'Angular + NestJS',
  'react-nestjs': 'React + NestJS',
  other: 'Other',
};

/**
 * Render the intake answers as a human-readable block.
 *
 * Kept separate from {@link buildNewProjectSeedPrompt} so the wording the
 * agent reads is identical to what a reviewer sees in the transcript, and so
 * the block can be asserted on its own in tests.
 */
function renderIntakeBlock(intake: NewProjectIntake): string {
  const stackOther = intake.stackOther?.trim();
  const stackLine =
    intake.stack === 'other' && stackOther
      ? `${STACK_LABELS.other} — ${stackOther}`
      : STACK_LABELS[intake.stack];
  const constraints = intake.constraints?.trim();

  const lines = [
    '## Project intake',
    '',
    '**What are you building?**',
    intake.what.trim(),
    '',
    `**Who is it for?** ${AUDIENCE_LABELS[intake.audience]}`,
    '',
    `**Tech stack preference:** ${stackLine}`,
  ];

  if (constraints) {
    lines.push('', '**Must-haves / constraints**', constraints);
  }

  return lines.join('\n');
}

/**
 * Build the first user turn for the New Project workflow.
 *
 * The prompt has two halves:
 *   1. The user's intake answers, verbatim, so discovery starts from what they
 *      already told us instead of asking it again.
 *   2. The Stage A instruction sequence — discovery through the
 *      AskUserQuestion tool, architecture skills, roadmap, foundation scaffold,
 *      stop — followed by the AI-team design pass over the ptah.harness tools.
 *
 * Deliberately model-agnostic: no vendor or product names, so the same prompt
 * is valid on every adapter the runtime can dispatch to.
 */
export function buildNewProjectSeedPrompt(intake: NewProjectIntake): string {
  return [
    "I'm starting a new project. Here is what I already know about it.",
    '',
    renderIntakeBlock(intake),
    '',
    '## How to proceed',
    '',
    '1. Use the `saas-workspace-initializer` skill and run its Stage A.',
    "2. Run Stage A's two-round discovery (business first, then stack) using " +
      'the AskUserQuestion tool — one round of questions at a time, and wait ' +
      'for my answers. Skip any question the intake above already answers, ' +
      'and never answer a discovery question on my behalf: if you need my ' +
      'input, ask for it.',
    '3. Once discovery is settled, invoke the `ddd-architecture` skill to name ' +
      'the bounded contexts, then the `nx-workspace-architect` skill to derive ' +
      'the library layout from them.',
    '4. Write the phased plan to `.ptah/roadmap.md`.',
    '5. Scaffold ONLY the foundation described by Stage A, then stop. The ' +
      'remaining roadmap items each run later as their own task.',
    "6. Finally, design this project's AI team with the ptah.harness tools " +
      '(searchSkills, searchMcpRegistry, createSkill, proposeConfig): choose ' +
      'the agents, skills, and MCP servers that fit what we settled on, then ' +
      'call proposeConfig with isConfigComplete=true so I can review and apply ' +
      'it — applying is my call, not yours.',
  ].join('\n');
}
