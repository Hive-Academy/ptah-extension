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
});
