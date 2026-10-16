import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { CommandCenterStore } from '../model/command-center.store';
import { CommandCenterSessionCoordinator } from '../model/session-coordinator';
import { trackWorkspaceBinding } from './command-center-workspace-binding';

describe('trackWorkspaceBinding', () => {
  it('shares the initial open and rebinds when the workspace changes', async () => {
    const active = signal<string | null>('/first');
    const openOrResume = jest.fn(async () => {
      store.setSession(
        active() === '/first' ? 'first-tab' : 'second-tab',
        null,
        active(),
      );
      return store.markedTabId();
    });
    TestBed.configureTestingModule({
      providers: [
        CommandCenterStore,
        {
          provide: TabManagerService,
          useValue: {
            activeWorkspacePath$: active,
            get activeWorkspacePath() {
              return active();
            },
          },
        },
        {
          provide: CommandCenterSessionCoordinator,
          useValue: { openOrResume },
        },
      ],
    });
    const store = TestBed.inject(CommandCenterStore);
    const binding = TestBed.runInInjectionContext(() =>
      trackWorkspaceBinding(
        TestBed.inject(TabManagerService),
        store,
        TestBed.inject(CommandCenterSessionCoordinator),
      ),
    );
    const first = binding.open();
    const duplicate = binding.open();
    expect(first).toBe(duplicate);
    await first;
    TestBed.tick();
    expect(openOrResume).toHaveBeenCalledTimes(1);
    active.set('/second');
    TestBed.tick();
    await Promise.resolve();
    expect(store.workspace()).toBe('/second');
    expect(openOrResume).toHaveBeenCalledTimes(2);
    active.set(null);
    TestBed.tick();
    expect(store.markedTabId()).toBeNull();
    expect(store.toast()?.message).toBe(
      'Open a workspace to use Command Center.',
    );
  });

  it('reports an effect open rejection and opens after a later workspace change', async () => {
    const active = signal<string | null>('/first');
    const openOrResume = jest
      .fn()
      .mockRejectedValueOnce(new Error('private path'))
      .mockImplementation(async () => {
        store.setSession('later-tab', null, active());
        return 'later-tab';
      });
    TestBed.configureTestingModule({
      providers: [
        CommandCenterStore,
        {
          provide: TabManagerService,
          useValue: {
            activeWorkspacePath$: active,
            get activeWorkspacePath() {
              return active();
            },
          },
        },
        {
          provide: CommandCenterSessionCoordinator,
          useValue: { openOrResume },
        },
      ],
    });
    const store = TestBed.inject(CommandCenterStore);
    const binding = TestBed.runInInjectionContext(() =>
      trackWorkspaceBinding(
        TestBed.inject(TabManagerService),
        store,
        TestBed.inject(CommandCenterSessionCoordinator),
      ),
    );
    active.set('/second');
    TestBed.tick();
    await expect(binding.open()).rejects.toThrow('private path');
    await Promise.resolve();
    expect(store.sessionStatus()).toBe('error');
    expect(store.toast()).toEqual({
      message: 'Could not open the Command Center session.',
      tone: 'error',
    });

    active.set('/third');
    TestBed.tick();
    await binding.open();
    expect(openOrResume).toHaveBeenCalledTimes(2);
    expect(store.workspace()).toBe('/third');
  });

  it('reports an open rejection started by canSend', async () => {
    const active = signal<string | null>('/first');
    const openOrResume = jest.fn().mockRejectedValue(new Error('private path'));
    TestBed.configureTestingModule({
      providers: [
        CommandCenterStore,
        {
          provide: TabManagerService,
          useValue: {
            activeWorkspacePath$: active,
            get activeWorkspacePath() {
              return active();
            },
          },
        },
        {
          provide: CommandCenterSessionCoordinator,
          useValue: { openOrResume },
        },
      ],
    });
    const store = TestBed.inject(CommandCenterStore);
    const binding = TestBed.runInInjectionContext(() =>
      trackWorkspaceBinding(
        TestBed.inject(TabManagerService),
        store,
        TestBed.inject(CommandCenterSessionCoordinator),
      ),
    );
    expect(binding.canSend()).toBe(false);
    await expect(binding.open()).rejects.toThrow('private path');
    expect(store.sessionStatus()).toBe('error');
    expect(store.toast()).toEqual({
      message: 'Could not open the Command Center session.',
      tone: 'error',
    });
  });
});
