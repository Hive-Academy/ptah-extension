import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatStore } from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import { CommandCenterStore } from '../model/command-center.store';
import {
  CommandCenterQuestionProvider,
  isIdleWithoutPendingRequest,
} from './command-center-question.provider';

describe('CommandCenterQuestionProvider', () => {
  const tabs = signal([{ id: 'root', status: 'loaded' }]);
  const questionRequests = signal<{
    id: string;
    tabId: string;
    questions: {
      question: string;
      header: string;
      options: { label: string; description: string }[];
    }[];
  }[]>([]);
  const permissionRequests = signal<{
    id: string;
    tabId: string;
    toolName: string;
    description: string;
  }[]>([]);
  let provider: CommandCenterQuestionProvider;
  let store: CommandCenterStore;
  let spoken: jest.Mock;

  beforeEach(() => {
    tabs.set([{ id: 'root', status: 'loaded' }]);
    questionRequests.set([]);
    permissionRequests.set([]);
    store = new CommandCenterStore();
    store.setSession('root', 'session', '/workspace');
    spoken = jest.fn();
    TestBed.configureTestingModule({});
    provider = TestBed.runInInjectionContext(
      () =>
        new CommandCenterQuestionProvider(
          store,
          Object.assign(Object.create(null) as ChatStore, {
            questionRequests,
            permissionRequests,
          }),
          spoken,
        ),
    );
  });

  it('shows an ordinary question with all answer choices and speaks it once', () => {
    questionRequests.set([
      {
        id: 'q1',
        tabId: 'root',
        questions: [
          {
            question: 'Proceed?',
            header: 'Choice',
            options: [
              { label: 'Decline', description: '' },
              { label: 'Confirm', description: '' },
            ],
          },
        ],
      },
    ]);
    TestBed.tick();
    expect(provider.ordinaryChoices()).toEqual(['Decline', 'Confirm']);
    expect(provider.shownInput()).toMatchObject({
      id: 'q1',
      kind: 'question',
      description: 'Proceed?',
    });
    expect(store.pendingInput()?.id).toBe('q1');
    expect(spoken).toHaveBeenCalledWith('Proceed?');
    TestBed.tick();
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('prioritizes permission and restores the ordinary question', () => {
    questionRequests.set([
      {
        id: 'q1',
        tabId: 'root',
        questions: [{ question: 'Proceed?', header: 'Choice', options: [] }],
      },
    ]);
    permissionRequests.set([
      {
        id: 'p1',
        tabId: 'root',
        toolName: 'Write',
        description: 'Write a file',
      },
    ]);
    TestBed.tick();
    expect(provider.shownInput()).toMatchObject({ id: 'p1', kind: 'approval' });
    permissionRequests.set([]);
    TestBed.tick();
    expect(provider.shownInput()?.id).toBe('q1');
  });

  it('requires an idle tab with no pending root request', () => {
    const tabService = Object.assign(Object.create(null) as TabManagerService, {
      tabs,
    });
    const chat = Object.assign(Object.create(null) as ChatStore, {
      questionRequests,
      permissionRequests,
    });
    expect(
      isIdleWithoutPendingRequest(tabService, chat, 'root', 'session'),
    ).toBe(true);
    questionRequests.set([{ id: 'q1', tabId: 'root', questions: [] }]);
    expect(
      isIdleWithoutPendingRequest(tabService, chat, 'root', 'session'),
    ).toBe(false);
  });
});
