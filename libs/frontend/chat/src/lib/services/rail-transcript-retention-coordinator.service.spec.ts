import { Component, computed, createEnvironmentInjector, EnvironmentInjector, Signal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { RAIL_TRANSCRIPT_RETENTION, SESSION_CONTEXT } from '../tokens/session-context.token';
import { RailTranscriptRetentionCoordinator } from './rail-transcript-retention-coordinator.service';
import { TranscriptRetentionService } from './transcript-retention.service';

@Component({
  standalone: true,
  template: '@for (id of visibleTabIds(); track id) { <span>{{ id }}</span> }',
})
class RetainedTreeHost {
  visibleTabIds: Signal<readonly string[]> = signal([]);
}

describe('RailTranscriptRetentionCoordinator', () => {
  const clearForTab = jest.fn();
  let coordinator: RailTranscriptRetentionCoordinator;
  let coordinatorInjector: EnvironmentInjector;
  let createHost: (id: ReturnType<typeof signal<string | null>>) => TranscriptRetentionService;
  let hostInjectors: EnvironmentInjector[];
  let close: (id: string) => void;
  let removedWorkspace: ReturnType<typeof signal<{ path: string; seq: number } | null>>;
  let missing: Set<string>;

  beforeEach(() => {
    hostInjectors = [];
    const listeners = new Set<(event: { tabId: string; kind: 'close' }) => void>();
    removedWorkspace = signal<{ path: string; seq: number } | null>(null);
    missing = new Set<string>();
    close = (id) => {
      for (const listener of listeners) listener({ tabId: id, kind: 'close' });
    };
    const manager = {
      activeTabId: signal<string | null>(null),
      removedWorkspace$: removedWorkspace.asReadonly(),
      onTabClosed: (listener: (event: { tabId: string; kind: 'close' }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      findTabByIdAcrossWorkspaces: (id: string) =>
        missing.has(id) ? null : { tab: {}, workspacePath: '/ws' },
    };
    TestBed.configureTestingModule({ providers: [
      { provide: TabManagerService, useValue: manager },
      { provide: ExecutionTreeBuilderService, useValue: { clearForTab } },
    ] });
    coordinatorInjector = createEnvironmentInjector(
      [RailTranscriptRetentionCoordinator], TestBed.inject(EnvironmentInjector),
    );
    coordinator = coordinatorInjector.get(RailTranscriptRetentionCoordinator);
    createHost = (id) => {
      const injector = createEnvironmentInjector([
        TranscriptRetentionService,
        { provide: SESSION_CONTEXT, useValue: id.asReadonly() },
        { provide: RAIL_TRANSCRIPT_RETENTION, useValue: true },
      ], coordinatorInjector);
      hostInjectors.push(injector);
      return injector.get(TranscriptRetentionService);
    };
    clearForTab.mockClear();
  });

  afterEach(() => {
    for (const injector of hostInjectors) {
      if (!injector.destroyed) injector.destroy();
    }
    if (!coordinatorInjector.destroyed) coordinatorInjector.destroy();
    TestBed.resetTestingModule();
  });

  it('tab retained in A then shown in B gives exactly one subtree', () => {
    const aId = signal<string | null>('Y');
    const bId = signal<string | null>(null);
    const a = createHost(aId), b = createHost(bId);
    a.touch('X');
    aId.set('Y'); bId.set('X');
    b.touch('X');
    expect(a.retainedTabIds()).not.toContain('X');
    expect(b.retainedTabIds()).toContain('X');
    expect(coordinator.distinctRetainedCount()).toBe(1);
    expect(clearForTab).not.toHaveBeenCalledWith('X');
  });

  it('late-registered pane with the same active tab excludes it at once', () => {
    const a = createHost(signal<string | null>('Y'));
    a.touch('X');
    const fixture = TestBed.createComponent(RetainedTreeHost);
    const visible = computed(() => a.retainedTabIds().filter((id) => !a.liveElsewhere(id)));
    fixture.componentInstance.visibleTabIds = visible;
    fixture.detectChanges();
    expect(visible()).toContain('X');
    expect(fixture.nativeElement.textContent).toContain('X');

    const b = {} as TranscriptRetentionService;
    coordinator.register(b, signal<string | null>('X'));
    expect(visible()).not.toContain('X'); // before B's active-tab effect touches X
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('X');
    expect(visible()).not.toContain('X');

    coordinator.releaseHost(b);
    expect(visible()).toContain('X');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('X');
    fixture.destroy();
  });

  it('count <= 4 counts distinct tab trees', () => {
    const a = createHost(signal<string | null>('A'));
    const b = createHost(signal<string | null>('B'));
    for (const id of ['A', 'C', 'D']) a.touch(id);
    b.touch('B');
    expect(coordinator.distinctRetainedCount()).toBe(4);
    b.touch('C'); // transfer an existing tree; the count must stay at four
    expect(coordinator.distinctRetainedCount()).toBe(4);
    expect(a.retainedTabIds()).not.toContain('C');
    expect(b.retainedTabIds()).toContain('C');
  });

  it('fifth distinct tab evicts the LRU frozen tree, never a pinned visible tab', () => {
    const aId = signal<string | null>('A'), bId = signal<string | null>('B');
    const a = createHost(aId), b = createHost(bId);
    for (const id of ['A', 'C', 'D']) a.touch(id);
    b.touch('B');
    expect(coordinator.distinctRetainedCount()).toBe(4);
    b.touch('E');
    expect(coordinator.distinctRetainedCount()).toBe(4);
    expect(a.retainedTabIds()).toContain('A');
    expect(b.retainedTabIds()).toContain('B');
    expect(a.retainedTabIds()).not.toContain('C');
  });

  it('cache cleared only at last owner, not on transfer', () => {
    const aId = signal<string | null>('A'), bId = signal<string | null>('B');
    const a = createHost(aId), b = createHost(bId);
    a.touch('X'); b.touch('X');
    expect(clearForTab).not.toHaveBeenCalledWith('X');
    b.dispose('X');
    expect(clearForTab).toHaveBeenCalledWith('X');
  });

  it('close release', () => {
    const aId = signal<string | null>('A');
    const a = createHost(aId);
    a.touch('Y'); close('Y');
    expect(clearForTab).toHaveBeenCalledWith('Y');
  });

  it('workspace release', () => {
    const aId = signal<string | null>(null);
    const a = createHost(aId);
    TestBed.tick();
    a.touch('Z'); missing.add('Z');
    removedWorkspace.set({ path: '/ws', seq: 1 });
    TestBed.tick();
    expect(clearForTab).toHaveBeenCalledWith('Z');
  });

  it('host destroy and board destroy release every owner', () => {
    const a = createHost(signal<string | null>(null));
    const b = createHost(signal<string | null>(null));
    a.touch('A'); a.touch('B'); b.touch('C');
    hostInjectors[0].destroy();
    expect(clearForTab).toHaveBeenCalledWith('A');
    expect(clearForTab).toHaveBeenCalledWith('B');
    expect(coordinator.distinctRetainedCount()).toBe(1);
    coordinatorInjector.destroy();
    expect(clearForTab).toHaveBeenCalledWith('C');
    expect(coordinator.distinctRetainedCount()).toBe(0);
  });
});
