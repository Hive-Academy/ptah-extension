/**
 * WizardPhaseAnalysis spec.
 *
 * Verifies that the analysis-stream + analysis-complete handlers route
 * through the WizardSurfaceFacade:
 *   - `handleAnalysisStream` forwards `payload.flatEvent` to
 *     `surfaces.routePhaseEvent(phaseKey, event)` where `phaseKey` is the
 *     event's `messageId` (matching the legacy accumulator's keying).
 *   - `handleAnalysisComplete` calls
 *     `surfaces.unregisterAllPhaseSurfaces()` so routing is torn down but
 *     accumulated states remain visible (verified at the state-service
 *     level — this spec verifies the call is made).
 *   - Stream events without `flatEvent` are appended to `analysisStream`
 *     but DO NOT call the façade (back-compat — old payloads still work).
 */

import { signal, type WritableSignal } from '@angular/core';
import { WizardPhaseAnalysis } from './wizard-phase-analysis';
import type { WizardInternalState } from './wizard-internal-state';
import type { WizardSurfaceFacade } from '../setup-wizard-state.service';
import type {
  AnalysisCompletePayload,
  AnalysisStreamPayload,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { SurfaceId } from '@ptah-extension/chat-state';

describe('WizardPhaseAnalysis (TASK_2026_107 Phase 3)', () => {
  let analysisStream: WritableSignal<AnalysisStreamPayload[]>;
  let state: WizardInternalState;
  let surfaces: jest.Mocked<WizardSurfaceFacade>;
  let phaseAnalysis: WizardPhaseAnalysis;

  beforeEach(() => {
    analysisStream = signal<AnalysisStreamPayload[]>([]);

    // Minimal WizardInternalState stub — only the fields the handlers under
    // test touch are populated; the rest are no-op signals to satisfy the
    // type contract without standing up the real coordinator.
    state = {
      analysisStream,
      scanProgress: signal(null),
      generationProgress: signal(null),
      currentPhaseNumber: signal(null),
      totalPhaseCount: signal(null),
      phaseStatuses: signal([]),
      analysisResults: signal(null),
      projectContext: signal(null),
      availableAgents: signal([]),
      enhanceStream: signal([]),
      setStepToAnalysis: jest.fn(),
    } as unknown as WizardInternalState;

    surfaces = {
      ensurePhaseSurface: jest.fn().mockReturnValue(SurfaceId.create()),
      routePhaseEvent: jest.fn(),
      unregisterAllPhaseSurfaces: jest.fn(),
      resetPhaseSurfaces: jest.fn(),
    };

    phaseAnalysis = new WizardPhaseAnalysis(state, surfaces);
  });

  describe('handleAnalysisStream', () => {
    it('appends every payload to the analysisStream signal', () => {
      const payload: AnalysisStreamPayload = {
        kind: 'text',
        content: 'analyzing',
        timestamp: Date.now(),
      };

      phaseAnalysis.handleAnalysisStream(payload);

      expect(analysisStream()).toHaveLength(1);
      expect(analysisStream()[0]).toBe(payload);
    });

    it('routes flat events through the surface façade keyed by event.messageId', () => {
      const flatEvent = {
        eventType: 'message_start',
        messageId: 'wizard-phase-discovery',
        sessionId: 'sess-1',
      } as unknown as FlatStreamEventUnion;

      const payload: AnalysisStreamPayload = {
        kind: 'text',
        content: '',
        timestamp: Date.now(),
        flatEvent,
      };

      phaseAnalysis.handleAnalysisStream(payload);

      expect(surfaces.routePhaseEvent).toHaveBeenCalledTimes(1);
      expect(surfaces.routePhaseEvent).toHaveBeenCalledWith(
        'wizard-phase-discovery',
        flatEvent,
      );
    });

    it('does NOT call the façade when payload.flatEvent is missing (back-compat)', () => {
      const payload: AnalysisStreamPayload = {
        kind: 'status',
        content: 'still working',
        timestamp: Date.now(),
      };

      phaseAnalysis.handleAnalysisStream(payload);

      expect(surfaces.routePhaseEvent).not.toHaveBeenCalled();
      // Payload still appended to the stream signal regardless.
      expect(analysisStream()).toHaveLength(1);
    });

    it('routes successive events for the same phase to the same phaseKey', () => {
      const evt1 = {
        eventType: 'message_start',
        messageId: 'wizard-phase-arch',
        sessionId: 'sess-1',
      } as unknown as FlatStreamEventUnion;
      const evt2 = {
        eventType: 'text_delta',
        messageId: 'wizard-phase-arch',
        sessionId: 'sess-1',
        blockIndex: 0,
        delta: 'hi',
      } as unknown as FlatStreamEventUnion;

      phaseAnalysis.handleAnalysisStream({
        kind: 'text',
        content: '',
        timestamp: 1,
        flatEvent: evt1,
      });
      phaseAnalysis.handleAnalysisStream({
        kind: 'text',
        content: '',
        timestamp: 2,
        flatEvent: evt2,
      });

      expect(surfaces.routePhaseEvent).toHaveBeenCalledTimes(2);
      expect(surfaces.routePhaseEvent.mock.calls[0][0]).toBe(
        'wizard-phase-arch',
      );
      expect(surfaces.routePhaseEvent.mock.calls[1][0]).toBe(
        'wizard-phase-arch',
      );
    });

    it('routes events for distinct phases to distinct phaseKeys', () => {
      const evtDiscovery = {
        eventType: 'message_start',
        messageId: 'wizard-phase-discovery',
        sessionId: 'sess-1',
      } as unknown as FlatStreamEventUnion;
      const evtArch = {
        eventType: 'message_start',
        messageId: 'wizard-phase-arch',
        sessionId: 'sess-1',
      } as unknown as FlatStreamEventUnion;

      phaseAnalysis.handleAnalysisStream({
        kind: 'text',
        content: '',
        timestamp: 1,
        flatEvent: evtDiscovery,
      });
      phaseAnalysis.handleAnalysisStream({
        kind: 'text',
        content: '',
        timestamp: 2,
        flatEvent: evtArch,
      });

      expect(surfaces.routePhaseEvent.mock.calls[0][0]).toBe(
        'wizard-phase-discovery',
      );
      expect(surfaces.routePhaseEvent.mock.calls[1][0]).toBe(
        'wizard-phase-arch',
      );
    });
  });

  describe('handleAnalysisComplete', () => {
    it('persists analysisResults + projectContext + advances step', () => {
      const payload: AnalysisCompletePayload = {
        projectContext: {
          type: 'Angular',
          techStack: ['TypeScript', 'Angular'],
          architecture: 'spa',
          isMonorepo: false,
        },
      } as unknown as AnalysisCompletePayload;

      phaseAnalysis.handleAnalysisComplete(payload);

      expect(state.analysisResults()).not.toBeNull();
      expect(state.projectContext()?.type).toBe('Angular');
      expect(state.setStepToAnalysis).toHaveBeenCalledTimes(1);
    });

    it('tears down routing for every phase via unregisterAllPhaseSurfaces (states preserved)', () => {
      const payload: AnalysisCompletePayload = {
        projectContext: {
          type: 'Angular',
          techStack: [],
          isMonorepo: false,
        },
      } as unknown as AnalysisCompletePayload;

      phaseAnalysis.handleAnalysisComplete(payload);

      expect(surfaces.unregisterAllPhaseSurfaces).toHaveBeenCalledTimes(1);
      // Crucially does NOT call resetPhaseSurfaces — the full nuke would
      // wipe completed-phase StreamingStates from the transcript.
      expect(surfaces.resetPhaseSurfaces).not.toHaveBeenCalled();
    });
  });
});
