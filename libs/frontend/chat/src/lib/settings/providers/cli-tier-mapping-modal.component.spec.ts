import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ProvidersSettingsStateService, type ProvidersCliModels, type ProvidersSettingsCommit, type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER, ProviderModelSearchFieldComponent } from '@ptah-extension/ui';
import type { ProviderGetModelTiersResult, ProviderListModelsResult } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { CliTierMappingModalComponent, type CliTierMappingTarget } from './cli-tier-mapping-modal.component';

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };
const GLM: CliTierMappingTarget = { id: 'glm-1', name: 'Glm', providerId: 'ollama-cloud', providerName: 'Ollama Cloud' };
const CATALOGUE: ProviderListModelsResult = {
  models: [
    { id: 'glm-5.3', name: 'GLM 5.3', description: '', contextLength: 1, supportsToolUse: true },
    { id: 'glm-4.7', name: '', description: '', contextLength: 1, supportsToolUse: true },
  ],
  totalCount: 2,
};

class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly cliModels = signal<ProvidersSettingsSection<ProvidersCliModels>>(
    ready({ 'glm-1': { selectedModel: '', tierMappings: { sonnet: 'glm-5.3', haiku: 'glm-old' } } }));
  readonly tiers = signal<ProvidersSettingsSection<ProviderGetModelTiersResult>>({ status: 'unloaded', data: null, error: null });
  readonly reviewContext = jest.fn(() => CONTEXT);
  readonly refreshTiers = jest.fn(async (_params: unknown) => {
    this.tiers.set(ready({ sonnet: 'kimi-k2.5', opus: null, haiku: null }));
  });
  readonly setCliInstanceTiers = jest.fn(async (_id: string, tiers: Record<string, string>, _context: unknown) => {
    this.cliModels.set(ready({ 'glm-1': { selectedModel: '', tierMappings: { ...tiers } } }));
    this.commit.set({ ...idle, status: 'saved' });
    return true;
  });
}

@Component({
  standalone: true,
  imports: [CliTierMappingModalComponent],
  template: `<ptah-cli-tier-mapping-modal [open]="target() !== null" [target]="target()" (closed)="target.set(null); closed = closed + 1" />`,
})
class Host {
  readonly target = signal<CliTierMappingTarget | null>(GLM);
  closed = 0;
}

