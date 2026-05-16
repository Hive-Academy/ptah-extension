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

  describe('handleGenerationComplete', () => {
    it('persists completionData and tears down routing via unregisterAllPhaseSurfaces', () => {
      const payload: GenerationCompletePayload = {
        success: true,
        generatedCount: 3,
        duration: 1000,
      } as unknown as GenerationCompletePayload;

      phaseGen.handleGenerationComplete(payload);

      expect(completionData()).not.toBeNull();
      expect(state.setCurrentStepIfGeneration).toHaveBeenCalledTimes(1);
      expect(surfaces.unregisterAllPhaseSurfaces).toHaveBeenCalledTimes(1);
      // Full nuke is reserved for the next pass start (handleGenerationStream
      // first-event reset) and for explicit wizard reset.
      expect(surfaces.resetPhaseSurfaces).not.toHaveBeenCalled();
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
