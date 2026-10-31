import 'reflect-metadata';

import {
  PreflightResultSchema,
  type PreflightResult,
} from '@ptah-extension/lane-routing';

import {
  ROUTING_NUDGE_TEXT,
  ROUTING_REMINDER_MAX_LENGTH,
  formatRoutingReminder,
} from './routing-reminder.format';

type Answer = PreflightResult['taskType'] | PreflightResult['depth'];

function preflight(
  overrides: { readonly taskType?: Answer; readonly depth?: Answer } = {},
): PreflightResult {
  return PreflightResultSchema.parse({
    stage: 'pre-flight',
    taskType: {
      value: 'FEATURE',
      source: 'model',
      confidence: 0.834,
      fallbackCause: null,
      modelProposal: null,
    },
    depth: {
      value: 'Full',
      source: 'model',
      confidence: 0.7,
      fallbackCause: null,
      modelProposal: null,
    },
    overallConfidence: 0.7,
    reasons: [],
    usage: { requests: 1, inputTokens: 10, outputTokens: 2, costUsd: null },
    ...overrides,
  });
}

describe('formatRoutingReminder', () => {
  it('formats task type, depth, lanes and subagents', () => {
    const text = formatRoutingReminder(preflight(), {
      lanes: ['codex', 'gemini'],
      subagents: ['backend-developer'],
    });
    expect(text).toBe(
      'Routing: pre-flight taskType=FEATURE (model, 0.83); depth=Full (model, 0.70). ' +
        'Available lanes: codex, gemini. Available subagents: backend-developer. ' +
        'Executor choice stays with gate-0.1 at plan approval.',
    );
  });

  it('omits absent or empty candidate lists', () => {
    const text = formatRoutingReminder(preflight(), {
      lanes: null,
      subagents: [],
    });
    expect(text).not.toContain('Available lanes');
    expect(text).not.toContain('Available subagents');
    expect(text).toContain('Executor choice stays with gate-0.1');
  });

  it('writes undetermined for a skill-table answer without a value and omits a null confidence', () => {
    const text = formatRoutingReminder(
      preflight({
        depth: {
          value: null,
          source: 'skill-table',
          confidence: null,
          fallbackCause: null,
          modelProposal: null,
        },
      }),
      { lanes: null, subagents: null },
    );
    expect(text).toContain('depth=undetermined (skill-table)');
  });

  it('returns null when both answers are skill-table fallbacks with a cause', () => {
    const fallback = {
      value: null,
      source: 'skill-table',
      confidence: null,
      fallbackCause: 'low-confidence',
      modelProposal: null,
    } as const;
    expect(
      formatRoutingReminder(
        preflight({ taskType: fallback, depth: fallback }),
        { lanes: ['codex'], subagents: null },
      ),
    ).toBeNull();
  });

  it('caps the reminder at 600 characters', () => {
    const long = Array.from(
      { length: 40 },
      (_, i) => `lane-${i}-${'x'.repeat(60)}`,
    );
    const text = formatRoutingReminder(preflight(), {
      lanes: long,
      subagents: long,
    });
    expect(text?.length).toBeLessThanOrEqual(ROUTING_REMINDER_MAX_LENGTH);
  });

  it('never tells the model to call route_decide', () => {
    const text = formatRoutingReminder(preflight(), {
      lanes: ['codex'],
      subagents: ['tester'],
    });
    expect(text).not.toMatch(/route_decide/);
    expect(ROUTING_NUDGE_TEXT).not.toMatch(/route_decide/);
    expect(ROUTING_NUDGE_TEXT.startsWith('Routing:')).toBe(true);
  });
});
