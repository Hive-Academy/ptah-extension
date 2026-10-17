import type {
  EnhancedPromptsCancelParams,
  EnhancedPromptsCancelResponse,
  EnhancedPromptsGetRunStateParams,
  EnhancedPromptsRegenerateParams,
  EnhancedPromptsRunWizardParams,
  EnhancedPromptsRunWizardResponse,
  GenerationContextSource,
  SetupGenerationAccepted,
  SetupGenerationRunBinding,
  SetupGenerationResultFacts,
  SetupGenerationRunState,
  WizardCancelParams,
  WizardGetGenerationRunStateParams,
  WizardPreviewGenerationParams,
  WizardRetryItemParams,
  WizardSubmitSelectionParams,
  WizardSubmitSelectionResponse,
} from './rpc-setup.types';
import type {
  GenerationCompletePayload,
  GenerationProgressPayload,
  GenerationStreamPayload,
  EnhancedGenerationStreamPayload,
} from '../wizard/phase';

type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type _OldSuccessRequired = Assert<
  Equal<WizardSubmitSelectionResponse['success'], boolean>
>;
type _OldGuidanceSuccessRequired = Assert<
  Equal<EnhancedPromptsRunWizardResponse['success'], boolean>
>;
type _BindingOptional = Assert<
  Equal<
    WizardSubmitSelectionParams['tabBinding'],
    import('./rpc-setup.types').SetupGenerationTabBinding | undefined
  >
>;
type _PreviewBindingOptional = Assert<
  Equal<
    WizardPreviewGenerationParams['tabBinding'],
    import('./rpc-setup.types').SetupGenerationTabBinding | undefined
  >
>;
type _BoundCancelRequired = Assert<
  Equal<EnhancedPromptsCancelParams['tabBinding'], SetupGenerationRunBinding>
>;
type CommittedState = 'committed' | 'unchanged' | 'unknown';
type _ResultCommitOptional = Assert<
  Equal<
    SetupGenerationResultFacts['committedState'],
    CommittedState | undefined
  >
>;
type _RunCommitOptional = Assert<
  Equal<SetupGenerationRunState['committedState'], CommittedState | undefined>
>;
type _GuidanceCancelOutcomeOptional = Assert<
  Equal<
    EnhancedPromptsCancelResponse['outcome'],
    'cancelled' | 'already-finalized' | 'not-running' | 'refused' | undefined
  >
>;

const binding: SetupGenerationRunBinding = {
  tabId: 'tab-1',
  workflow: 'setup-agent-generation',
  workspacePath: '/workspace',
  runId: 'run-1',
};
const source: GenerationContextSource = {
  kind: 'verified-analysis',
  analysisRunId: 'analysis-1',
  analysisDir: '/workspace/.ptah/analysis/latest',
};
const accepted: SetupGenerationAccepted = {
  runId: binding.runId,
  source,
  status: 'starting',
  effectiveProvider: 'anthropic',
  effectiveModel: 'claude-sonnet',
};

