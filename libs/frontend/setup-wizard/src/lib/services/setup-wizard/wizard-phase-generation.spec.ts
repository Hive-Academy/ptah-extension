/**
 * WizardPhaseGeneration spec.
 *
 * Verifies the generation-stream lifecycle routes through the
 * WizardSurfaceFacade:
 *   - First generation event of a pass calls `surfaces.resetPhaseSurfaces()`
 *     (replaces the legacy `accumulator.reset()`) so stale analysis-phase
 *     entries are wiped before the generation transcript begins.
 *   - Subsequent events do NOT re-reset.
 *   - `payload.flatEvent` is forwarded to `surfaces.routePhaseEvent` keyed
 *     by the event's `messageId`.
 *   - `handleGenerationComplete` calls `unregisterAllPhaseSurfaces`.
 *   - `handleError` (non-fallback) calls `unregisterAllPhaseSurfaces`.
 */

import { signal, type WritableSignal } from '@angular/core';
import { WizardPhaseGeneration } from './wizard-phase-generation';
import type { WizardInternalState } from './wizard-internal-state';
import type { WizardSurfaceFacade } from '../setup-wizard-state.service';
import type {
  CompletionData,
  ErrorState,
  SkillGenerationProgressItem,
} from '../setup-wizard-state.types';
import type {
  FlatStreamEventUnion,
  GenerationCompletePayload,
  GenerationStreamPayload,
  WizardErrorPayload,
} from '@ptah-extension/shared';

