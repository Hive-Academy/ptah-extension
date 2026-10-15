import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat';
import { EffortStateService, ModelStateService } from '@ptah-extension/core';
import { freezeSessionOverrides } from './canvas-session-overrides';

describe('freezeSessionOverrides', () => {
  it('keeps per-tab model and effort through Open/Back and tab switches', () => {
    const id = signal('a');
    const tabs = signal([
      { id: 'a', overrideModel: undefined as string | undefined, overrideEffort: undefined as string | null | undefined },
      { id: 'b', overrideModel: undefined as string | undefined, overrideEffort: undefined as string | null | undefined },
    ]);
    const model = signal('model-a');
    const effort = signal('high');
    const setOverrideModel = jest.fn((tabId: string, value: string) =>
      tabs.update((items) => items.map((tab) => tab.id === tabId ? { ...tab, overrideModel: value } : tab)),
    );
    const setOverrideEffort = jest.fn((tabId: string, value: string | null) =>
      tabs.update((items) => items.map((tab) => tab.id === tabId ? { ...tab, overrideEffort: value } : tab)),
    );
    TestBed.configureTestingModule({ providers: [
      { provide: TabManagerService, useValue: { tabs, setOverrideModel, setOverrideEffort } },
      { provide: ModelStateService, useValue: { isLoaded: signal(true), currentModel: model } },
      { provide: EffortStateService, useValue: { isLoaded: signal(true), currentEffort: effort } },
    ] });
    TestBed.runInInjectionContext(() => freezeSessionOverrides(id));
    TestBed.flushEffects();
    expect(tabs()[0]).toMatchObject({ overrideModel: 'model-a', overrideEffort: 'high' });

    id.set('b');
    model.set('model-b');
    effort.set('low');
    TestBed.flushEffects();
    expect(tabs()[1]).toMatchObject({ overrideModel: 'model-b', overrideEffort: 'low' });

    id.set('a'); // Back from a lane, then return to the first tab.
    TestBed.flushEffects();
    expect(tabs()[0]).toMatchObject({ overrideModel: 'model-a', overrideEffort: 'high' });
    expect(setOverrideModel).toHaveBeenCalledTimes(2);
    expect(setOverrideEffort).toHaveBeenCalledTimes(2);
  });
});
