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
  WizardInstallPackAgentsResult,
  WizardPreviewGenerationParams,
  WizardRetryItemParams,
  WizardSubmitSelectionParams,
  WizardSubmitSelectionResponse,
} from './rpc-setup.types';
import type {
  FileOutcome,
  GenerationTargetInfo,
  WizardPlanPackInstallResult,
} from './rpc-setup-decisions.types';
import type {
  GenerationAgentOutcome,
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
type _ResultInterruptedOptional = Assert<
  Equal<SetupGenerationResultFacts['interrupted'], boolean | undefined>
>;
type _RunInterruptedOptional = Assert<
  Equal<SetupGenerationRunState['interrupted'], boolean | undefined>
>;
type _PreviewRequiredReason = Assert<
  'preview-required' extends import('./rpc-setup.types').SetupGenerationRejection['reason']
    ? true
    : false
>;
type _FileOutcomeUnion = Assert<
  Equal<
    FileOutcome,
    'written' | 'kept' | 'unchanged' | 'changed-since-preview' | 'failed'
  >
>;
/**
 * The generation outcome union is widened to `FileOutcome` together with its
 * consumers (checkpoint store, completion tiles), not in the shared batch.
 */
type _AgentOutcomeNotYetWidened = Assert<
  Equal<GenerationAgentOutcome['status'], 'written' | 'unchanged' | 'failed'>
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
  it('types optional verified bound result facts without changing the base result', () => {
    const facts: SetupGenerationResultFacts = {
      status: 'completed',
      success: true,
      source,
      effectiveProvider: 'anthropic',
      effectiveModel: 'claude-sonnet',
      agentOutcomes: [
        {
          agentId: 'agent',
          status: 'written',
          fileName: 'agent.md',
          rejectedSections: 1,
          tailoredSections: 2,
        },
      ],
      counts: {
        total: 1,
        written: 1,
        unchanged: 0,
        failed: 0,
        skipped: 0,
        rejected: 0,
      },
      rejectedSections: 1,
      tailoredSections: 2,
      propagation: {
        consent: 'granted',
        status: 'completed',
        targets: ['claude'],
      },
    };
    expect(facts.agentOutcomes?.[0].fileName).toBe('agent.md');
    expect(facts.propagation?.consent).toBe('granted');
  });
  it('types decision params, kept counts, pack outcomes and the Library pass', () => {
    const target: GenerationTargetInfo = {
      harnessRoot: '/workspace',
      openedFolder: '/workspace/packages/app',
      chosen: 'harness-root',
      openedIsHarnessRoot: false,
    };
    const facts: SetupGenerationResultFacts = {
      status: 'completed',
      success: true,
      source,
      effectiveProvider: 'anthropic',
      effectiveModel: 'claude-sonnet',
      counts: {
        total: 2,
        written: 0,
        unchanged: 0,
        failed: 0,
        skipped: 0,
        rejected: 0,
        kept: 1,
        changedSincePreview: 1,
      },
      target,
      libraryPass: 'not-applicable',
      libraryDiverged: [],
    };
    const submit: WizardSubmitSelectionParams = {
      selectedAgentIds: ['tester'],
      previewToken: 'token-1',
      fileDecisions: { tester: { decision: 'replace', revision: 'rev-1' } },
      target: 'harness-root',
    };
    const plan: WizardPlanPackInstallResult = {
      planToken: 'plan-1',
      target,
      files: [{ file: 'docs-writer.md', state: 'differs', revision: 'rev-2' }],
    };
    const install: WizardInstallPackAgentsResult = {
      success: true,
      agentsDownloaded: 1,
      fromCache: false,
      files: [
        { file: 'docs-writer.md', outcome: 'kept' },
        { file: 'tester.md', outcome: 'changed-since-preview' },
      ],
      libraryPass: 'updated',
    };
    expect(facts.counts?.kept).toBe(1);
    expect(facts.counts?.changedSincePreview).toBe(1);
    expect(facts.libraryPass).toBe('not-applicable');
    expect(install.files?.map((entry) => entry.outcome)).toEqual([
      'kept',
      'changed-since-preview',
    ]);
    expect(submit.fileDecisions?.['tester'].decision).toBe('replace');
    expect(plan.files[0].state).toBe('differs');
  });

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
