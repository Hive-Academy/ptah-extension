import { STACK_PROFILES, stackLabelForPlatform } from '@ptah-extension/shared';
import type {
  NewProjectAudience,
  NewProjectIntake,
  NewProjectPlatform,
} from '@ptah-extension/shared';

/**
 * The intake vocabulary, in one place.
 *
 * The Setup Hub renders these as chips and the harness transcript renders the
 * same labels back as the user's first turn — if the two drifted, the user
 * would be shown words they never picked.
 *
 * Audience is the only list still written out here, because it is not a
 * property of any stack. The platform chips and the stack chips are BOTH
 * derived from `STACK_PROFILES`; the hand-written `NEW_PROJECT_STACK_OPTIONS`
 * that used to live in this file was one of the two label mirrors the registry
 * exists to delete.
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

/**
 * The platform chips, in registry order, with an `other` escape hatch.
 *
 * Adding a language to `STACK_PROFILES` adds a chip here — that is the whole
 * point of the registry, and it is why this is a `map` and not a literal.
 */
export const NEW_PROJECT_PLATFORM_OPTIONS: ReadonlyArray<{
  value: NewProjectPlatform;
  label: string;
}> = [
  ...STACK_PROFILES.map((profile) => ({
    value: profile.id as NewProjectPlatform,
    label: profile.label,
  })),
  { value: 'other', label: 'Other' },
];

/** The platform chip's label, for display. */
export function platformLabel(platform: NewProjectPlatform): string {
  return (
    NEW_PROJECT_PLATFORM_OPTIONS.find((option) => option.value === platform)
      ?.label ?? platform
  );
}

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
      : stackLabelForPlatform(intake.platform, intake.stack);

  const lines = [
    intake.what.trim(),
    '',
    `Who it's for: ${labelFor(NEW_PROJECT_AUDIENCE_OPTIONS, intake.audience)}`,
  ];

  // Only shown when the user answered the platform question. Absent means
  // Node/TypeScript, and a line the user never picked does not belong in a
  // bubble that claims to be their own words.
  if (intake.platform) {
    lines.push(`Platform: ${platformLabel(intake.platform)}`);
  }

  lines.push(`Stack: ${stackLabel}`);

  const constraints = intake.constraints?.trim();
  if (constraints) {
    lines.push(`Must-haves: ${constraints}`);
  }

  return lines.join('\n');
}
