import {
  OUTCOME_TASK_KINDS,
  loggableErrorName,
  type LaneTaskKindClassificationInput,
  type LaneTaskKindClassifier,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';

import {
  DecisionCaller,
  type DecisionCallerDependencies,
} from '../decision-model/decision-caller';
import {
  criterionLabels,
  optionIndex,
  runFixedRequest,
} from '../pipeline/model-refine';
import { REQUEST_SIZE_LIMIT_BYTES } from '../routing-constants';

const QUESTION_KEY = 'task_kind';
const KINDS = new Set<string>(OUTCOME_TASK_KINDS);

export class DecisionModelTaskKindClassifier implements LaneTaskKindClassifier {
  private readonly caller: DecisionCaller;

  constructor(private readonly deps: DecisionCallerDependencies) {
    this.caller = new DecisionCaller(deps);
  }

  async classify(
    input: LaneTaskKindClassificationInput,
  ): Promise<OutcomeTaskKind | null> {
    try {
      const opened = await this.caller.openCaller();
      if (opened.kind !== 'system-one' && opened.kind !== 'structured') {
        return null;
      }
      const outcome = await runFixedRequest({
        request: `Role: ${input.role ?? 'none'}\nTask:\n${input.brief}`,
        questions: [{
          key: QUESTION_KEY,
          instructions: 'Choose the task kind.',
          criteria: criterionLabels(OUTCOME_TASK_KINDS),
        }],
        maxRequestBytes: REQUEST_SIZE_LIMIT_BYTES,
        dispatch: this.caller.dispatchFor(opened),
        logger: this.deps.logger,
      });
      await this.caller.noteLive(opened, outcome);
      // runFixedRequest has already validated the choice and confidence with
      // validateChoiceAnswer; only an accepted offered label can be returned.
      const answer = outcome.answers.get(QUESTION_KEY);
      if (answer === undefined || answer.cause !== null || answer.choice === null) {
        return null;
      }
      const index = optionIndex(answer.choice);
      const kind = index === null ? undefined : OUTCOME_TASK_KINDS[index];
      return kind !== undefined && KINDS.has(kind) ? kind : null;
    } catch (error: unknown) {
      // degradation-audit: reported - classification is best-effort learning metadata; the row stays unclassified
      this.deps.logger.warn('[lane-routing] task-kind classification failed', {
        name: loggableErrorName(error),
      });
      return null;
    }
  }
}
