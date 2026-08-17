import type {
  NewProjectAudience,
  NewProjectIntake,
  NewProjectStack,
} from '@ptah-extension/shared';

/**
 * The intake vocabulary, in one place.
 *
 * The Setup Hub renders these as chips and the harness transcript renders the
 * same labels back as the user's first turn — if the two drifted, the user
 * would be shown words they never picked.
 */
export const NEW_PROJECT_AUDIENCE_OPTIONS: ReadonlyArray<{
  value: NewProjectAudience;
  label: string;
}> = [
  { value: 'b2b', label: 'B2B' },
  { value: 'b2c', label: 'B2C' },
  { value: 'internal', label: 'Internal tool' },
  { value: 'unsure', label: 'Not sure' },
];

export const NEW_PROJECT_STACK_OPTIONS: ReadonlyArray<{
  value: NewProjectStack;
  label: string;
}> = [
  { value: 'recommend', label: 'Recommend for me' },
  { value: 'angular-nestjs', label: 'Angular + NestJS' },
  { value: 'react-nestjs', label: 'React + NestJS' },
  { value: 'other', label: 'Other' },
];

function labelFor(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Render the intake as the user's own words, for display as the first
 * transcript bubble.
 *
 * Deliberately NOT the seed prompt: the agent receives a long instruction
 * block (skill sequencing, tool calls, stop conditions) that would be noise in
 * a transcript. This is only what the user actually said.
 */
export function formatIntakeSummary(intake: NewProjectIntake): string {
  const stackLabel =
    intake.stack === 'other' && intake.stackOther?.trim()
      ? intake.stackOther.trim()
      : labelFor(NEW_PROJECT_STACK_OPTIONS, intake.stack);

  const lines = [
    intake.what.trim(),
    '',
    `Who it's for: ${labelFor(NEW_PROJECT_AUDIENCE_OPTIONS, intake.audience)}`,
    `Stack: ${stackLabel}`,
  ];

  const constraints = intake.constraints?.trim();
  if (constraints) {
    lines.push(`Must-haves: ${constraints}`);
  }

  return lines.join('\n');
}
