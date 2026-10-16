import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { VSCodeService } from '@ptah-extension/core';
import type {
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';

/** The shared chat embed selects requests by its pinned tab ID. */
describe('Builder session prompt isolation', () => {
  let permissions: PermissionHandlerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PermissionHandlerService,
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'builder-tab' }, { id: 'other-tab' }]),
          },
        },
        { provide: VSCodeService, useValue: { postMessage: jest.fn() } },
      ],
    });
    permissions = TestBed.inject(PermissionHandlerService);
  });

  it('keeps delayed permission targets on the builder tab', () => {
    const request = {
      id: 'permission-1',
      toolName: 'Bash',
      toolUseId: 'tool-1',
      sessionId: 'session-1',
      timestamp: Date.now(),
    } as PermissionRequest;
    permissions.handlePermissionRequest(request);
    expect(permissions.targetTabsFor(request.id)).toEqual([]);
    permissions.attachPromptTargets(request.id, ['builder-tab']);
    expect(permissions.targetTabsFor(request.id)).toEqual(['builder-tab']);
    expect(permissions.targetTabsFor(request.id)).not.toContain('other-tab');
  });

  it('keeps delayed question targets on the builder tab', () => {
    const request = {
      id: 'question-1',
      toolUseId: 'tool-1',
      sessionId: 'session-1',
      timestamp: Date.now(),
      timeoutAt: 0,
      question: 'Choose one',
      options: [],
    } as AskUserQuestionRequest;
    permissions.handleQuestionRequest(request);
    expect(permissions.questionTargetTabsFor(request.id)).toEqual([]);
    permissions.attachQuestionTargets(request.id, ['builder-tab']);
    expect(permissions.questionTargetTabsFor(request.id)).toEqual([
      'builder-tab',
    ]);
    expect(permissions.questionTargetTabsFor(request.id)).not.toContain(
      'other-tab',
    );
  });
});
