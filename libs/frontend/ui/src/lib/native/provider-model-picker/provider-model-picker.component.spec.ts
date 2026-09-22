import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ProviderListModelsResult,
  ProviderModelInfo,
} from '@ptah-extension/shared';
import {
  ANTHROPIC_PROVIDERS,
  clearCustomProviderEntries,
  getAllAnthropicProviders,
  setCustomProviderEntries,
} from '@ptah-extension/shared';

import {
  ProviderModelPickerComponent,
  type ProviderModelSelection,
} from './provider-model-picker.component';
import { PROVIDER_MODELS_LOADER } from './provider-models-loader.port';

describe('ProviderModelPickerComponent', () => {
  let listModels: jest.Mock<Promise<ProviderListModelsResult>, [string?]>;

  const model = (over: Partial<ProviderModelInfo> = {}): ProviderModelInfo => ({
    id: 'model-a',
    name: 'Model A',
    description: '',
    contextLength: 200_000,
    supportsToolUse: true,
    ...over,
  });

  const result = (models: ProviderModelInfo[]): ProviderListModelsResult => ({
    models,
    totalCount: models.length,
    isStatic: true,
  });

  beforeEach(async () => {
    listModels = jest.fn(() => Promise.resolve(result([model()])));

    await TestBed.configureTestingModule({
      imports: [ProviderModelPickerComponent],
      providers: [
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels } },
      ],
    }).compileComponents();
  });

  async function create(inputs: Partial<Record<string, unknown>> = {}) {
    const fixture = TestBed.createComponent(ProviderModelPickerComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function el(fixture: { nativeElement: unknown }, testId: string) {
    return (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${testId}"]`,
    );
  }

  function select(fixture: { nativeElement: unknown }, testId: string) {
    return el(fixture, testId) as HTMLSelectElement;
  }

  // ---------------------------------------------------------------------
  // P1-9 part (a) — the injector surface IS the cross-host guarantee.
  // ---------------------------------------------------------------------
  describe('injector surface (P1-9 a)', () => {
    it('mounts with PROVIDER_MODELS_LOADER as the only provider', async () => {
      // No VSCodeService, no isElectron gate, no host detection of any kind.
      // A required `inject()` of anything else would throw NullInjectorError.
      const fixture = await create();
      expect(el(fixture, 'provider-model-picker-provider')).not.toBeNull();
      expect(el(fixture, 'provider-model-picker-model')).not.toBeNull();
    });

    it('declares exactly one inject() call, for PROVIDER_MODELS_LOADER', () => {
      // Read at the source rather than through a recording injector: at
      // runtime the framework itself resolves a dozen internal tokens
      // (RendererFactory2, ChangeDetectionScheduler, …) through the same
      // injector, which drowns the signal. More importantly, a recording
      // injector cannot see an `inject(X, { optional: true })` that returns
      // null — and an optional host-detection dependency is exactly the
      // regression this assertion exists to stop.
      const source = readFileSync(
        join(__dirname, 'provider-model-picker.component.ts'),
        'utf8',
      );
      const injected = Array.from(
        source.matchAll(/\binject\(\s*([A-Za-z0-9_$.]+)/g),
        (m) => m[1],
      );

      expect(injected).toEqual(['PROVIDER_MODELS_LOADER']);
    });

    it('names no host-detection concept anywhere in its source', () => {
      const source = readFileSync(
        join(__dirname, 'provider-model-picker.component.ts'),
        'utf8',
      );
      for (const banned of [
        'isElectron',
        'VSCodeService',
        'acquireVsCodeApi',
      ]) {
        expect(source).not.toContain(banned);
      }
    });
  });

  // ---------------------------------------------------------------------
  // Provider enumeration — registry-driven, zero provider-id literals.
  // ---------------------------------------------------------------------
  describe('provider list', () => {
    it('renders the inherit sentinel plus every registry provider', async () => {
      const fixture = await create();
      const values = Array.from(
        select(fixture, 'provider-model-picker-provider').options,
      ).map((o) => o.value);

      expect(values[0]).toBe('');
      expect(values.slice(1)).toEqual(ANTHROPIC_PROVIDERS.map((p) => p.id));
    });

    it('labels the sentinel as the active provider, in plain text', async () => {
      const fixture = await create();
      const providerSelect = select(fixture, 'provider-model-picker-provider');
      expect(providerSelect.options[0].textContent?.trim()).toBe(
        'Active provider (default)',
      );
      expect(providerSelect.innerHTML).not.toContain('<script');
    });
  });

  // ---------------------------------------------------------------------
  // Rendered selection — a pinned lane must LOOK pinned.
  //
  // The original template bound `[value]` on each `<select>` and nothing on
  // the `<option>`s. `[value]` is applied in the same update pass that
  // materialises the `@for` options, and a browser silently drops a `<select>`
  // value matching no existing option — so a pre-pinned provider rendered as
  // `selectedIndex === 0` ("Active provider (default)") while the loader was
  // correctly called with the pinned id. The model select was worse: its
  // options arrive from an async load, so the mismatch was guaranteed.
  //
  // Every assertion here reads the DOM. Asserting the loader call is what let
  // the defect through the first time.
  // ---------------------------------------------------------------------
  describe('rendered selection', () => {
    /** Index of a registry id in the rendered list, past the sentinel at 0. */
    function expectedIndexOf(providerId: string): number {
      return ANTHROPIC_PROVIDERS.findIndex((p) => p.id === providerId) + 1;
    }

    it('shows a pre-set provider as the selected option', async () => {
      const [first] = ANTHROPIC_PROVIDERS;
      const fixture = await create({ provider: first.id });

      const providerSelect = select(fixture, 'provider-model-picker-provider');
      expect(providerSelect.value).toBe(first.id);
      expect(providerSelect.selectedIndex).toBe(expectedIndexOf(first.id));
      expect(providerSelect.options[providerSelect.selectedIndex].value).toBe(
        first.id,
      );
    });

    it('shows a pre-set provider from the END of the registry too', async () => {
      // Guards against a fix that happens to work only for the option the
      // browser would have landed on anyway.
      const last = ANTHROPIC_PROVIDERS[ANTHROPIC_PROVIDERS.length - 1];
      const fixture = await create({ provider: last.id });

      const providerSelect = select(fixture, 'provider-model-picker-provider');
      expect(providerSelect.value).toBe(last.id);
      expect(providerSelect.selectedIndex).toBe(expectedIndexOf(last.id));
      expect(ANTHROPIC_PROVIDERS.length).toBeGreaterThan(1);
    });

    it('keeps the inherit sentinel selected when no provider is pinned', async () => {
      const fixture = await create();

      const providerSelect = select(fixture, 'provider-model-picker-provider');
      expect(providerSelect.value).toBe('');
      expect(providerSelect.selectedIndex).toBe(0);
      expect(providerSelect.options[0].textContent?.trim()).toBe(
        'Active provider (default)',
      );
    });

    it('keeps the inherit sentinel selected for an explicit empty provider', async () => {
      const fixture = await create({ provider: '', model: '' });

      expect(select(fixture, 'provider-model-picker-provider').value).toBe('');
      expect(
        select(fixture, 'provider-model-picker-provider').selectedIndex,
      ).toBe(0);
    });

    it('shows a pre-set model as selected once the async catalogue lands', async () => {
      listModels.mockResolvedValue(
        result([
          model({ id: 'm-1', name: 'Model One' }),
          model({ id: 'm-2', name: 'Model Two' }),
        ]),
      );
      const fixture = await create({
        provider: ANTHROPIC_PROVIDERS[0].id,
        model: 'm-2',
      });

      const modelSelect = select(fixture, 'provider-model-picker-model');
      expect(modelSelect.value).toBe('m-2');
      expect(modelSelect.selectedIndex).toBe(2);
      expect(modelSelect.options[modelSelect.selectedIndex].value).toBe('m-2');
    });

    it('keeps the default-tier sentinel selected when no model is pinned', async () => {
      listModels.mockResolvedValue(
        result([model({ id: 'm-1', name: 'Model One' })]),
      );
      const fixture = await create({ provider: ANTHROPIC_PROVIDERS[0].id });

      const modelSelect = select(fixture, 'provider-model-picker-model');
      expect(modelSelect.value).toBe('');
      expect(modelSelect.selectedIndex).toBe(0);
    });

    it('re-reflects a provider the host writes back after first render', async () => {
      const fixture = await create();
      expect(select(fixture, 'provider-model-picker-provider').value).toBe('');

      const [first] = ANTHROPIC_PROVIDERS;
      fixture.componentRef.setInput('provider', first.id);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(select(fixture, 'provider-model-picker-provider').value).toBe(
        first.id,
      );
    });

    it('reflects a user provider choice without a host write-back', async () => {
      const [, second] = ANTHROPIC_PROVIDERS;
      const fixture = await create();

      const providerSelect = select(fixture, 'provider-model-picker-provider');
      providerSelect.value = second.id;
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      // The inputs are still `''` — a re-render must not stomp the DOM back
      // to the sentinel while the component would emit `second.id`.
      expect(providerSelect.value).toBe(second.id);
      expect(providerSelect.selectedIndex).toBe(expectedIndexOf(second.id));
    });

    it('drops the model select back to the sentinel when the provider changes', async () => {
      listModels
        .mockResolvedValueOnce(result([model({ id: 'old-1', name: 'Old' })]))
        .mockResolvedValue(result([model({ id: 'new-1', name: 'New' })]));

      const fixture = await create({ model: 'old-1' });
      const modelSelect = select(fixture, 'provider-model-picker-model');
      expect(modelSelect.value).toBe('old-1');

      const providerSelect = select(fixture, 'provider-model-picker-provider');
      providerSelect.value = ANTHROPIC_PROVIDERS[0].id;
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      // The component emits `model: ''` here; the control must say so too.
      expect(select(fixture, 'provider-model-picker-model').value).toBe('');
      expect(select(fixture, 'provider-model-picker-model').selectedIndex).toBe(
        0,
      );
    });
  });

  // ---------------------------------------------------------------------
  // Loading behaviour.
  // ---------------------------------------------------------------------
  describe('model loading', () => {
    it('passes undefined — not the empty sentinel — when no provider is pinned', async () => {
      await create();
      expect(listModels).toHaveBeenCalledWith(undefined);
    });

    it('loads models for a hydrated provider and renders them', async () => {
      const [first] = ANTHROPIC_PROVIDERS;
      listModels.mockResolvedValue(
        result([model({ id: 'm-1', name: 'Model One' })]),
      );

      const fixture = await create({ provider: first.id, model: 'm-1' });

      expect(listModels).toHaveBeenCalledWith(first.id);
      const values = Array.from(
        select(fixture, 'provider-model-picker-model').options,
      ).map((o) => o.value);
      expect(values).toEqual(['', 'm-1']);
    });

    it('surfaces an error carried on the result', async () => {
      listModels.mockResolvedValue({
        models: [],
        totalCount: 0,
        isStatic: false,
        error: 'auth failed',
      });
      const fixture = await create({ provider: ANTHROPIC_PROVIDERS[0].id });
      expect(el(fixture, 'provider-model-picker-error')?.textContent).toContain(
        'auth failed',
      );
    });

    it('surfaces a rejected load without letting it escape', async () => {
      listModels.mockRejectedValue(new Error('transport down'));
      const fixture = await create({ provider: ANTHROPIC_PROVIDERS[0].id });
      expect(el(fixture, 'provider-model-picker-error')?.textContent).toContain(
        'transport down',
      );
    });

    it('falls back to a generic message when the rejection is not an Error', async () => {
      listModels.mockRejectedValue('nope');
      const fixture = await create({ provider: ANTHROPIC_PROVIDERS[0].id });
      expect(el(fixture, 'provider-model-picker-error')?.textContent).toContain(
        'Failed to load models',
      );
    });

    it('ignores a stale in-flight load when the provider changed underneath it', async () => {
      const [a, b] = ANTHROPIC_PROVIDERS;
      let releaseSlow: (r: ProviderListModelsResult) => void = () => undefined;

      listModels
        .mockImplementationOnce(() => Promise.resolve(result([])))
        .mockImplementationOnce(
          () =>
            new Promise<ProviderListModelsResult>((resolve) => {
              releaseSlow = resolve;
            }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve(result([model({ id: 'fresh', name: 'Fresh' })])),
        );

      const fixture = await create();
      const providerSelect = select(fixture, 'provider-model-picker-provider');

      providerSelect.value = a.id;
      providerSelect.dispatchEvent(new Event('change'));
      providerSelect.value = b.id;
      providerSelect.dispatchEvent(new Event('change'));

      releaseSlow(result([model({ id: 'stale', name: 'Stale' })]));
      await fixture.whenStable();
      fixture.detectChanges();

      const values = Array.from(
        select(fixture, 'provider-model-picker-model').options,
      ).map((o) => o.value);
      expect(values).toEqual(['', 'fresh']);
      expect(values).not.toContain('stale');
    });
  });

  // ---------------------------------------------------------------------
  // Emission.
  // ---------------------------------------------------------------------
  describe('selectionChange', () => {
    it('clears the model when the provider changes and emits both fields', async () => {
      const [first] = ANTHROPIC_PROVIDERS;
      const fixture = await create();
      const emitted: ProviderModelSelection[] = [];
      fixture.componentInstance.selectionChange.subscribe((s) =>
        emitted.push(s),
      );

      const providerSelect = select(fixture, 'provider-model-picker-provider');
      providerSelect.value = first.id;
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();

      expect(listModels).toHaveBeenCalledWith(first.id);
      expect(emitted).toEqual([{ provider: first.id, model: '' }]);
    });

    it('emits the pinned model alongside the current provider', async () => {
      const [first] = ANTHROPIC_PROVIDERS;
      const fixture = await create({ provider: first.id });
      const emitted: ProviderModelSelection[] = [];
      fixture.componentInstance.selectionChange.subscribe((s) =>
        emitted.push(s),
      );

      const modelSelect = select(fixture, 'provider-model-picker-model');
      modelSelect.value = 'model-a';
      modelSelect.dispatchEvent(new Event('change'));

      expect(emitted).toEqual([{ provider: first.id, model: 'model-a' }]);
    });
  });

  // ---------------------------------------------------------------------
  // Default-model label — TASK_2026_159 regression, generalized over tiers.
  // ---------------------------------------------------------------------
  describe('default-model label', () => {
    function labelOf(fixture: { nativeElement: unknown }): string {
      return (
        select(
          fixture,
          'provider-model-picker-model',
        ).options[0].textContent?.trim() ?? ''
      );
    }

    it('names a tier, never a model, when no provider is pinned', async () => {
      const fixture = await create();
      expect(labelOf(fixture)).toBe("Default (active provider's haiku tier)");
    });

    it('honours a non-default tier input', async () => {
      const fixture = await create({ defaultTier: 'sonnet' });
      expect(labelOf(fixture)).toBe("Default (active provider's sonnet tier)");
    });

    it("names the chosen provider's own tier model when the registry declares one", async () => {
      const entry = ANTHROPIC_PROVIDERS.find((p) => p.defaultTiers?.haiku);
      expect(entry).toBeDefined();
      const fixture = await create({ provider: entry?.id });
      expect(labelOf(fixture)).toBe(
        `Default (${entry?.defaultTiers?.haiku ?? ''})`,
      );
    });

    it('falls back to a named tier for a provider with no declared mapping', async () => {
      const entry = ANTHROPIC_PROVIDERS.find((p) => !p.defaultTiers);
      expect(entry).toBeDefined();
      const fixture = await create({ provider: entry?.id });
      expect(labelOf(fixture)).toBe(`Default (${entry?.name} haiku tier)`);
    });

    it('re-labels live when the user switches provider', async () => {
      const withTiers = ANTHROPIC_PROVIDERS.find((p) => p.defaultTiers?.haiku);
      const fixture = await create();
      expect(labelOf(fixture)).toBe("Default (active provider's haiku tier)");

      const providerSelect = select(fixture, 'provider-model-picker-provider');
      providerSelect.value = withTiers?.id ?? '';
      providerSelect.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(labelOf(fixture)).toBe(
        `Default (${withTiers?.defaultTiers?.haiku ?? ''})`,
      );
    });
  });

  // ---------------------------------------------------------------------
  // R6 mitigation layer 1 — capability surfacing, zero provider branching.
  // ---------------------------------------------------------------------
  describe('capability surfacing (R6)', () => {
    it('warns when a tool-use-required consumer pins a tool-incapable model', async () => {
      listModels.mockResolvedValue(
        result([
          model({ id: 'no-tools', name: 'No Tools', supportsToolUse: false }),
        ]),
      );
      const fixture = await create({
        provider: ANTHROPIC_PROVIDERS[0].id,
        model: 'no-tools',
        requiresToolUse: true,
      });

      expect(
        el(fixture, 'provider-model-picker-tooluse-warning')?.textContent,
      ).toContain('does not report tool-use support');
    });

    it('stays silent when the consumer does not require tool use', async () => {
      listModels.mockResolvedValue(
        result([
          model({ id: 'no-tools', name: 'No Tools', supportsToolUse: false }),
        ]),
      );
      const fixture = await create({
        provider: ANTHROPIC_PROVIDERS[0].id,
        model: 'no-tools',
        requiresToolUse: false,
      });

      expect(el(fixture, 'provider-model-picker-tooluse-warning')).toBeNull();
    });

    it('stays silent when the catalogue does not know the pinned model', async () => {
      listModels.mockResolvedValue(result([]));
      const fixture = await create({
        provider: ANTHROPIC_PROVIDERS[0].id,
        model: 'unknown-to-catalogue',
        requiresToolUse: true,
      });

      expect(el(fixture, 'provider-model-picker-tooluse-warning')).toBeNull();
    });

    it('suggests a max input size derived from the context window', async () => {
      listModels.mockResolvedValue(
        result([model({ id: 'm-ctx', contextLength: 128_000 })]),
      );
      const fixture = await create({
        provider: ANTHROPIC_PROVIDERS[0].id,
        model: 'm-ctx',
      });

      const hint =
        el(fixture, 'provider-model-picker-context-hint')?.textContent ?? '';
      expect(hint).toContain('128,000 tokens');
      expect(hint).toContain('~256,000 characters');
    });

    it('renders no context hint when the model declares no window', async () => {
      listModels.mockResolvedValue(
        result([model({ id: 'm-ctx', contextLength: 0 })]),
      );
      const fixture = await create({
        provider: ANTHROPIC_PROVIDERS[0].id,
        model: 'm-ctx',
      });
      expect(el(fixture, 'provider-model-picker-context-hint')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Labelling / a11y.
  // ---------------------------------------------------------------------
  describe('labelling', () => {
    it('renders the label and derives both aria-labels from it', async () => {
      const fixture = await create({ label: 'Archaeologist lane' });

      expect(el(fixture, 'provider-model-picker-label')?.textContent).toContain(
        'Archaeologist lane',
      );
      expect(
        select(fixture, 'provider-model-picker-provider').getAttribute(
          'aria-label',
        ),
      ).toBe('Archaeologist lane provider');
      expect(
        select(fixture, 'provider-model-picker-model').getAttribute(
          'aria-label',
        ),
      ).toBe('Archaeologist lane model');
    });

    it('disables the model select while the catalogue is loading', async () => {
      let release: (r: ProviderListModelsResult) => void = () => undefined;
      listModels.mockReturnValue(
        new Promise<ProviderListModelsResult>((resolve) => {
          release = resolve;
        }),
      );

      const fixture = TestBed.createComponent(ProviderModelPickerComponent);
      fixture.detectChanges();
      expect(select(fixture, 'provider-model-picker-model').disabled).toBe(
        true,
      );

      release(result([]));
      await fixture.whenStable();
      fixture.detectChanges();
      expect(select(fixture, 'provider-model-picker-model').disabled).toBe(
        false,
      );
    });
  });

  // ---------------------------------------------------------------------
  // User-defined providers.
  //
  // This block exists because the failure it guards is INVISIBLE: the picker
  // renders fine either way, and every other test here passes against the
  // static array. Iterating `ANTHROPIC_PROVIDERS` instead of
  // `getAllAnthropicProviders()` just means a user's own provider is missing
  // from this one surface while working everywhere else — the exact drift the
  // registry's own docblock warns about.
  // ---------------------------------------------------------------------
  describe('user-defined providers', () => {
    const CUSTOM_ID = 'spec-only-gateway';

    afterEach(() => {
      clearCustomProviderEntries();
    });

    it('offers a user-defined provider after the built-ins', async () => {
      setCustomProviderEntries([
        {
          id: CUSTOM_ID,
          name: 'Spec Only Gateway',
          baseUrl: 'https://gateway.invalid/v1',
          lane: 'anthropic',
          authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
          keyPrefix: '',
          helpUrl: '',
        },
      ]);
      // Guard the guard: if the entry were rejected, the assertion below would
      // pass against a picker that simply never had it to show.
      expect(getAllAnthropicProviders().map((p) => p.id)).toContain(CUSTOM_ID);

      const fixture = await create();
      const values = Array.from(
        select(fixture, 'provider-model-picker-provider').options,
      ).map((o) => o.value);

      expect(values).toContain(CUSTOM_ID);
      expect(values.slice(1)).toEqual([
        ...ANTHROPIC_PROVIDERS.map((p) => p.id),
        CUSTOM_ID,
      ]);
    });

    it('is unaffected once the user-defined entries are cleared', async () => {
      const fixture = await create();
      const values = Array.from(
        select(fixture, 'provider-model-picker-provider').options,
      ).map((o) => o.value);

      expect(values.slice(1)).toEqual(ANTHROPIC_PROVIDERS.map((p) => p.id));
    });
  });

  // ---------------------------------------------------------------------
  // Batch C extensions — fixed-provider mode, external identities, disabled
  // state, catalog retry, arbitrary model entry, content slot. Everything
  // below must stay reachable through inputs and public methods only: the
  // injector-surface test above pins the single inject() call.
  // ---------------------------------------------------------------------
  describe('fixed-provider mode', () => {
    const [first] = ANTHROPIC_PROVIDERS;

    it('replaces the provider select with the fixed provider name', async () => {
      const fixture = await create({ fixedProvider: first.id });

      expect(el(fixture, 'provider-model-picker-provider')).toBeNull();
      expect(
        el(fixture, 'provider-model-picker-fixed-provider')?.textContent,
      ).toContain(first.name);
    });

    it('falls back to the raw id when the registry does not know the fixed provider', async () => {
      const fixture = await create({ fixedProvider: 'spec-fixed-unknown' });

      expect(
        el(
          fixture,
          'provider-model-picker-fixed-provider',
        )?.textContent?.trim(),
      ).toBe('spec-fixed-unknown');
    });

    it('points the catalogue load at the fixed provider', async () => {
      await create({ fixedProvider: first.id });
      expect(listModels).toHaveBeenCalledWith(first.id);
    });

    it('emits the fixed provider with the chosen model', async () => {
      listModels.mockResolvedValue(result([model({ id: 'm-1', name: 'One' })]));
      const fixture = await create({ fixedProvider: first.id });
      const emitted: ProviderModelSelection[] = [];
      fixture.componentInstance.selectionChange.subscribe((s) =>
        emitted.push(s),
      );

      const modelSelect = select(fixture, 'provider-model-picker-model');
      modelSelect.value = 'm-1';
      modelSelect.dispatchEvent(new Event('change'));

      expect(emitted).toEqual([{ provider: first.id, model: 'm-1' }]);
    });
  });

  describe('externally supplied identities', () => {
    const [first] = ANTHROPIC_PROVIDERS;

    it('appends supplied identities after the registry options', async () => {
      const fixture = await create({
        extraProviders: [
          { id: 'cli-opencode', name: 'OpenCode CLI' },
          { id: first.id, name: 'Duplicate of a registry entry' },
        ],
      });
      const values = Array.from(
        select(fixture, 'provider-model-picker-provider').options,
      ).map((o) => o.value);

      // Registry wins on id collisions; extras dedupe among themselves.
      expect(values.slice(1)).toEqual([
        ...ANTHROPIC_PROVIDERS.map((p) => p.id),
        'cli-opencode',
      ]);
    });

    it('re-reads the registry when refreshProviders is called', async () => {
      const fixture = await create();
      expect(getAllAnthropicProviders().map((p) => p.id)).not.toContain(
        'spec-refresh-gateway',
      );

      setCustomProviderEntries([
        {
          id: 'spec-refresh-gateway',
          name: 'Spec Refresh Gateway',
          baseUrl: 'https://gateway.invalid/v1',
          lane: 'anthropic',
          authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
          keyPrefix: '',
          helpUrl: '',
        },
      ]);
      // Without refreshProviders the merged registry is not signal-tracked —
      // the rendered list must not change until the host asks for it.
      fixture.detectChanges();
      expect(
        Array.from(
          select(fixture, 'provider-model-picker-provider').options,
        ).map((o) => o.value),
      ).not.toContain('spec-refresh-gateway');

      fixture.componentInstance.refreshProviders();
      fixture.detectChanges();

      expect(
        Array.from(
          select(fixture, 'provider-model-picker-provider').options,
        ).map((o) => o.value),
      ).toContain('spec-refresh-gateway');
    });
  });

  describe('disabled state', () => {
    it('disables both selects and hides the manual-entry disclosure', async () => {
      const fixture = await create({ disabled: true });

      expect(select(fixture, 'provider-model-picker-provider').disabled).toBe(
        true,
      );
      expect(select(fixture, 'provider-model-picker-model').disabled).toBe(
        true,
      );
      expect(el(fixture, 'provider-model-picker-manual-entry')).toBeNull();
    });

    it('keeps both selects enabled by default', async () => {
      const fixture = await create();

      expect(select(fixture, 'provider-model-picker-provider').disabled).toBe(
        false,
      );
      expect(select(fixture, 'provider-model-picker-model').disabled).toBe(
        false,
      );
    });
  });

  describe('catalog retry', () => {
    it('offers a Retry action in the error row that re-runs the load', async () => {
      listModels
        .mockRejectedValueOnce(new Error('transport down'))
        .mockResolvedValueOnce(result([model({ id: 'm-1', name: 'One' })]));

      const fixture = await create({ provider: ANTHROPIC_PROVIDERS[0].id });
      expect(el(fixture, 'provider-model-picker-error')).not.toBeNull();
      const callsAfterFirstLoad = listModels.mock.calls.length;

      const retry = fixture.nativeElement.querySelector(
        '[data-testid="provider-model-picker-retry"]',
      ) as HTMLButtonElement;
      expect(retry).not.toBeNull();
      retry.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(listModels.mock.calls.length).toBeGreaterThan(callsAfterFirstLoad);
      expect(el(fixture, 'provider-model-picker-error')).toBeNull();
      expect(
        Array.from(select(fixture, 'provider-model-picker-model').options).map(
          (o) => o.value,
        ),
      ).toEqual(['', 'm-1']);
    });

    it('disables retry while loading is blocked by the disabled state', async () => {
      listModels.mockRejectedValue(new Error('transport down'));
      const fixture = await create({
        provider: ANTHROPIC_PROVIDERS[0].id,
        disabled: true,
      });
      expect(el(fixture, 'provider-model-picker-error')).not.toBeNull();
      // The whole control is inert in disabled mode: the Retry action is
      // rendered but disabled, like the selects.
      const retryDisabled = fixture.nativeElement.querySelector(
        '[data-testid="provider-model-picker-retry"]',
      ) as HTMLButtonElement;
      expect(retryDisabled.disabled).toBe(true);
      expect(select(fixture, 'provider-model-picker-model').disabled).toBe(
        true,
      );
    });
  });

  describe('arbitrary model entry', () => {
    const [first] = ANTHROPIC_PROVIDERS;

    it('renders a pinned unknown id as not in current catalog', async () => {
      listModels.mockResolvedValue(result([]));
      const fixture = await create({
        provider: first.id,
        model: 'vendor/custom-id',
      });

      const modelSelect = select(fixture, 'provider-model-picker-model');
      expect(modelSelect.value).toBe('vendor/custom-id');
      const option = modelSelect.options[modelSelect.selectedIndex];
      expect(option.textContent?.trim()).toBe(
        'vendor/custom-id · not in current catalog',
      );
    });

    it('accepts a manually entered model id and emits it', async () => {
      const fixture = await create({ provider: first.id });
      const emitted: ProviderModelSelection[] = [];
      fixture.componentInstance.selectionChange.subscribe((s) =>
        emitted.push(s),
      );

      const input = fixture.nativeElement.querySelector(
        '[data-testid="provider-model-picker-manual-input"]',
      ) as HTMLInputElement;
      input.value = 'vendor/manual-id';
      input.dispatchEvent(new Event('input'));
      // A CD pass is what applies [disabled]="manualApplyDisabled()" to the
      // button — a click against the still-disabled DOM property is a no-op.
      fixture.detectChanges();

      const apply = fixture.nativeElement.querySelector(
        '[data-testid="provider-model-picker-manual-apply"]',
      ) as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      apply.click();
      fixture.detectChanges();

      expect(emitted).toEqual([
        { provider: first.id, model: 'vendor/manual-id' },
      ]);
      const modelSelect = select(fixture, 'provider-model-picker-model');
      expect(modelSelect.value).toBe('vendor/manual-id');
      expect(
        modelSelect.options[modelSelect.selectedIndex].textContent?.trim(),
      ).toBe('vendor/manual-id · not in current catalog');
    });

    it('keeps manual entry disabled until a provider is pinned', async () => {
      const fixture = await create();

      const input = fixture.nativeElement.querySelector(
        '[data-testid="provider-model-picker-manual-input"]',
      ) as HTMLInputElement;
      const apply = fixture.nativeElement.querySelector(
        '[data-testid="provider-model-picker-manual-apply"]',
      ) as HTMLButtonElement;
      expect(input.disabled).toBe(true);
      expect(apply.disabled).toBe(true);
    });

    it('hides the manual-entry disclosure entirely when the control is disabled', async () => {
      const fixture = await create({ provider: first.id, disabled: true });
      expect(el(fixture, 'provider-model-picker-manual-entry')).toBeNull();
    });
  });

  describe('content slot', () => {
    @Component({
      selector: 'ptah-spec-picker-slot-host',
      standalone: true,
      imports: [ProviderModelPickerComponent],
      template: `
        <ptah-provider-model-picker>
          <p data-testid="projected-scope-row">Scope row</p>
        </ptah-provider-model-picker>
      `,
    })
    class PickerSlotHostComponent {}

    beforeEach(async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [PickerSlotHostComponent],
        providers: [
          { provide: PROVIDER_MODELS_LOADER, useValue: { listModels } },
        ],
      }).compileComponents();
    });

    it('projects host content (e.g. a scope row) at the end of the picker', async () => {
      const hostFixture = TestBed.createComponent(PickerSlotHostComponent);
      hostFixture.detectChanges();
      await hostFixture.whenStable();

      const pickerSection = (
        hostFixture.nativeElement as HTMLElement
      ).querySelector('ptah-provider-model-picker');
      expect(pickerSection).not.toBeNull();
      // The slot sits at the end of the picker's <section>, so the projected
      // row is that section's last element child.
      const innerSection = pickerSection?.querySelector('section');
      expect(innerSection?.lastElementChild?.tagName).toBe('P');
      expect(
        (hostFixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="projected-scope-row"]',
        ),
      ).not.toBeNull();
    });
  });
});