describe('CliTierMappingModalComponent', () => {
  let fixture: ComponentFixture<Host>;
  let state: StateStub;
  let loader: { listModels: jest.Mock };
  let feedback: SettingsSaveFeedbackService;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) => el().querySelector(`[data-testid="${id}"]`) as T | null;
  const field = (tier: string) => fixture.debugElement.queryAll(By.directive(ProviderModelSearchFieldComponent))
    .find((node) => node.nativeElement.getAttribute('data-testid') === `cli-tier-picker-${tier}`)?.componentInstance as ProviderModelSearchFieldComponent | undefined;
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  });

  beforeEach(async () => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, configurable: true, value: jest.fn() });
    state = new StateStub();
    loader = { listModels: jest.fn(async () => CATALOGUE) };
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: ProvidersSettingsStateService, useValue: state },
        { provide: PROVIDER_MODELS_LOADER, useValue: loader },
        SettingsSaveFeedbackService,
      ],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await flush();
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  it('is the titled tier dialog: one compact searchable field per tier over the instance provider\'s catalogue', () => {
    expect(el().querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(q('cli-tier-mapping-modal')?.textContent).toContain('Glm Tier Model Mapping');
    expect(loader.listModels).toHaveBeenCalledWith('ollama-cloud');
    for (const tier of ['sonnet', 'opus', 'haiku']) {
      expect(field(tier)?.compact()).toBe(true);
      expect(field(tier)?.pinnedOption()?.name).toBe('Enter a model ID…');
    }
    expect(field('sonnet')?.selectedId()).toBe('glm-5.3');
    expect(field('opus')?.selectedId()).toBe('');
    expect(field('opus')?.options().map((option) => option.id)).toEqual(['glm-5.3', 'glm-4.7']);
    // A nameless catalogue entry shows its id; an own id the catalogue lacks stays listed.
    expect(field('opus')?.options()[1].name).toBe('glm-4.7');
    expect(field('haiku')?.options()[0]).toEqual({ id: 'glm-old', name: 'saved, not in the current list', supportsToolUse: null });
  });

  it('shows the saved model id in the closed tier field, also when the catalogue lacks it (Batch 32b)', () => {
    const closedValue = (tier: string) =>
      q(`cli-tier-picker-${tier}`)?.querySelector<HTMLInputElement>('[data-testid="provider-model-picker-search"]')?.value;
    expect(closedValue('sonnet')).toBe('glm-5.3');
    expect(closedValue('haiku')).toBe('glm-old');
    expect(closedValue('opus')).toBe('Inherited: provider default');
  });

  it('names what each tier inherits from the provider-level cliAgent tier (D5)', () => {
    expect(state.refreshTiers).toHaveBeenCalledWith({ providerId: 'ollama-cloud', scope: 'cliAgent' });
    expect(field('sonnet')?.defaultLabel()).toBe('Inherited: kimi-k2.5');
    expect(field('opus')?.defaultLabel()).toBe('Inherited: provider default');
    expect(field('opus')?.placeholder()).toBe('Inherited: provider default');
    expect(q('cli-tier-source-sonnet')?.textContent).toContain('This instance: glm-5.3. Inherited otherwise: kimi-k2.5.');
    expect(q('cli-tier-source-opus')?.textContent?.trim()).toBe('Inherited: provider default.');
    expect(q('cli-tier-inherit-sonnet')).not.toBeNull();
    expect(q('cli-tier-inherit-opus')).toBeNull();
  });

  it('saves a pick with the full object, and Undo writes the previous full object', async () => {
    field('opus')?.modelSelected.emit('glm-4.7');
    await flush();
    expect(state.setCliInstanceTiers).toHaveBeenCalledWith('glm-1', { sonnet: 'glm-5.3', haiku: 'glm-old', opus: 'glm-4.7' }, CONTEXT);
    expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved Glm Opus tier to All Ptah apps.', canUndo: true });
    await feedback.undo();
    expect(state.setCliInstanceTiers).toHaveBeenLastCalledWith('glm-1', { sonnet: 'glm-5.3', haiku: 'glm-old' }, CONTEXT);
  });

  it('"Use inherited" and the inherited row both send the object without that tier; an unchanged pick writes nothing', async () => {
    q<HTMLButtonElement>('cli-tier-inherit-haiku')?.click();
    await flush();
    expect(state.setCliInstanceTiers).toHaveBeenLastCalledWith('glm-1', { sonnet: 'glm-5.3' }, CONTEXT);
    field('sonnet')?.modelSelected.emit('glm-5.3');
    await flush();
    expect(state.setCliInstanceTiers).toHaveBeenCalledTimes(1);
    field('sonnet')?.modelSelected.emit('');
    await flush();
    expect(state.setCliInstanceTiers).toHaveBeenLastCalledWith('glm-1', {}, CONTEXT);
  });

  it('takes an unlisted model ID through "Enter a model ID…"', async () => {
    field('opus')?.modelSelected.emit('__manual__');
    fixture.detectChanges();
    expect(field('opus')).toBeUndefined();
    const input = q<HTMLInputElement>('cli-tier-manual-opus');
    expect(q<HTMLButtonElement>('cli-tier-manual-apply-opus')?.disabled).toBe(true);
    if (!input) throw new Error('no manual field');
    input.value = 'vendor/glm-x';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    q<HTMLButtonElement>('cli-tier-manual-apply-opus')?.click();
    await flush();
    expect(state.setCliInstanceTiers).toHaveBeenCalledWith('glm-1', { sonnet: 'glm-5.3', haiku: 'glm-old', opus: 'vendor/glm-x' }, CONTEXT);
    expect(q('cli-tier-manual-opus')).toBeNull();
    expect(field('opus')?.selectedId()).toBe('vendor/glm-x');
  });

  it('keeps the model-ID field open after a failed save, and never reports "Saved" (D15)', async () => {
    state.setCliInstanceTiers.mockImplementationOnce(async () => {
      state.commit.set({ ...idle, status: 'failed', unsaved: ['ptahCliAgents.glm-1.tierMappings'] });
      return true;
    });
    field('opus')?.modelSelected.emit('__manual__');
    fixture.detectChanges();
    const input = q<HTMLInputElement>('cli-tier-manual-opus');
    if (!input) throw new Error('no manual field');
    input.value = 'vendor/glm-x';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    q<HTMLButtonElement>('cli-tier-manual-apply-opus')?.click();
    await flush();
    expect(feedback.toast()?.tone).toBe('alert');
    expect(feedback.toast()?.message).not.toContain('Saved');
    expect(q('cli-tier-manual-opus')).not.toBeNull();
  });

  it('offers Retry when the catalogue fails, and still accepts a model ID', async () => {
    loader.listModels.mockResolvedValueOnce({ models: [], totalCount: 0, error: 'unreachable' });
    fixture.componentInstance.target.set(null);
    fixture.detectChanges();
    fixture.componentInstance.target.set(GLM);
    fixture.detectChanges();
    await flush();
    expect(q('cli-tier-models-error')?.getAttribute('role')).toBe('alert');
    q<HTMLButtonElement>('cli-tier-models-error')?.querySelector('button')?.click();
    await flush();
    expect(loader.listModels).toHaveBeenCalledTimes(3);
    expect(q('cli-tier-models-error')).toBeNull();
  });

  it('waits for the instance mapping before offering fields, and says when the inherited tiers could not be read', () => {
    state.tiers.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    fixture.detectChanges();
    expect(q('cli-tier-source-opus')?.textContent?.trim()).toBe('Inherited: not loaded.');
    state.cliModels.set(ready({}));
    fixture.detectChanges();
    expect(q('cli-tier-mapping-loading')).not.toBeNull();
    expect(field('sonnet')).toBeUndefined();
  });

  it('closes from Done', () => {
    q<HTMLButtonElement>('cli-tier-mapping-done')?.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('keeps its footer toast only while open, so a closed modal leaves no second Undo in the page', () => {
    expect(el().querySelectorAll('ptah-settings-toast').length).toBe(1);
    fixture.componentInstance.target.set(null);
    fixture.detectChanges();
    expect(el().querySelectorAll('ptah-settings-toast').length).toBe(0);
  });
});
