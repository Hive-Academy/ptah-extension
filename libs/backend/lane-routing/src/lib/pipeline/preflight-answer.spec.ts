import { DEPTHS } from '../contracts/route-decide-args.schema';
import type { ModelRequestOutcome } from './model-refine';
import { preflightQuestions, readPreflight } from './preflight-answer';

const DESCRIPTIONS = [
  'Full: the goal or scope is vague or open-ended; requirements must be gathered and the solution designed before any code',
  'Partial: a known bug or a clearly specified change touching several files or components; plan it, implement it, review it',
  'Minimal: a tiny, mechanical edit in one place (rename, typo, one-line fix) that one developer can finish directly',
] as const;

describe('preflight depth criteria', () => {
  it('sends the variant D text in DEPTHS order and leaves task type unchanged', () => {
    const [taskType, depth] = preflightQuestions();
    expect(depth).toEqual({
      key: 'depth',
      instructions: 'Choose how much workflow this request needs before code is written.',
      criteria: { o1: DESCRIPTIONS[0], o2: DESCRIPTIONS[1], o3: DESCRIPTIONS[2] },
    });
    expect(DEPTHS).toEqual(['Full', 'Partial', 'Minimal']);
    expect(taskType).toEqual({
      key: 'task_type',
      instructions: 'Choose the task type.',
      criteria: {
        o1: 'FEATURE', o2: 'BUGFIX', o3: 'REFACTORING', o4: 'DOCUMENTATION',
        o5: 'RESEARCH', o6: 'DEVOPS', o7: 'SAAS_INIT', o8: 'CREATIVE',
      },
    });
  });

  it.each([
    ['o1', 'Full'], ['o2', 'Partial'], ['o3', 'Minimal'],
  ] as const)('maps %s back to %s', (choice, value) => {
    const outcome: ModelRequestOutcome = {
      sent: true, succeeded: true, requestCause: null, notFoundDetail: null,
      answers: new Map([['depth', { choice, cause: null, confidence: 0.9, proposal: null }]]),
      offered: new Map(), inputTokens: null, outputTokens: null, outcomeFigures: 0,
    };
    expect(readPreflight({ kind: 'unset' }, outcome).depth.answer).toMatchObject({
      value, source: 'model', confidence: 0.9,
    });
  });
});
