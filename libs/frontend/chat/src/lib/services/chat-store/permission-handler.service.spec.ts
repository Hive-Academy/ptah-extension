/**
 * PermissionHandlerService specs — permission + question request lifecycle.
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
 *   - `unmatchedPermissions` computed — fallback display for orphan perms
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
import { TabManagerService } from '../tab-manager.service';
import type { StreamingState } from '../chat.types';

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
      // which is out of scope for a unit spec. Left as .skip() — the behavior is
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
  });
});
