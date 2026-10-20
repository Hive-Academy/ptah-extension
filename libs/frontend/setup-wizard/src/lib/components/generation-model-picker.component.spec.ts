import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ModelStateService } from '@ptah-extension/core';
import { GenerationModelPickerComponent } from './generation-model-picker.component';

describe('GenerationModelPickerComponent', () => {
  it('uses the tab override and hides an unknown provider', () => {
    const setOverrideModel = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TabManagerService,
          useValue: {
            tabs: signal([{ id: 'tab-1', overrideModel: 'model-b' }]),
            setOverrideModel,
          },
        },
        {
          provide: ModelStateService,
          useValue: {
            availableModels: signal([
              { id: 'model-a', name: 'Model A' },
              { id: 'model-b', name: 'Model B' },
            ]),
            currentModel: signal('model-a'),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(GenerationModelPickerComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('effectiveProvider', 'unknown');
    fixture.detectChanges();
    const select: HTMLSelectElement =
      fixture.nativeElement.querySelector('select');
    expect(select.value).toBe('model-b');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Workspace provider:',
    );
    select.value = 'model-a';
    select.dispatchEvent(new Event('change'));
    expect(setOverrideModel).toHaveBeenCalledWith('tab-1', 'model-a');
  });
});
