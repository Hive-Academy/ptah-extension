import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  SessionId,
  type SessionHandoverState,
  type SessionSuccessorReplacementPayload,
} from '@ptah-extension/shared';
import { SessionHandoverClientService } from './session-handover-client.service';

const SOURCE_SESSION = SessionId.create();
const SUCCESSOR_SESSION = SessionId.create();
const SOURCE_TAB = 'tab-source';

function handover(
  overrides: Partial<SessionHandoverState> = {},
): SessionHandoverState {
  return {
    operationId: 'handover-1',
    sourceSessionId: SOURCE_SESSION,
    reason: 'budget-limit',
    phase: 'starting-successor',
    revision: 3,
    heldInputCount: 1,
    ...overrides,
  };
}

function replacement(
  overrides: Partial<SessionSuccessorReplacementPayload> = {},
): SessionSuccessorReplacementPayload {
  return {
    operationId: 'handover-1',
    sourceSessionId: SOURCE_SESSION,
    sourceTabId: SOURCE_TAB,
    successorSessionId: SUCCESSOR_SESSION,
    successorTabId: 'tab-successor',
    config: { model: 'gpt-5', effort: 'high', workspacePath: 'D:/repo' },
    ...overrides,
  };
}

describe('SessionHandoverClientService', () => {
  let service: SessionHandoverClientService;
  let tabManager: {
    findTabByIdAcrossWorkspaces: jest.Mock;
    rebindTabSession: jest.Mock;
    setOverrideModel: jest.Mock;
    setOverrideEffort: jest.Mock;
    switchTab: jest.Mock;
  };
  let rpc: { call: jest.Mock };

  beforeEach(() => {
    tabManager = {
      findTabByIdAcrossWorkspaces: jest.fn(() => ({
        tab: { claudeSessionId: SOURCE_SESSION, title: 'Source' },
        workspacePath: 'D:/repo',
      })),
      rebindTabSession: jest.fn(),
      setOverrideModel: jest.fn(),
      setOverrideEffort: jest.fn(),
      switchTab: jest.fn(),
    };
    rpc = { call: jest.fn().mockResolvedValue({}) };
    TestBed.configureTestingModule({
      providers: [
        SessionHandoverClientService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    service = TestBed.inject(SessionHandoverClientService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('rebinds and focuses the source slot before acknowledging the successor', async () => {
    service.record(SOURCE_SESSION, handover());

    await service.bindSuccessor(replacement());

    expect(tabManager.rebindTabSession).toHaveBeenCalledWith(
      SOURCE_TAB,
      SUCCESSOR_SESSION,
      'Source',
    );
    expect(tabManager.setOverrideModel).toHaveBeenCalledWith(SOURCE_TAB, 'gpt-5');
    expect(tabManager.setOverrideEffort).toHaveBeenCalledWith(SOURCE_TAB, 'high');
    expect(tabManager.switchTab).toHaveBeenCalledWith(SOURCE_TAB);
    expect(rpc.call).toHaveBeenCalledWith('session:successorBound', {
      operationId: 'handover-1',
      sourceTabId: SOURCE_TAB,
      successorTabId: 'tab-successor',
    });
    expect(tabManager.rebindTabSession.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.call.mock.invocationCallOrder[0],
    );
  });

  it('rejects stale revisions and a replacement for an old operation', async () => {
    expect(service.record(SOURCE_SESSION, handover())).toBe(true);
    expect(
      service.record(
        SOURCE_SESSION,
        handover({ operationId: 'old-operation', revision: 2 }),
      ),
    ).toBe(false);

    await service.bindSuccessor(replacement({ operationId: 'old-operation' }));

    expect(tabManager.rebindTabSession).not.toHaveBeenCalled();
    expect(rpc.call).not.toHaveBeenCalled();
  });

  // TASK_2026_627 S20 (D24): a returned draft is peeked, then acknowledged.
  describe('draft bookkeeping', () => {
    it.each(['cancelled', 'failed'] as const)(
      'peekDraft returns the draft of a %s handover and changes nothing',
      (phase) => {
        service.record(
          SOURCE_SESSION,
          handover({ phase, draftText: 'my unsent message' }),
        );

        const first = service.peekDraft(SOURCE_SESSION);
        const second = service.peekDraft(SOURCE_SESSION);

        expect(first).toEqual({
          operationId: 'handover-1',
          text: 'my unsent message',
        });
        expect(second).toEqual(first);
        expect(rpc.call).not.toHaveBeenCalled();
      },
    );

    it.each([
      'waiting-for-turn-end',
      'awaiting-confirmation',
      'starting-successor',
      'closed',
    ] as const)('peekDraft ignores a draft on a %s state', (phase) => {
      service.record(
        SOURCE_SESSION,
        handover({ phase, draftText: 'my unsent message' }),
      );

      expect(service.peekDraft(SOURCE_SESSION)).toBeNull();
    });

    it('peekDraft returns null without a non-empty string draft', () => {
      expect(service.peekDraft(SOURCE_SESSION)).toBeNull();
      expect(service.peekDraft(null)).toBeNull();

      service.record(SOURCE_SESSION, handover({ phase: 'cancelled' }));
      expect(service.peekDraft(SOURCE_SESSION)).toBeNull();

      service.record(
        SOURCE_SESSION,
        handover({ phase: 'cancelled', revision: 4, draftText: '   ' }),
      );
      expect(service.peekDraft(SOURCE_SESSION)).toBeNull();

      // The boundary guard does not check `draftText`; a non-string is ignored.
      service.record(SOURCE_SESSION, {
        ...handover({ phase: 'failed', revision: 5 }),
        draftText: 42,
      });
      expect(service.peekDraft(SOURCE_SESSION)).toBeNull();
    });

    it('acknowledgeDraft hides that operation only', () => {
      service.record(
        SOURCE_SESSION,
        handover({ phase: 'cancelled', draftText: 'first draft' }),
      );

      service.acknowledgeDraft('handover-1');
      expect(service.peekDraft(SOURCE_SESSION)).toBeNull();

      service.record(
        SOURCE_SESSION,
        handover({
          operationId: 'handover-2',
          phase: 'failed',
          revision: 9,
          draftText: 'second draft',
        }),
      );
      expect(service.peekDraft(SOURCE_SESSION)).toEqual({
        operationId: 'handover-2',
        text: 'second draft',
      });
    });
  });
});