describe('WizardPhaseGeneration (TASK_2026_107 Phase 3)', () => {
  let generationStream: WritableSignal<GenerationStreamPayload[]>;
  let completionData: WritableSignal<CompletionData | null>;
  let errorState: WritableSignal<ErrorState | null>;
  let fallbackWarning: WritableSignal<string | null>;
  let skillGenerationProgress: WritableSignal<SkillGenerationProgressItem[]>;
  let state: WizardInternalState;
  let surfaces: jest.Mocked<WizardSurfaceFacade>;
  let phaseGen: WizardPhaseGeneration;

  beforeEach(() => {
    generationStream = signal<GenerationStreamPayload[]>([]);
    completionData = signal<CompletionData | null>(null);
    errorState = signal<ErrorState | null>(null);
    fallbackWarning = signal<string | null>(null);
    skillGenerationProgress = signal<SkillGenerationProgressItem[]>([]);

    state = {
      generationStream,
      completionData,
      errorState,
      fallbackWarning,
      skillGenerationProgress,
      generationProgress: signal(null),
      setCurrentStepIfGeneration: jest.fn(),
    } as unknown as WizardInternalState;

    surfaces = {
      ensurePhaseSurface: jest.fn(),
      routePhaseEvent: jest.fn(),
      unregisterAllPhaseSurfaces: jest.fn(),
      resetPhaseSurfaces: jest.fn(),
    };

    phaseGen = new WizardPhaseGeneration(state, surfaces);
  });

  describe('handleGenerationStream', () => {
    it('calls surfaces.resetPhaseSurfaces() exactly once on the first event of a pass', () => {
      const evt = {
        eventType: 'message_start',
        messageId: 'wizard-gen-frontend-developer',
        sessionId: 'sess-1',
      } as unknown as FlatStreamEventUnion;
      const payload: GenerationStreamPayload = {
        kind: 'text',
        content: '',
        timestamp: 1,
        flatEvent: evt,
      };

      phaseGen.handleGenerationStream(payload);
      phaseGen.handleGenerationStream(payload);
      phaseGen.handleGenerationStream(payload);

      // Reset only fires for the first event of the pass — the deleted
      // accumulator's `generationStreamInitialized` flag is preserved.
      expect(surfaces.resetPhaseSurfaces).toHaveBeenCalledTimes(1);
    });

    it('routes each event with flatEvent through the surface façade', () => {
      const evt1 = {
        eventType: 'message_start',
        messageId: 'wizard-gen-x',
        sessionId: 'sess-1',
      } as unknown as FlatStreamEventUnion;
      const evt2 = {
        eventType: 'text_delta',
        messageId: 'wizard-gen-x',
        sessionId: 'sess-1',
        blockIndex: 0,
        delta: 'hello',
      } as unknown as FlatStreamEventUnion;

      phaseGen.handleGenerationStream({
        kind: 'text',
        content: '',
        timestamp: 1,
        flatEvent: evt1,
      });
      phaseGen.handleGenerationStream({
        kind: 'text',
        content: '',
        timestamp: 2,
        flatEvent: evt2,
      });

      expect(surfaces.routePhaseEvent).toHaveBeenCalledTimes(2);
      expect(surfaces.routePhaseEvent).toHaveBeenNthCalledWith(
        1,
        'wizard-gen-x',
        evt1,
      );
      expect(surfaces.routePhaseEvent).toHaveBeenNthCalledWith(
        2,
        'wizard-gen-x',
        evt2,
      );
    });

    it('still appends payloads without flatEvent to generationStream (back-compat)', () => {
      const payload: GenerationStreamPayload = {
        kind: 'status',
        content: 'working',
        timestamp: 1,
      };

      phaseGen.handleGenerationStream(payload);

      expect(generationStream()).toHaveLength(1);
      expect(surfaces.routePhaseEvent).not.toHaveBeenCalled();
    });

    it('resetPassState() re-arms the first-event reset for a subsequent pass', () => {
      const evt = {
        eventType: 'message_start',
        messageId: 'wizard-gen-x',
        sessionId: 'sess-1',
      } as unknown as FlatStreamEventUnion;
      const payload: GenerationStreamPayload = {
        kind: 'text',
        content: '',
        timestamp: 1,
        flatEvent: evt,
      };

      phaseGen.handleGenerationStream(payload);
      expect(surfaces.resetPhaseSurfaces).toHaveBeenCalledTimes(1);

      // Without resetPassState the next event would NOT trigger reset.
      phaseGen.handleGenerationStream(payload);
      expect(surfaces.resetPhaseSurfaces).toHaveBeenCalledTimes(1);

      phaseGen.resetPassState();
      phaseGen.handleGenerationStream(payload);
      expect(surfaces.resetPhaseSurfaces).toHaveBeenCalledTimes(2);
    });
  });

  const outcome = (
    overrides: Partial<GenerationCompletePayload['agents'][number]> = {},
  ): GenerationCompletePayload['agents'][number] => ({
    agentId: 'frontend-developer',
    filePath: 'D:\\ws\\.claude\\agents\\frontend-developer.md',
    status: 'written',
    rejectedSections: 0,
    tailoredSections: 2,
    ...overrides,
  });

  const completePayload = (
    overrides: Partial<GenerationCompletePayload> = {},
  ): GenerationCompletePayload => ({
    success: true,
    outputDirectory: 'D:\\ws\\.claude\\agents',
    writtenCount: 1,
    unchangedCount: 0,
    failedCount: 0,
    rejectedSections: 0,
    tailoredSections: 2,
    agents: [outcome()],
    duration: 1000,
    ...overrides,
  });

  describe('handleGenerationComplete', () => {
    it('persists completionData and tears down routing via unregisterAllPhaseSurfaces', () => {
      const payload = completePayload();

      phaseGen.handleGenerationComplete(payload);

      expect(completionData()).toEqual(payload);
      expect(state.setCurrentStepIfGeneration).toHaveBeenCalledTimes(1);
      expect(surfaces.unregisterAllPhaseSurfaces).toHaveBeenCalledTimes(1);
      // Full nuke is reserved for the next pass start (handleGenerationStream
      // first-event reset) and for explicit wizard reset.
      expect(surfaces.resetPhaseSurfaces).not.toHaveBeenCalled();
    });

    it('maps mixed outcomes onto items: written/unchanged complete, failed is error', () => {
      skillGenerationProgress.set([
        {
          id: 'frontend-developer',
          name: 'frontend-developer.md',
          type: 'agent',
          status: 'in-progress',
          progress: 40,
        },
        {
          id: 'backend-developer',
          name: 'backend-developer.md',
          type: 'agent',
          status: 'pending',
        },
        {
          id: 'senior-tester',
          name: 'senior-tester.md',
          type: 'agent',
          status: 'in-progress',
        },
        {
          id: 'ep-1',
          name: 'enhanced-prompt',
          type: 'enhanced-prompt',
          status: 'pending',
        },
      ]);

      phaseGen.handleGenerationComplete(
        completePayload({
          success: false,
          writtenCount: 1,
          unchangedCount: 1,
          failedCount: 1,
          agents: [
            outcome(),
            outcome({
              agentId: 'backend-developer',
              filePath: 'D:\\ws\\.claude\\agents\\backend-developer.md',
              status: 'unchanged',
            }),
            outcome({
              agentId: 'senior-tester',
              filePath: 'D:\\ws\\.claude\\agents\\senior-tester.md',
              status: 'failed',
              error: 'SDK timeout',
            }),
          ],
        }),
      );

      const items = skillGenerationProgress();
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get('frontend-developer')?.status).toBe('complete');
      expect(byId.get('frontend-developer')?.progress).toBe(100);
      expect(byId.get('backend-developer')?.status).toBe('complete');
      expect(byId.get('senior-tester')?.status).toBe('error');
      expect(byId.get('senior-tester')?.errorMessage).toBe('SDK timeout');
      // A non-agent item is never touched by agent outcomes.
      expect(byId.get('ep-1')?.status).toBe('pending');
    });

    it('creates an item for an outcome with no pre-seeded item (resumed run)', () => {
      phaseGen.handleGenerationComplete(
        completePayload({
          agents: [
            outcome({
              agentId: 'devops-engineer',
              filePath: '/ws/.claude/agents/devops-engineer.md',
              status: 'failed',
              error: 'not generated because the run timed out',
            }),
          ],
        }),
      );

      const items = skillGenerationProgress();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'devops-engineer',
        name: 'devops-engineer.md',
        type: 'agent',
        status: 'error',
        errorMessage: 'not generated because the run timed out',
      });
    });

    it('a failed outcome stays an error even after a final progress event', () => {
      skillGenerationProgress.set([
        {
          id: 'senior-tester',
          name: 'senior-tester.md',
          type: 'agent',
          status: 'in-progress',
        },
      ]);

      // The final progress event must not mark anything complete.
      phaseGen.handleGenerationProgress({
        progress: { phase: 'complete', percentComplete: 100 },
      });
      expect(skillGenerationProgress()[0].status).toBe('in-progress');

      phaseGen.handleGenerationComplete(
        completePayload({
          success: false,
          writtenCount: 0,
          failedCount: 1,
          agents: [
            outcome({
              agentId: 'senior-tester',
              filePath: '/ws/.claude/agents/senior-tester.md',
              status: 'failed',
              error: 'aborted',
            }),
          ],
        }),
      );

      expect(skillGenerationProgress()[0].status).toBe('error');
      expect(skillGenerationProgress()[0].errorMessage).toBe('aborted');
    });
  });

  describe('handleError', () => {
    it('a fatal error tears down active routing bindings', () => {
      const payload: WizardErrorPayload = {
        type: 'fatal',
        message: 'boom',
      } as unknown as WizardErrorPayload;

      phaseGen.handleError(payload);

      expect(errorState()?.message).toBe('boom');
      expect(surfaces.unregisterAllPhaseSurfaces).toHaveBeenCalledTimes(1);
    });

    it('a fallback-warning is NOT a fatal error and does not tear down routing', () => {
      const payload: WizardErrorPayload = {
        type: 'fallback-warning',
        message: 'using quick analysis instead',
      } as unknown as WizardErrorPayload;

      phaseGen.handleError(payload);

      expect(fallbackWarning()).toBe('using quick analysis instead');
      expect(errorState()).toBeNull();
      expect(surfaces.unregisterAllPhaseSurfaces).not.toHaveBeenCalled();
    });
  });
});
