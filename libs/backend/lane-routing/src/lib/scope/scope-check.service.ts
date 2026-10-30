import type { PreflightResult } from '../contracts/route-decide-result.schema';
import {
  DecisionCaller,
  type DecisionCallerDependencies,
} from '../decision-model/decision-caller';
import {
  criterionLabels,
  optionIndex,
  runFixedRequest,
  type ModelRequestOutcome,
} from '../pipeline/model-refine';
import { REQUEST_SIZE_LIMIT_BYTES } from '../routing-constants';
import type { HostRoutingSetting } from './host-routing-setting';

export interface ScopeConversation {
  readonly turnText: string;
  readonly previousUserTurn: string | null;
  readonly lastAssistantReply: string | null;
  readonly pendingScope: string | null;
  readonly lastRoutedScope: string | null;
}

export interface ScopeAnswer<T extends string> {
  readonly value: T;
  readonly confidence: number | null;
}

export type ScopeAssessment =
  | { readonly kind: 'unavailable'; readonly usage: PreflightResult['usage'] }
  | {
      readonly kind: 'answered';
      readonly engineering: ScopeAnswer<'yes' | 'no'> | null;
      readonly settled: ScopeAnswer<'yes' | 'no'> | null;
      readonly relation: ScopeAnswer<'new-task' | 'continuation'> | null;
      readonly materialChange: ScopeAnswer<'yes' | 'no'> | null;
      readonly usage: PreflightResult['usage'];
    };

const YES_NO = ['yes', 'no'] as const;
const RELATIONS = ['new-task', 'continuation'] as const;
const QUESTIONS = [
  {
    key: 'engineering',
    instructions: 'Is this software engineering work on this workspace, including code, design, tests, docs or research for a change?',
    criteria: criterionLabels(YES_NO),
  },
  {
    key: 'scope_settled',
    instructions: "Are the goal and boundaries agreed enough to start? Count agreement with the assistant's last proposal.",
    criteria: criterionLabels(YES_NO),
  },
  {
    key: 'relation',
    instructions: 'Is this a different piece of work from the scope under discussion or last routed, or the same work?',
    criteria: criterionLabels(RELATIONS),
  },
  {
    key: 'material_change',
    instructions: 'Has the agreed scope changed in goal, size or boundaries?',
    criteria: criterionLabels(YES_NO),
  },
] as const;

const ZERO_USAGE: PreflightResult['usage'] = {
  requests: 0,
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
};

/** One bounded, advisory scope assessment per turn. */
export class ScopeCheckService {
  private readonly caller: DecisionCaller;

  constructor(
    private readonly deps: DecisionCallerDependencies & {
      readonly setting: HostRoutingSetting;
    },
  ) {
    this.caller = new DecisionCaller(deps);
  }

  async assess(conversation: ScopeConversation): Promise<ScopeAssessment> {
    try {
      if (!this.deps.setting.isEnabled()) {
        return { kind: 'unavailable', usage: ZERO_USAGE };
      }
      const opened = await this.caller.openCaller();
      if (opened.kind !== 'system-one' && opened.kind !== 'structured') {
        return { kind: 'unavailable', usage: ZERO_USAGE };
      }
      if (!this.deps.setting.isEnabled()) {
        return { kind: 'unavailable', usage: ZERO_USAGE };
      }
      const outcome = await runFixedRequest({
        request: scopeRequest(conversation),
        questions: QUESTIONS,
        maxRequestBytes: REQUEST_SIZE_LIMIT_BYTES,
        dispatch: this.caller.dispatchFor(opened),
        logger: this.deps.logger,
      });
      await this.caller.noteLive(opened, outcome);
      const usage: PreflightResult['usage'] = {
        requests: outcome.sent ? 1 : 0,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        costUsd: null,
      };
      if (!outcome.succeeded) return { kind: 'unavailable', usage };
      return {
        kind: 'answered',
        engineering: answer(outcome, 'engineering', YES_NO),
        settled: answer(outcome, 'scope_settled', YES_NO),
        relation: answer(outcome, 'relation', RELATIONS),
        materialChange: answer(outcome, 'material_change', YES_NO),
        usage,
      };
    } catch (_error: unknown) {
      // degradation-audit: reported - advisory routing fails open without logging conversation text.
      return { kind: 'unavailable', usage: ZERO_USAGE };
    }
  }
}

function answer<T extends string>(
  outcome: ModelRequestOutcome,
  key: string,
  values: readonly T[],
): ScopeAnswer<T> | null {
  const validation = outcome.answers.get(key);
  if (validation === undefined || validation.cause !== null || validation.choice === null) return null;
  const index = optionIndex(validation.choice);
  const value = index === null ? undefined : values[index];
  return value === undefined
    ? null
    : { value, confidence: validation.confidence };
}

function scopeRequest(conversation: ScopeConversation): string {
  return sections([
    ['Scope under discussion:', conversation.pendingScope, 1200],
    ['Last routed scope:', conversation.lastRoutedScope, 1200],
    ['User earlier:', conversation.previousUserTurn, 800],
    ["Assistant's last reply:", conversation.lastAssistantReply, 1500],
    ['User turn:', conversation.turnText, 2000],
  ]);
}

/** Bounded pre-flight context for the agreed scope; safe for route_decide's 8000-character limit. */
export function buildPreflightScopeSummary(
  conversation: ScopeConversation,
): string {
  return sections([
    ['Agreed scope:', conversation.pendingScope, 1500],
    ["Assistant's proposal:", conversation.lastAssistantReply, 1500],
    ["User's confirmation:", conversation.turnText, 2000],
  ]);
}

function sections(fields: readonly (readonly [string, string | null, number])[]): string {
  return fields
    .filter(([, value]) => value !== null)
    .map(([label, value, cap]) => `${label}\n${value?.slice(0, cap) ?? ''}`)
    .join('\n\n');
}
