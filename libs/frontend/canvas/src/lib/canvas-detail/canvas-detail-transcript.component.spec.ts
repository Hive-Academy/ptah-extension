import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SESSION_START_GUARD, TabManagerService } from '@ptah-extension/chat';
import { EffortStateService, ModelStateService, SURFACE_ACTIVE } from '@ptah-extension/core';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailTranscriptComponent } from './canvas-detail-transcript.component';

describe('CanvasDetailTranscriptComponent visibility', () => {
  it('registers an absent tab once and releases it on destroy', () => {
    const visibleTabIds = signal<ReadonlySet<string>>(new Set());
    const registerVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(new Set([...visibleTabIds(), id])),
    );
    const unregisterVisibleTab = jest.fn((id: string) => {
      const next = new Set(visibleTabIds());
      next.delete(id);
      visibleTabIds.set(next);
    });
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        {
          provide: CanvasStore,
          useValue: {
            startBlockReason: jest
              .fn()
              .mockReturnValue(
                '9 sessions are running. Wait for one to finish to start another.',
              ),
          },
        },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(CanvasDetailTranscriptComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(visibleTabIds().has('tile-1')).toBe(true);
    expect(registerVisibleTab).toHaveBeenCalledTimes(1);
    expect(unregisterVisibleTab).not.toHaveBeenCalled();
    const guard =
      fixture.componentInstance.childInjector.get(SESSION_START_GUARD);
    expect(guard()).toBe(
      '9 sessions are running. Wait for one to finish to start another.',
    );

    fixture.destroy();
    expect(visibleTabIds().has('tile-1')).toBe(false);
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(1);
    expect(unregisterVisibleTab).toHaveBeenCalledWith('tile-1');
  });

  it('leaves a tile-owned visible tab registered after detail closes', () => {
    const visibleTabIds = signal<ReadonlySet<string>>(new Set(['tile-1']));
    const registerVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(new Set([...visibleTabIds(), id])),
    );
    const unregisterVisibleTab = jest.fn((id: string) => {
      const next = new Set(visibleTabIds());
      next.delete(id);
      visibleTabIds.set(next);
    });
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        {
          provide: CanvasStore,
          useValue: {
            startBlockReason: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(CanvasDetailTranscriptComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    fixture.destroy();
    expect(visibleTabIds().has('tile-1')).toBe(true);
    expect(registerVisibleTab).not.toHaveBeenCalled();
    expect(unregisterVisibleTab).not.toHaveBeenCalled();
  });

  it('registers only while its parent surface is active', () => {
    const active = signal(false);
    const visibleTabIds = signal<ReadonlySet<string>>(new Set());
    const registerVisibleTab = jest.fn((id: string) =>
      visibleTabIds.set(new Set([...visibleTabIds(), id])),
    );
    const unregisterVisibleTab = jest.fn((id: string) => {
      const next = new Set(visibleTabIds());
      next.delete(id);
      visibleTabIds.set(next);
    });
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: SURFACE_ACTIVE, useValue: active },
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: { visibleTabIds, registerVisibleTab, unregisterVisibleTab },
        },
      ],
    });
    TestBed.overrideComponent(CanvasDetailTranscriptComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(registerVisibleTab).not.toHaveBeenCalled();

    active.set(true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(registerVisibleTab).toHaveBeenCalledTimes(1);
    expect(visibleTabIds().has('tile-1')).toBe(true);

    active.set(false);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(1);
    expect(visibleTabIds().has('tile-1')).toBe(false);

    active.set(true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(registerVisibleTab).toHaveBeenCalledTimes(2);
    fixture.destroy();
    expect(unregisterVisibleTab).toHaveBeenCalledTimes(2);
  });

  it('freezes effort and model once after their defaults load', () => {
    const effortLoaded = signal(false);
    const modelLoaded = signal(false);
    const currentEffort = signal('high');
    const currentModel = signal('claude-sonnet');
    const tabs = signal([{ id: 'tile-1', overrideEffort: undefined as string | null | undefined, overrideModel: undefined as string | undefined }]);
    const setOverrideEffort = jest.fn((id: string, value: string | null) =>
      tabs.update((items) => items.map((tab) => tab.id === id ? { ...tab, overrideEffort: value } : tab)),
    );
    const setOverrideModel = jest.fn((id: string, value: string) =>
      tabs.update((items) => items.map((tab) => tab.id === id ? { ...tab, overrideModel: value } : tab)),
    );
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        { provide: EffortStateService, useValue: { isLoaded: effortLoaded, currentEffort } },
        { provide: ModelStateService, useValue: { isLoaded: modelLoaded, currentModel } },
        {
          provide: TabManagerService,
          useValue: {
            tabs,
            visibleTabIds: signal<ReadonlySet<string>>(new Set()),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
            setOverrideEffort,
            setOverrideModel,
          },
        },
      ],
    });
    TestBed.overrideComponent(CanvasDetailTranscriptComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(setOverrideEffort).not.toHaveBeenCalled();
    expect(setOverrideModel).not.toHaveBeenCalled();

    effortLoaded.set(true);
    modelLoaded.set(true);
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(setOverrideEffort).toHaveBeenCalledWith('tile-1', 'high');
    expect(setOverrideModel).toHaveBeenCalledWith('tile-1', 'claude-sonnet');
    currentEffort.set('low');
    currentModel.set('claude-opus');
    fixture.detectChanges();
    TestBed.flushEffects();
    expect(setOverrideEffort).toHaveBeenCalledTimes(1);
    expect(setOverrideModel).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('destroys its child injector exactly once', () => {
    TestBed.configureTestingModule({
      imports: [CanvasDetailTranscriptComponent],
      providers: [
        { provide: CanvasStore, useValue: { startBlockReason: jest.fn() } },
        {
          provide: TabManagerService,
          useValue: {
            visibleTabIds: signal<ReadonlySet<string>>(new Set()),
            registerVisibleTab: jest.fn(),
            unregisterVisibleTab: jest.fn(),
          },
        },
      ],
    });
    TestBed.overrideComponent(CanvasDetailTranscriptComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(CanvasDetailTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tile-1');
    fixture.detectChanges();
    const destroy = jest.spyOn(fixture.componentInstance.childInjector, 'destroy');
    fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
