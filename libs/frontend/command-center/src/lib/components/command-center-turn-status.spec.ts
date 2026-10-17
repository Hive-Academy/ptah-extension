import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  TabManagerService,
  TerminalTurnPulse,
} from '@ptah-extension/chat-state';
import { CommandCenterStore } from '../model/command-center.store';
import {
  trackMarkedTabVisibility,
  trackTurnStatus,
} from './command-center-turn-status';

describe('Command Center turn status', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the old visible tab registered until its background turn settles', () => {
    const store = new CommandCenterStore();
    store.setSession('a', null, '/a');
    const activeTabs = signal([{ id: 'a', status: 'streaming' }]);
    const pulses = signal(new Map<string, TerminalTurnPulse>());
    const background = { id: 'a', status: 'streaming' };
    const registerVisibleTab = jest.fn();
    const unregisterVisibleTab = jest.fn();
    const tabs = Object.assign(Object.create(null) as TabManagerService, {
      tabs: activeTabs,
      lastTerminalPulseByTab: pulses,
      registerVisibleTab,
      unregisterVisibleTab,
      findTabByIdAcrossWorkspaces: (id: string) =>
        id === 'a' ? { tab: background } : null,
    });
    TestBed.runInInjectionContext(() => trackMarkedTabVisibility(tabs, store));
    TestBed.flushEffects();
    expect(registerVisibleTab).toHaveBeenCalledWith('a');

    store.setSession('b', null, '/b');
    activeTabs.set([{ id: 'b', status: 'loaded' }]);
    TestBed.flushEffects();
    expect(registerVisibleTab).toHaveBeenCalledWith('b');
    expect(unregisterVisibleTab).not.toHaveBeenCalledWith('a');

    background.status = 'loaded';
    pulses.set(new Map());
    TestBed.flushEffects();
    expect(unregisterVisibleTab).toHaveBeenCalledWith('a');
    TestBed.resetTestingModule();
    expect(unregisterVisibleTab).toHaveBeenCalledWith('b');
  });

  it('shows a fresh fast failure even before running status is stored', () => {
    const store = new CommandCenterStore();
    store.setSession('a', null, '/a');
    const root = { id: 'a', status: 'loaded' };
    const activeTabs = signal([root]);
    const pulses = signal(new Map<string, TerminalTurnPulse>());
    const tabs = Object.assign(Object.create(null) as TabManagerService, {
      tabs: activeTabs,
      lastTerminalPulseByTab: pulses,
      findTabByIdAcrossWorkspaces: () => ({ tab: root }),
    });
    TestBed.runInInjectionContext(() =>
      trackTurnStatus(tabs, store, signal(false)),
    );
    TestBed.flushEffects();
    pulses.set(
      new Map([
        [
          'a',
          {
            seq: 1,
            tabId: 'a',
            sessionId: 'session-a',
            workspacePath: '/a',
            revision: 1,
            phase: 'failed',
            terminalReason: 'api_error',
            lastAssistantMessage: null,
            classification: 'error',
            title: 'Root',
            occurredAt: 1,
          },
        ],
      ]),
    );
    TestBed.flushEffects();
    expect(store.sessionStatus()).toBe('error');
    expect(store.toast()?.message).toBe(
      'The Command Center turn could not finish.',
    );
  });
});
