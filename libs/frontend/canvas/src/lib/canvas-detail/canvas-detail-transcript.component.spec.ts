import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SESSION_START_GUARD, TabManagerService } from '@ptah-extension/chat';
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
});