describe('setup generation compatibility contract', () => {
  it('keeps tabless requests and awaited result shapes valid', () => {
    const submit: WizardSubmitSelectionParams = { selectedAgentIds: ['agent'] };
    const guidance: EnhancedPromptsRunWizardParams = {
      workspacePath: '/workspace',
    };
    const regenerate: EnhancedPromptsRegenerateParams = {
      workspacePath: '/workspace',
    };
    const cancel: WizardCancelParams = { saveProgress: true };
    const retry: WizardRetryItemParams = { itemId: 'agent' };
    const result: WizardSubmitSelectionResponse = { success: true };
    const oldRun: SetupGenerationRunState = {
      binding,
      status: 'running',
      source,
      effectiveProvider: 'anthropic',
      effectiveModel: 'claude-sonnet',
    };
    const oldCancel: EnhancedPromptsCancelResponse = { cancelled: false };
    expect([oldRun.committedState, oldCancel.outcome]).toEqual([
      undefined,
      undefined,
    ]);
    expect([
      submit.tabBinding,
      guidance.tabBinding,
      regenerate.tabBinding,
      cancel.tabBinding,
      retry.tabBinding,
      result.accepted,
    ]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('types bound starts, lookups and progress while preserving legacy envelopes', () => {
    const resultFacts: SetupGenerationResultFacts = {
      status: 'timed-out',
      success: false,
      source,
      effectiveProvider: 'anthropic',
      effectiveModel: 'claude-sonnet',
      committedState: 'unknown',
    };
    const runState: SetupGenerationRunState = {
      binding,
      status: 'timed-out',
      source,
      effectiveProvider: 'anthropic',
      effectiveModel: 'claude-sonnet',
      committedState: 'unknown',
      result: resultFacts,
    };
    const guidanceOutcome: EnhancedPromptsCancelResponse = {
      cancelled: false,
      outcome: 'already-finalized',
    };
    expect([
      runState.committedState,
      runState.result?.committedState,
      guidanceOutcome.outcome,
    ]).toEqual(['unknown', 'unknown', 'already-finalized']);
    const submit: WizardSubmitSelectionParams = {
      selectedAgentIds: ['agent'],
      tabBinding: binding,
    };
    const result: WizardSubmitSelectionResponse = { success: true, accepted };
    const cancel: WizardCancelParams = { tabBinding: binding };
    const retry: WizardRetryItemParams = {
      itemId: 'agent',
      tabBinding: binding,
    };
    const guidanceCancel: EnhancedPromptsCancelParams = { tabBinding: binding };
    const guidanceLookup: EnhancedPromptsGetRunStateParams = {
      tabBinding: binding,
    };
    const agentLookup: WizardGetGenerationRunStateParams = {
      tabBinding: binding,
    };
    const oldProgress: GenerationProgressPayload = {
      progress: { phase: 'rendering', percentComplete: 50 },
    };
    const boundProgress: GenerationProgressPayload = {
      ...oldProgress,
      tabBinding: binding,
      lifecycle: 'running',
    };
    const stream: GenerationStreamPayload = {
      kind: 'text',
      content: 'Generating',
      timestamp: 1,
      tabBinding: binding,
      lifecycle: 'running',
    };
    const guidanceStream: EnhancedGenerationStreamPayload = {
      kind: 'text',
      content: 'Generating guidance',
      timestamp: 2,
      tabBinding: { ...binding, workflow: 'setup-project-prompt' },
      lifecycle: 'running',
    };
    const oldComplete: GenerationCompletePayload = {
      success: true,
      outputDirectory: '/workspace/.claude/agents',
      writtenCount: 1,
      unchangedCount: 0,
      failedCount: 0,
      rejectedSections: 0,
      tailoredSections: 1,
      agents: [],
    };
    const boundComplete: GenerationCompletePayload = {
      ...oldComplete,
      tabBinding: binding,
      terminalStatus: 'completed',
      result: {
        status: 'completed',
        success: true,
        source,
        effectiveProvider: 'anthropic',
        effectiveModel: 'claude-sonnet',
        enhancedPromptsUsed: true,
      },
    };
    expect(submit.tabBinding?.tabId).toBe('tab-1');
    expect(result.accepted?.source).toEqual(source);
    expect(
      [cancel, retry, guidanceCancel, guidanceLookup, agentLookup].every(
        (value) => value.tabBinding?.tabId === 'tab-1',
      ),
    ).toBe(true);
    expect(cancel.tabBinding?.runId).toBe('run-1');
    expect(oldProgress.tabBinding).toBeUndefined();
    expect(boundProgress.lifecycle).toBe('running');
    expect(stream.tabBinding?.tabId).toBe('tab-1');
    expect(guidanceStream.tabBinding?.workflow).toBe('setup-project-prompt');
    expect(oldComplete.terminalStatus).toBeUndefined();
    expect(boundComplete.result?.enhancedPromptsUsed).toBe(true);
  });
});

type _TerminalStatus = Assert<
  Equal<
    GenerationCompletePayload['terminalStatus'],
    import('./rpc-setup.types').SetupGenerationTerminalStatus | undefined
  >
>;
