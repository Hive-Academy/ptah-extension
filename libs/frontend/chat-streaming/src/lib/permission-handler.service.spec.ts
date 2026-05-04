/**
 * PermissionHandlerService specs â€” permission + question request lifecycle.
 *
 * Coverage:
 *   - `handlePermissionRequest` appends, high-latency warning
 *   - `handlePermissionResponse` removes + posts SDK_PERMISSION_RESPONSE,
 *     tracks hard-deny ids (with agentToolCallId preference)
 *   - `handlePermissionAutoResolved` removes by id
 *   - `consumeHardDenyToolUseIds` reads + resets
 *   - `getPermissionByToolId` / `getPermissionForTool` lookup
 *   - `handleQuestionRequest` / `handleQuestionResponse`
 *   - `cleanupSession` clears both pools for the sessionId
 *   - `unmatchedPermissions` computed â€” fallback display for orphan perms
 */

import { TestBed, ApplicationRef } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import {
  MESSAGE_TYPES,
  UNKNOWN_AGENT_TOOL_CALL_ID,
  type PermissionRequest,
  type AskUserQuestionRequest,
} from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';
import { PermissionHandlerService } from './permission-handler.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState } from '@ptah-extension/chat-types';

interface TabManagerSignalsMock {
  activeTabId: ReturnType<typeof signal<string | null>>;
  activeTabMessages: ReturnType<typeof signal<unknown[]>>;
  activeTabStreamingState: ReturnType<typeof signal<StreamingState | null>>;
}

function makePermissionRequest(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: 'req-1',
    toolName: 'Bash',
    toolUseId: 'tool-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    ...overrides,
  } as PermissionRequest;
}

function makeQuestionRequest(
  overrides: Partial<AskUserQuestionRequest> = {},
): AskUserQuestionRequest {
  return {
    id: 'q-1',
    toolUseId: 'tool-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    timeoutAt: 0,
    question: 'Proceed?',
    options: [],
    ...overrides,
  } as AskUserQuestionRequest;
}

function emptyStreamingState(): StreamingState {
  return {
    events: new Map(),
    messageEventIds: [],
    toolCallMap: new Map(),
    textAccumulators: new Map(),
    toolInputAccumulators: new Map(),
    agentSummaryAccumulators: new Map(),
    agentContentBlocksMap: new Map(),
    currentMessageId: null,
    currentTokenUsage: null,
    eventsByMessage: new Map(),
    pendingStats: null,
  };
}

