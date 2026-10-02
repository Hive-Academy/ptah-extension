import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  LlmProviderStateService,
  ProvidersSettingsStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  VscodeLmConfigComponent,
  COULD_NOT_SAVE_LM_MODEL,
  COULD_NOT_SET_DEFAULT_PROVIDER,
} from './vscode-lm-config.component';

type ProviderItem = ReturnType<LlmProviderStateService['providers']>[number];

describe('VscodeLmConfigComponent', () => {
  let fixture: ComponentFixture<VscodeLmConfigComponent>;
  let component: VscodeLmConfigComponent;
  let feedback: SettingsSaveFeedbackService;
  let element: HTMLElement;

  let providersSignal: ReturnType<typeof signal<ProviderItem[]>>;
  let defaultProviderSignal: ReturnType<typeof signal<string>>;
  let loadingModelsSignal: ReturnType<typeof signal<Set<string>>>;
  let vsCodeModelsSignal: ReturnType<typeof signal<Array<{ id: string; displayName: string }>>>;

  let mockLlmState: {
    providers: typeof providersSignal;
    defaultProvider: typeof defaultProviderSignal;
    loadingModels: typeof loadingModelsSignal;
    vsCodeModels: typeof vsCodeModelsSignal;
    loadProviderStatus: jest.Mock;
    loadVsCodeModels: jest.Mock;
    setDefaultModel: jest.Mock;
    setDefaultProvider: jest.Mock;
  };

  const sampleVscodeProvider: ProviderItem = {
    provider: 'vscode-lm',
    displayName: 'VS Code Language Model',
    isConfigured: true,
    defaultModel: 'gpt-4o',
    capabilities: ['chat', 'code-completion'] as ProviderItem['capabilities'],
  };

  beforeEach(() => {
    providersSignal = signal([sampleVscodeProvider]);
    defaultProviderSignal = signal('claude');
    loadingModelsSignal = signal(new Set<string>());
    vsCodeModelsSignal = signal([
      { id: 'gpt-4o', displayName: 'GPT-4o' },
      { id: 'claude-3-5-sonnet', displayName: 'Claude 3.5 Sonnet' },
    ]);

    mockLlmState = {
      providers: providersSignal,
      defaultProvider: defaultProviderSignal,
      loadingModels: loadingModelsSignal,
      vsCodeModels: vsCodeModelsSignal,
      loadProviderStatus: jest.fn().mockResolvedValue(undefined),
      loadVsCodeModels: jest.fn().mockResolvedValue(undefined),
      // Mirrors LlmProviderStateService: a successful write re-reads the provider status.
      setDefaultModel: jest.fn(async (_provider: string, model: string) => {
        providersSignal.update((list) =>
          list.map((item) => (item.provider === 'vscode-lm' ? { ...item, defaultModel: model } : item)),
        );
        return true;
      }),
      setDefaultProvider: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    feedback?.dismiss();
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  async function settle(): Promise<void> {
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      fixture.detectChanges();
    }
  }

  async function render(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [VscodeLmConfigComponent],
      providers: [
        { provide: LlmProviderStateService, useValue: mockLlmState },
        {
          provide: ProvidersSettingsStateService,
          useValue: { commit: signal({ status: 'idle' }) },
        },
        {
          provide: VSCodeService,
          useValue: { isElectron: false, config: signal({}) },
        },
        SettingsSaveFeedbackService,
      ],
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(VscodeLmConfigComponent);
    component = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture.detectChanges();
    await fixture.whenStable();
    await settle();
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = element.querySelector<T>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`missing [data-testid="${id}"]`);
    return el;
  };

  const queryTestId = (id: string) =>
    element.querySelector(`[data-testid="${id}"]`);

  describe('Card Rendering (A33, A35)', () => {
    it('does not render card when vscode-lm provider is not present', async () => {
      providersSignal.set([]);
      await render();

      expect(element.querySelector('section.card')).toBeNull();
    });

    it('renders provider header, badges, and capabilities with outline style (A33, A35)', async () => {
      await render();

      expect(element.querySelector('section.card')).not.toBeNull();
      expect(element.textContent).toContain('VS Code Language Model');
      expect(element.textContent).toContain('Configured');
      expect(element.textContent).toContain('Chat');
      expect(element.textContent).toContain('Code Completion');
      expect(element.textContent).toContain('No API key required');

      // Outline badges
      const badges = Array.from(element.querySelectorAll('.badge'));
      expect(badges.every((b) => b.classList.contains('badge-outline'))).toBe(true);

      // Default badge absent when defaultProvider is claude
      expect(element.querySelector('[aria-label="Default provider"]')).toBeNull();
      expect(queryTestId('vscode-lm-set-default')).not.toBeNull();
    });

    it('renders Default badge and hides Set as Default button when defaultProvider is vscode-lm', async () => {
      defaultProviderSignal.set('vscode-lm');
      await render();

      expect(element.querySelector('[aria-label="Default provider"]')).not.toBeNull();
      expect(queryTestId('vscode-lm-set-default')).toBeNull();
    });
  });

  describe('Set as Default (A36)', () => {
    it('sets VS Code LM as default provider with toast and Undo', async () => {
      await render();

      const setDefBtn = byTestId<HTMLButtonElement>('vscode-lm-set-default');
      setDefBtn.click();
      await settle();

      expect(mockLlmState.setDefaultProvider).toHaveBeenCalledWith('vscode-lm');
      const toast = feedback.toast();
      expect(toast?.tone).toBe('status');
      expect(toast?.message).toBe('Saved default provider.');
      expect(toast?.canUndo).toBe(true);

      // Trigger Undo
      await feedback.undo();
      await settle();

      expect(mockLlmState.setDefaultProvider).toHaveBeenCalledWith('claude');
    });

    it('surfaces fixed error sentence on setDefaultProvider failure without leaking host text', async () => {
      mockLlmState.setDefaultProvider.mockResolvedValue(false);
      await render();

      const setDefBtn = byTestId<HTMLButtonElement>('vscode-lm-set-default');
      setDefBtn.click();
      await settle();

      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_SET_DEFAULT_PROVIDER);

      // Thrown error
      mockLlmState.setDefaultProvider.mockRejectedValue(
        new Error('host detail exception message'),
      );
      await component.onSetDefault();
      await settle();

      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_SET_DEFAULT_PROVIDER);
      expect(feedback.toast()?.message).not.toContain('host detail');
    });
  });

  describe('Model Selection & D15 Fix (A34, A37)', () => {
    it('shows loading and empty states when applicable', async () => {
      vsCodeModelsSignal.set([]);
      loadingModelsSignal.set(new Set(['vscode-lm']));
      await render();

      expect(element.textContent).toContain('Loading models...');

      loadingModelsSignal.set(new Set());
      fixture.detectChanges();
      expect(element.textContent).toContain('No models available');
    });

    it('selects model, emits modelChanged on success, and supports Undo (A34, A37)', async () => {
      await render();

      const emitted: void[] = [];
      component.modelChanged.subscribe(() => emitted.push(undefined));

      await component.onVsCodeModelSelect('claude-3-5-sonnet');
      await settle();

      expect(mockLlmState.setDefaultModel).toHaveBeenCalledWith(
        'vscode-lm',
        'claude-3-5-sonnet',
      );
      expect(component.currentModelId()).toBe('claude-3-5-sonnet');
      expect(emitted.length).toBe(1);

      const toast = feedback.toast();
      expect(toast?.tone).toBe('status');
      expect(toast?.message).toBe('Saved VS Code language model.');
      expect(toast?.canUndo).toBe(true);

      // Trigger Undo
      await feedback.undo();
      await settle();

      expect(mockLlmState.setDefaultModel).toHaveBeenCalledWith(
        'vscode-lm',
        'gpt-4o',
      );
      expect(component.currentModelId()).toBe('gpt-4o');
      expect(emitted.length).toBe(2);
    });

    it('D15 fix: reverts model selection and does NOT emit modelChanged when write fails', async () => {
      mockLlmState.setDefaultModel.mockResolvedValue(false);
      await render();

      const emitted: void[] = [];
      component.modelChanged.subscribe(() => emitted.push(undefined));

      await component.onVsCodeModelSelect('claude-3-5-sonnet');
      await settle();

      // Selection reverted
      expect(component.currentModelId()).toBe('gpt-4o');
      // No CLI re-detect emitted
      expect(emitted.length).toBe(0);

      // Alert toast with fixed sentence, NEVER "Saved"
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_SAVE_LM_MODEL);

      // Thrown Error test
      mockLlmState.setDefaultModel.mockRejectedValue(
        new Error('host detail exception message'),
      );
      await component.onVsCodeModelSelect('claude-3-5-sonnet');
      await settle();

      expect(component.currentModelId()).toBe('gpt-4o');
      expect(emitted.length).toBe(0);
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).toBe(COULD_NOT_SAVE_LM_MODEL);
      expect(feedback.toast()?.message).not.toContain('host detail');
    });

    it('Minor 10: clears the local selection after the write, so a later change made elsewhere shows', async () => {
      await render();

      await component.onVsCodeModelSelect('claude-3-5-sonnet');
      await settle();
      expect(component.selectedModel()).toBeNull();

      providersSignal.update((list) => list.map((item) => ({ ...item, defaultModel: 'gpt-4o' })));
      fixture.detectChanges();
      expect(component.currentModelId()).toBe('gpt-4o');
    });

    it('Minor 10: puts the select element back on the saved model after a failed write', async () => {
      mockLlmState.setDefaultModel.mockResolvedValue(false);
      await render();

      const select = byTestId<HTMLSelectElement>('vscode-lm-model-select');
      select.value = 'claude-3-5-sonnet';
      select.dispatchEvent(new Event('change'));
      await settle();

      expect(mockLlmState.setDefaultModel).toHaveBeenCalledWith('vscode-lm', 'claude-3-5-sonnet');

      expect(select.value).toBe('gpt-4o');
      expect(component.selectedModel()).toBeNull();
    });

    it('N5: a successful write whose status refresh failed shows the written model, until a refresh replaces it', async () => {
      // The write lands but the service's refresh fails, so the provider list keeps the old default model.
      mockLlmState.setDefaultModel.mockResolvedValue(true);
      await render();

      const select = byTestId<HTMLSelectElement>('vscode-lm-model-select');
      select.value = 'claude-3-5-sonnet';
      select.dispatchEvent(new Event('change'));
      await settle();

      expect(feedback.toast()?.message).toBe('Saved VS Code language model.');
      expect(component.currentModelId()).toBe('claude-3-5-sonnet');
      expect(select.value).toBe('claude-3-5-sonnet');

      // A later successful refresh carries the saved model; a change made elsewhere then shows as well.
      providersSignal.set([{ ...sampleVscodeProvider, defaultModel: 'gpt-4o-mini' }]);
      fixture.detectChanges();
      expect(component.currentModelId()).toBe('gpt-4o-mini');
    });

    it('N5: Undo after a failed refresh shows the restored model, not the one it replaced', async () => {
      mockLlmState.setDefaultModel.mockResolvedValue(true);
      await render();

      await component.onVsCodeModelSelect('claude-3-5-sonnet');
      await settle();
      await feedback.undo();
      await settle();

      expect(mockLlmState.setDefaultModel).toHaveBeenLastCalledWith('vscode-lm', 'gpt-4o');
      expect(component.currentModelId()).toBe('gpt-4o');
    });

    it('Minor 10: with no previous model there is no Undo, so an empty model id is never written', async () => {
      providersSignal.set([{ ...sampleVscodeProvider, defaultModel: undefined }]);
      await render();

      await component.onVsCodeModelSelect('claude-3-5-sonnet');
      await settle();

      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved VS Code language model.', canUndo: false });
      expect(mockLlmState.setDefaultModel).not.toHaveBeenCalledWith('vscode-lm', '');
    });
  });
});
