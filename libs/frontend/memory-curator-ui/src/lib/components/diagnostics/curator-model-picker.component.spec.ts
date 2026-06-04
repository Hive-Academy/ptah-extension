import { TestBed } from '@angular/core/testing';
import type { ProviderListModelsResult } from '@ptah-extension/shared';

import { MemoryDiagnosticsRpcService } from '../../services/memory-diagnostics-rpc.service';

import {
  CuratorModelPickerComponent,
  type CuratorModelChange,
} from './curator-model-picker.component';

describe('CuratorModelPickerComponent', () => {
  let listModelsMock: jest.Mock;

  const modelsResult = (
    models: ProviderListModelsResult['models'],
  ): ProviderListModelsResult => ({
    models,
    totalCount: models.length,
    isStatic: true,
  });

  const haiku = {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    description: '',
    contextLength: 200000,
    supportsToolUse: true,
  };
  const glm = {
    id: 'glm-4.7-flashx',
    name: 'GLM-4.7 FlashX',
    description: '',
    contextLength: 200000,
    supportsToolUse: true,
  };

  beforeEach(async () => {
    listModelsMock = jest.fn(() => Promise.resolve(modelsResult([haiku])));

    await TestBed.configureTestingModule({
      imports: [CuratorModelPickerComponent],
      providers: [
        {
          provide: MemoryDiagnosticsRpcService,
          useValue: { listModels: listModelsMock },
        },
      ],
    }).compileComponents();
  });

  function create(provider = '', model = '') {
    const fixture = TestBed.createComponent(CuratorModelPickerComponent);
    fixture.componentRef.setInput('curatorProvider', provider);
    fixture.componentRef.setInput('curatorModel', model);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the Phase-1 "rides the active provider" copy', () => {
    const fixture = create();
    const note = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="curator-phase1-note"]',
    );
    expect(note?.textContent ?? '').toContain(
      'model rides the active provider (full provider routing coming soon)',
    );
  });

  it('loads models for the hydrated provider on init', () => {
    create('z-ai', '');
    expect(listModelsMock).toHaveBeenCalledWith('z-ai');
  });

  it('hydrates provider from input by loading its models and rendering options', async () => {
    listModelsMock.mockResolvedValue(modelsResult([glm]));
    const fixture = create('z-ai', 'glm-4.7-flashx');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(listModelsMock).toHaveBeenCalledWith('z-ai');

    const root = fixture.nativeElement as HTMLElement;
    const providerSelect = root.querySelector(
      '[data-testid="curator-provider-select"]',
    ) as HTMLSelectElement;
    const providerOptionValues = Array.from(providerSelect.options).map(
      (o) => o.value,
    );
    expect(providerOptionValues).toContain('z-ai');

    const modelSelect = root.querySelector(
      '[data-testid="curator-model-select"]',
    ) as HTMLSelectElement;
    const modelOptionValues = Array.from(modelSelect.options).map(
      (o) => o.value,
    );
    expect(modelOptionValues).toContain('glm-4.7-flashx');
  });

  it('provider change triggers provider:listModels and emits both fields', async () => {
    listModelsMock.mockResolvedValue(modelsResult([glm]));
    const fixture = create();

    const emitted: CuratorModelChange[] = [];
    fixture.componentInstance.curatorChange.subscribe((c) => emitted.push(c));

    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="curator-provider-select"]',
    ) as HTMLSelectElement;
    select.value = 'z-ai';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(listModelsMock).toHaveBeenCalledWith('z-ai');
    expect(emitted).toContainEqual({
      curatorProvider: 'z-ai',
      curatorModel: '',
    });
  });

  it('model selection emits a PATCH with provider and model', async () => {
    const fixture = create('z-ai', '');
    await fixture.whenStable();

    const emitted: CuratorModelChange[] = [];
    fixture.componentInstance.curatorChange.subscribe((c) => emitted.push(c));

    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="curator-model-select"]',
    ) as HTMLSelectElement;
    select.value = 'claude-haiku-4-5-20251001';
    select.dispatchEvent(new Event('change'));

    expect(emitted).toContainEqual({
      curatorProvider: 'z-ai',
      curatorModel: 'claude-haiku-4-5-20251001',
    });
  });

  it('default sentinel options use plain-text labels (no innerHTML)', () => {
    const fixture = create();
    const root = fixture.nativeElement as HTMLElement;
    const providerSelect = root.querySelector(
      '[data-testid="curator-provider-select"]',
    ) as HTMLSelectElement;
    const modelSelect = root.querySelector(
      '[data-testid="curator-model-select"]',
    ) as HTMLSelectElement;
    expect(providerSelect.options[0].textContent).toBe(
      'Active provider (default)',
    );
    expect(modelSelect.options[0].textContent).toBe(
      'Default (claude-haiku-4-5-20251001)',
    );
    expect(providerSelect.innerHTML).not.toContain('<script');
  });

  it('surfaces a model load error from the RPC result', async () => {
    listModelsMock.mockResolvedValue({
      models: [],
      totalCount: 0,
      isStatic: false,
      error: 'auth failed',
    });
    const fixture = create('z-ai', '');
    await fixture.whenStable();
    fixture.detectChanges();

    const err = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="curator-model-error"]',
    );
    expect(err?.textContent ?? '').toContain('auth failed');
  });
});