describe('PermissionHandlerService', () => {
  let service: PermissionHandlerService;
  let tabSignals: TabManagerSignalsMock;
  let vscodePostMessage: jest.Mock;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    tabSignals = {
      activeTabId: signal<string | null>('tab-1'),
      activeTabMessages: signal<unknown[]>([]),
      activeTabStreamingState: signal<StreamingState | null>(null),
    };
    vscodePostMessage = jest.fn();

    const tabManagerMock = {
      activeTabId: computed(() => tabSignals.activeTabId()),
      activeTabMessages: computed(() => tabSignals.activeTabMessages()),
      activeTabStreamingState: computed(() =>
        tabSignals.activeTabStreamingState(),
      ),
    } as unknown as TabManagerService;

    const vscodeMock = {
      postMessage: vscodePostMessage,
    } as unknown as VSCodeService;

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        PermissionHandlerService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: VSCodeService, useValue: vscodeMock },
      ],
    });
    service = TestBed.inject(PermissionHandlerService);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('handlePermissionRequest', () => {
    it('appends the request and exposes it via the readonly signal', () => {
      const req = makePermissionRequest();
      service.handlePermissionRequest(req);
      expect(service.permissionRequests()).toEqual([req]);
    });

    it('warns when latency exceeds 100ms', () => {
      const req = makePermissionRequest({ timestamp: Date.now() - 500 });
      service.handlePermissionRequest(req);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('High permission latency'),
        expect.stringContaining('ms'),
      );
    });

    it('does not warn when timestamp is undefined', () => {
      const req = makePermissionRequest();
      delete (req as Partial<PermissionRequest>).timestamp;
      service.handlePermissionRequest(req);
      expect(consoleWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('High permission latency'),
        expect.anything(),
      );
    });
  });

  describe('handlePermissionResponse', () => {
    it('removes the request and posts SDK_PERMISSION_RESPONSE', () => {
      const req = makePermissionRequest();
      service.handlePermissionRequest(req);

      service.handlePermissionResponse({
        id: 'req-1',
        decision: 'allow',
      } as never);

      expect(service.permissionRequests()).toEqual([]);
      expect(vscodePostMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.SDK_PERMISSION_RESPONSE,
        response: { id: 'req-1', decision: 'allow' },
      });
    });

    it('tracks deny toolCallIds when agentToolCallId is set', () => {
      const req = makePermissionRequest({ agentToolCallId: 'agent-tool-7' });
      service.handlePermissionRequest(req);

      service.handlePermissionResponse({
        id: 'req-1',
        decision: 'deny',
      } as never);

      const ids = service.consumeHardDenyToolUseIds();
      expect(ids.has('agent-tool-7')).toBe(true);
      // Consume resets.
      expect(service.consumeHardDenyToolUseIds().size).toBe(0);
    });

    it('falls back to UNKNOWN_AGENT_TOOL_CALL_ID when agentToolCallId missing on deny', () => {
      service.handlePermissionRequest(makePermissionRequest());
      service.handlePermissionResponse({
        id: 'req-1',
        decision: 'deny',
      } as never);

      const ids = service.consumeHardDenyToolUseIds();
      expect(ids.has(UNKNOWN_AGENT_TOOL_CALL_ID)).toBe(true);
    });

    it('does not track deny ids on allow decisions', () => {
      service.handlePermissionRequest(makePermissionRequest());
      service.handlePermissionResponse({
        id: 'req-1',
        decision: 'allow',
      } as never);
      expect(service.consumeHardDenyToolUseIds().size).toBe(0);
    });

    it('forwards deny_with_message + reason payload (auto-deny mid-stream path)', () => {
      // message-dispatch.service.ts:73-82 â€” when a new user message arrives
      // mid-stream, all in-flight permissions are auto-resolved with
      // `decision: 'deny_with_message'` and `reason: <user content>` so the
      // SDK keeps running rather than being killed.
      service.handlePermissionRequest(makePermissionRequest({ id: 'req-mid' }));
      service.handlePermissionResponse({
        id: 'req-mid',
        decision: 'deny_with_message',
        reason: 'do this instead',
      } as never);

      expect(service.permissionRequests()).toEqual([]);
      expect(vscodePostMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.SDK_PERMISSION_RESPONSE,
        response: {
          id: 'req-mid',
          decision: 'deny_with_message',
          reason: 'do this instead',
        },
      });
      // deny_with_message is NOT a hard deny â€” must not mark for interruption.
      expect(service.consumeHardDenyToolUseIds().size).toBe(0);
    });

    it('resolves multiple in-flight requests independently (no cross-leak)', () => {
      const reqA = makePermissionRequest({
        id: 'req-A',
        toolUseId: 'tool-A',
        sessionId: 'sess-1',
      });
      const reqB = makePermissionRequest({
        id: 'req-B',
        toolUseId: 'tool-B',
        sessionId: 'sess-1',
      });
      const reqC = makePermissionRequest({
        id: 'req-C',
        toolUseId: 'tool-C',
        sessionId: 'sess-2',
      });

      service.handlePermissionRequest(reqA);
      service.handlePermissionRequest(reqB);
      service.handlePermissionRequest(reqC);
      expect(service.permissionRequests()).toHaveLength(3);

      // Resolve B with allow â€” A and C must remain.
      service.handlePermissionResponse({
        id: 'req-B',
        decision: 'allow',
      } as never);
      expect(service.permissionRequests().map((r) => r.id)).toEqual([
        'req-A',
        'req-C',
      ]);

      // Resolve A with deny_with_message â€” only C remains.
      service.handlePermissionResponse({
        id: 'req-A',
        decision: 'deny_with_message',
        reason: 'changed my mind',
      } as never);
      expect(service.permissionRequests().map((r) => r.id)).toEqual(['req-C']);

      // Resolve C with hard deny â€” list now empty, only C marks hardDeny.
      service.handlePermissionResponse({
        id: 'req-C',
        decision: 'deny',
      } as never);
      expect(service.permissionRequests()).toEqual([]);

      // The two RPCs that were sent must each carry their own id/decision â€”
      // verify no payload mixing across resolutions.
      const responses = vscodePostMessage.mock.calls.map(
        (c) => (c[0] as { response: unknown }).response,
      );
      expect(responses).toEqual([
        { id: 'req-B', decision: 'allow' },
        {
          id: 'req-A',
          decision: 'deny_with_message',
          reason: 'changed my mind',
        },
        { id: 'req-C', decision: 'deny' },
      ]);
    });
  });

  describe('handlePermissionAutoResolved', () => {
    it('removes the request by id without posting a response', () => {
      service.handlePermissionRequest(makePermissionRequest({ id: 'req-A' }));
      service.handlePermissionRequest(makePermissionRequest({ id: 'req-B' }));

      service.handlePermissionAutoResolved({
        id: 'req-A',
        toolName: 'Bash',
      });

      expect(service.permissionRequests().map((r) => r.id)).toEqual(['req-B']);
      expect(vscodePostMessage).not.toHaveBeenCalled();
    });
  });

  describe('permission lookup', () => {
    it('getPermissionByToolId returns the matching request', () => {
      const req = makePermissionRequest({ toolUseId: 'tool-XYZ' });
      service.handlePermissionRequest(req);
      expect(service.getPermissionByToolId('tool-XYZ')).toBe(req);
      expect(service.getPermissionByToolId('missing')).toBeUndefined();
    });

    it('getPermissionForTool returns null when toolCallId is undefined', () => {
      expect(service.getPermissionForTool(undefined)).toBeNull();
    });

    it('getPermissionForTool returns null when no match', () => {
      service.handlePermissionRequest(makePermissionRequest());
      expect(service.getPermissionForTool('other')).toBeNull();
    });

    it('getPermissionForTool returns the matching request', () => {
      const req = makePermissionRequest({ toolUseId: 'tool-abc' });
      service.handlePermissionRequest(req);
      expect(service.getPermissionForTool('tool-abc')).toBe(req);
    });
  });

  describe('unmatchedPermissions computed', () => {
    it('returns [] when no permissions are active', () => {
      expect(service.unmatchedPermissions()).toEqual([]);
    });

    it('flags permissions with no toolUseId as unmatched', () => {
      const req = makePermissionRequest({ toolUseId: undefined as never });
      service.handlePermissionRequest(req);
      expect(service.unmatchedPermissions()).toEqual([req]);
    });

    it('flags a permission as matched when its toolUseId appears in the live toolCallMap', () => {
      const req = makePermissionRequest({ toolUseId: 'tool-live' });
      service.handlePermissionRequest(req);

      const streaming = emptyStreamingState();
      streaming.toolCallMap.set('tool-live', []);
      tabSignals.activeTabStreamingState.set(streaming);

      expect(service.unmatchedPermissions()).toEqual([]);
    });

    it('flags a permission as unmatched when its toolUseId is nowhere in the tree', () => {
      const req = makePermissionRequest({ toolUseId: 'tool-orphan' });
      service.handlePermissionRequest(req);
      tabSignals.activeTabStreamingState.set(emptyStreamingState());
      expect(service.unmatchedPermissions()).toEqual([req]);
    });
  });

  describe('AskUserQuestion', () => {
    it('handleQuestionRequest appends to questionRequests', () => {
      const q = makeQuestionRequest();
      service.handleQuestionRequest(q);
      expect(service.questionRequests()).toEqual([q]);
    });

    it('handleQuestionResponse removes the request and posts ASK_USER_QUESTION_RESPONSE', () => {
      service.handleQuestionRequest(makeQuestionRequest({ id: 'q-1' }));
      service.handleQuestionResponse({
        id: 'q-1',
        answers: { a: 'yes' },
      } as never);

      expect(service.questionRequests()).toEqual([]);
      expect(vscodePostMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE,
        payload: { id: 'q-1', answers: { a: 'yes' } },
      });
    });

    it('getQuestionForTool returns the matching request', () => {
      const q = makeQuestionRequest({ toolUseId: 'q-tool' });
      service.handleQuestionRequest(q);
      expect(service.getQuestionForTool('q-tool')).toBe(q);
      expect(service.getQuestionForTool(undefined)).toBeNull();
      expect(service.getQuestionForTool('missing')).toBeNull();
    });

    it.skip('cleanup effect removes expired requests (needs component harness)', () => {
      // The cleanup effect runs on change detection in zoneless Angular 21.
      // Firing it from a pure service spec requires a host component + detectChanges,
      // which is out of scope for a unit spec. Left as .skip() â€” the behavior is
      // exercised end-to-end in the chat flow integration specs.
      const q = makeQuestionRequest({
        id: 'q-expire',
        timeoutAt: Date.now() - 1000,
      });
      service.handleQuestionRequest(q);
      TestBed.inject(ApplicationRef).tick();
      expect(service.questionRequests()).toEqual([]);
    });
  });

  describe('cleanupSession', () => {
    it('clears permission and question requests matching the sessionId', () => {
      service.handlePermissionRequest(
        makePermissionRequest({ id: 'p-1', sessionId: 'sess-A' }),
      );
      service.handlePermissionRequest(
        makePermissionRequest({ id: 'p-2', sessionId: 'sess-B' }),
      );
      service.handleQuestionRequest(
        makeQuestionRequest({ id: 'q-1', sessionId: 'sess-A' }),
      );
      service.handleQuestionRequest(
        makeQuestionRequest({ id: 'q-2', sessionId: 'sess-B' }),
      );

      service.cleanupSession('sess-A');

      expect(service.permissionRequests().map((r) => r.id)).toEqual(['p-2']);
      expect(service.questionRequests().map((r) => r.id)).toEqual(['q-2']);
    });

    it('clears prompt target tabs for matching sessionId', () => {
      service.handlePermissionRequest(
        makePermissionRequest({ id: 'p-1', sessionId: 'sess-A' }),
      );
      service.attachPromptTargets('p-1', ['tab-1', 'tab-2']);
      expect(service.targetTabsFor('p-1')).toEqual(['tab-1', 'tab-2']);

      service.cleanupSession('sess-A');

      expect(service.targetTabsFor('p-1')).toEqual([]);
    });
  });

  describe('TASK_2026_106 Phase 6a — fan-out target tracking', () => {
    describe('attachPromptTargets', () => {
      it('records the resolved target tabs for a prompt', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.attachPromptTargets('p-1', ['tab-1', 'tab-2', 'tab-3']);
        expect(service.targetTabsFor('p-1')).toEqual([
          'tab-1',
          'tab-2',
          'tab-3',
        ]);
      });

      it('is a no-op when tabIds is empty (router fall-back)', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.attachPromptTargets('p-1', []);
        expect(service.targetTabsFor('p-1')).toEqual([]);
      });

      it('overwrites a prior target list for the same prompt', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.attachPromptTargets('p-1', ['tab-1']);
        service.attachPromptTargets('p-1', ['tab-2', 'tab-3']);
        expect(service.targetTabsFor('p-1')).toEqual(['tab-2', 'tab-3']);
      });

      it('defensively copies the input array (caller mutation safe)', () => {
        const inputTabs: string[] = ['tab-1', 'tab-2'];
        service.attachPromptTargets('p-1', inputTabs);
        inputTabs.push('tab-3');
        expect(service.targetTabsFor('p-1')).toEqual(['tab-1', 'tab-2']);
      });
    });

    describe('targetTabsFor', () => {
      it('returns empty array for an unknown promptId', () => {
        expect(service.targetTabsFor('unknown')).toEqual([]);
      });
    });

    describe('cancelPrompt', () => {
      it('removes the prompt from the queue and clears its target tabs', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.attachPromptTargets('p-1', ['tab-1', 'tab-2']);

        service.cancelPrompt('p-1', 'tab-1');

        expect(service.permissionRequests()).toEqual([]);
        expect(service.targetTabsFor('p-1')).toEqual([]);
      });

      it('is idempotent (cancelling an already-removed prompt is a no-op)', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.cancelPrompt('p-1', null);
        expect(() => service.cancelPrompt('p-1', null)).not.toThrow();
        expect(service.permissionRequests()).toEqual([]);
      });

      it('does NOT emit decisionPulse (no router-effect feedback loop)', () => {
        const before = service.decisionPulse();
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.cancelPrompt('p-1', 'tab-1');
        expect(service.decisionPulse()).toBe(before);
      });

      it('does not affect other prompts in the queue', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-2' }));
        service.attachPromptTargets('p-1', ['tab-1']);
        service.attachPromptTargets('p-2', ['tab-2']);

        service.cancelPrompt('p-1', null);

        expect(service.permissionRequests().map((r) => r.id)).toEqual(['p-2']);
        expect(service.targetTabsFor('p-2')).toEqual(['tab-2']);
      });
    });

    describe('decisionPulse on handlePermissionResponse', () => {
      it('emits a pulse with promptId, decidingTabId (active tab), and incrementing seq', () => {
        tabSignals.activeTabId.set('tab-deciding');
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.attachPromptTargets('p-1', ['tab-deciding', 'tab-other']);

        service.handlePermissionResponse({
          id: 'p-1',
          decision: 'allow',
        } as never);

        const pulse = service.decisionPulse();
        expect(pulse).not.toBeNull();
        expect(pulse?.promptId).toBe('p-1');
        expect(pulse?.decidingTabId).toBe('tab-deciding');
        expect(pulse?.seq).toBeGreaterThan(0);
      });

      it('passes null decidingTabId when no active tab', () => {
        tabSignals.activeTabId.set(null);
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));

        service.handlePermissionResponse({
          id: 'p-1',
          decision: 'allow',
        } as never);

        expect(service.decisionPulse()?.decidingTabId).toBeNull();
      });

      it('emits a fresh pulse with a higher seq for each response', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-2' }));

        service.handlePermissionResponse({
          id: 'p-1',
          decision: 'allow',
        } as never);
        const seq1 = service.decisionPulse()?.seq ?? 0;

        service.handlePermissionResponse({
          id: 'p-2',
          decision: 'deny',
        } as never);
        const seq2 = service.decisionPulse()?.seq ?? 0;

        expect(seq2).toBeGreaterThan(seq1);
        expect(service.decisionPulse()?.promptId).toBe('p-2');
      });

      it('clears prompt target tabs after a decision', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.attachPromptTargets('p-1', ['tab-1', 'tab-2']);

        service.handlePermissionResponse({
          id: 'p-1',
          decision: 'allow',
        } as never);

        expect(service.targetTabsFor('p-1')).toEqual([]);
      });
    });

    describe('handlePermissionAutoResolved', () => {
      it('clears target tabs for the auto-resolved prompt', () => {
        service.handlePermissionRequest(makePermissionRequest({ id: 'p-1' }));
        service.attachPromptTargets('p-1', ['tab-1', 'tab-2']);

        service.handlePermissionAutoResolved({ id: 'p-1', toolName: 'Bash' });

        expect(service.targetTabsFor('p-1')).toEqual([]);
      });
    });
  });

  // ============================================================================
  // TASK_2026_109_FOLLOWUP_QUESTIONS — Q9 duplicate-id guard + Q10 cancellation
  // ============================================================================

  describe('TASK_2026_109_FOLLOWUP_QUESTIONS Q9 — duplicate-id guard', () => {
    it('Q9: handleQuestionRequest skips a request whose id already exists in the queue (warn + no double-append)', () => {
      const q1 = makeQuestionRequest({ id: 'dup' });
      const q2 = makeQuestionRequest({ id: 'dup', question: 'second arrival' });

      service.handleQuestionRequest(q1);
      service.handleQuestionRequest(q2);

      expect(service.questionRequests()).toHaveLength(1);
      // First-arrival wins — second arrival is dropped.
      expect(service.questionRequests()[0]).toBe(q1);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('question.duplicate-id'),
        expect.objectContaining({ id: 'dup' }),
      );
    });

    it('Q9: attachQuestionTargets refuses to overwrite an existing resolved target list (warn + skip)', () => {
      service.handleQuestionRequest(makeQuestionRequest({ id: 'q-attach' }));
      service.attachQuestionTargets('q-attach', ['tab-A']);

      // Second attach with a DIFFERENT target list — must be ignored to
      // avoid stomping a fresh resolution with a duplicate.
      service.attachQuestionTargets('q-attach', ['tab-B', 'tab-C']);

      expect(service.questionTargetTabsFor('q-attach')).toEqual(['tab-A']);
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('question.duplicate-id'),
        expect.objectContaining({
          id: 'q-attach',
          scope: 'targets',
        }),
      );
    });

    it('Q9: clearQuestionTargets allows attachQuestionTargets to install a fresh list (refresh path)', () => {
      service.handleQuestionRequest(makeQuestionRequest({ id: 'q-refresh' }));
      service.attachQuestionTargets('q-refresh', ['tab-A']);

      // Documented escape hatch for the Q6/Q7 refresh paths — clear before
      // re-attaching is the contract.
      service.clearQuestionTargets('q-refresh');
      service.attachQuestionTargets('q-refresh', ['tab-B']);

      expect(service.questionTargetTabsFor('q-refresh')).toEqual(['tab-B']);
    });
  });

  describe('TASK_2026_109_FOLLOWUP_QUESTIONS Q10 — cancelQuestion + clearQuestionTargets', () => {
    it('Q10: cancelQuestion removes the question from the queue AND drops its targets', () => {
      service.handleQuestionRequest(makeQuestionRequest({ id: 'q-cancel' }));
      service.attachQuestionTargets('q-cancel', ['tab-A', 'tab-B']);

      service.cancelQuestion('q-cancel', 'tab-A');

      expect(service.questionRequests()).toHaveLength(0);
      expect(service.questionTargetTabsFor('q-cancel')).toEqual([]);
    });

    it('Q10: cancelQuestion is idempotent — second call on already-cancelled id is a no-op', () => {
      service.handleQuestionRequest(makeQuestionRequest({ id: 'q-idem' }));
      service.cancelQuestion('q-idem', null);
      // Second cancel must not throw and must keep the queue empty.
      expect(() => service.cancelQuestion('q-idem', null)).not.toThrow();
      expect(service.questionRequests()).toHaveLength(0);
    });

    it('Q10: clearQuestionTargets is idempotent — clearing an unresolved target list is a no-op', () => {
      expect(() => service.clearQuestionTargets('never-existed')).not.toThrow();
      expect(service.questionTargetTabsFor('never-existed')).toEqual([]);
    });
  });
});
