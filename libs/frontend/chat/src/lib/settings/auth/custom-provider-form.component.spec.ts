/**
 * CustomProviderFormComponent specs — TASK_2026_236 Batch D.
 *
 * Coverage:
 *   - validation rejects an unparseable / non-http base URL before any RPC
 *   - validation rejects a name that collides with an existing provider
 *   - the lane radio produces the stored `lane` verbatim (never inferred)
 *   - the API key travels as a sibling param, never inside the entry
 *   - the optional pricing pair is parsed, and its absence is called out
 *   - delete affordances render only once the entry exists
 *   - a backend rejection leaves the form open
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthStateService } from '@ptah-extension/core';
import type {
  AnthropicProviderInfo,
  CustomProviderEntry,
} from '@ptah-extension/shared';
import { CustomProviderFormComponent } from './custom-provider-form.component';

function makeProvider(
  overrides: Partial<AnthropicProviderInfo> = {},
): AnthropicProviderInfo {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '',
    helpUrl: '',
    keyPrefix: '',
    keyPlaceholder: '',
    maskedKeyDisplay: '',
    authType: 'apiKey',
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<CustomProviderEntry> = {},
): CustomProviderEntry {
  return {
    id: 'my-gateway',
    name: 'My Gateway',
    baseUrl: 'https://gateway.example.com',
    lane: 'openai',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: '',
    helpUrl: '',
    modelsEndpoint: null,
    defaultTiers: null,
    pricing: null,
    createdAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

function buildAuthStateStub() {
  const availableProviders = signal<AnthropicProviderInfo[]>([]);
  const customEntries = signal<readonly CustomProviderEntry[]>([]);
  const customEntryError = signal('');
  const customTestState = signal<{
    id: string;
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const customTestingId = signal<string | null>(null);

  return {
    availableProviders: availableProviders.asReadonly(),
    customEntries: customEntries.asReadonly(),
    customEntryError: customEntryError.asReadonly(),
    customTestState: customTestState.asReadonly(),
    customTestingId: customTestingId.asReadonly(),
    addCustomEntry: jest.fn(async (entry: unknown) => ({
      ok: true,
      entry: entry as CustomProviderEntry,
    })),
    updateCustomEntry: jest.fn(async () => ({
      ok: true,
      entry: makeEntry(),
    })),
    removeCustomEntry: jest.fn(async () => true),
    testCustomEntry: jest.fn(async () => ({ ok: true, message: 'Connected.' })),
    clearCustomEntryError: jest.fn(),
    clearCustomTestState: jest.fn(),
    _availableProviders: availableProviders,
    _customEntries: customEntries,
    _customEntryError: customEntryError,
    _customTestState: customTestState,
    _customTestingId: customTestingId,
  };
}

type AuthStateStub = ReturnType<typeof buildAuthStateStub>;

function mount(authState: AuthStateStub): {
  fixture: ComponentFixture<CustomProviderFormComponent>;
  component: CustomProviderFormComponent;
} {
  TestBed.configureTestingModule({
    imports: [CustomProviderFormComponent],
    providers: [{ provide: AuthStateService, useValue: authState }],
  });
  const fixture = TestBed.createComponent(CustomProviderFormComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance };
}

function fillValidDraft(component: CustomProviderFormComponent): void {
  component.name.set('My Gateway');
  component.baseUrl.set('https://gateway.example.com');
}

describe('CustomProviderFormComponent', () => {
  let authState: AuthStateStub;

  beforeEach(() => {
    authState = buildAuthStateStub();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('base URL validation', () => {
    it('rejects a URL with no scheme and does not call the backend', async () => {
      const { component, fixture } = mount(authState);
      component.name.set('My Gateway');
      component.baseUrl.set('gateway.example.com');

      await component.save();
      fixture.detectChanges();

      expect(authState.addCustomEntry).not.toHaveBeenCalled();
      expect(component.validation().ok).toBe(false);
      expect(component.visibleErrors().join(' ')).toContain('Base URL');
    });

    it('rejects a non-http scheme', async () => {
      const { component } = mount(authState);
      component.name.set('My Gateway');
      component.baseUrl.set('ftp://gateway.example.com');

      await component.save();

      expect(authState.addCustomEntry).not.toHaveBeenCalled();
      expect(component.visibleErrors().join(' ')).toContain('Base URL');
    });

    it('accepts a plain http:// LAN address — self-hosted boxes are a use case', () => {
      const { component } = mount(authState);
      component.name.set('LAN box');
      component.baseUrl.set('http://192.168.1.50:8000');

      expect(component.validation().ok).toBe(true);
      expect(component.typedHost()).toBe('192.168.1.50:8000');
    });

    it('suppresses errors until the first save attempt', () => {
      const { component } = mount(authState);
      component.baseUrl.set('nonsense');
      expect(component.visibleErrors()).toEqual([]);
    });
  });

  describe('duplicate name validation', () => {
    it('rejects a name already used by another custom entry', async () => {
      authState._customEntries.set([makeEntry({ name: 'My Gateway' })]);
      const { component } = mount(authState);
      component.name.set('  my gateway  ');
      component.baseUrl.set('https://other.example.com');

      await component.save();

      expect(authState.addCustomEntry).not.toHaveBeenCalled();
      expect(component.visibleErrors().join(' ')).toContain('already exists');
    });

    it('rejects a name already used by a built-in provider', async () => {
      authState._availableProviders.set([makeProvider({ name: 'OpenRouter' })]);
      const { component } = mount(authState);
      component.name.set('OpenRouter');
      component.baseUrl.set('https://other.example.com');

      await component.save();

      expect(authState.addCustomEntry).not.toHaveBeenCalled();
      expect(component.visibleErrors().join(' ')).toContain('already exists');
    });

    it('allows an entry to keep its own name while editing', () => {
      const entry = makeEntry({ name: 'My Gateway' });
      authState._customEntries.set([entry]);
      const { component, fixture } = mount(authState);
      fixture.componentRef.setInput('entry', entry);
      fixture.detectChanges();

      expect(component.name()).toBe('My Gateway');
      expect(component.validation().ok).toBe(true);
    });

    it('derives a unique id from the name, avoiding taken ids', () => {
      authState._customEntries.set([makeEntry({ id: 'my-gateway' })]);
      const { component } = mount(authState);
      component.name.set('My Gateway!');

      expect(component.draftId()).toBe('my-gateway-2');
    });
  });

  describe('lane radio', () => {
    it('defaults to the OpenAI-compatible lane', () => {
      const { component } = mount(authState);
      expect(component.lane()).toBe('openai');
    });

    it('sends lane "openai" verbatim when the OpenAI radio is chosen', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.selectLane('openai');

      await component.save();

      expect(authState.addCustomEntry).toHaveBeenCalledWith(
        expect.objectContaining({ lane: 'openai' }),
        undefined,
      );
    });

    it('sends lane "anthropic" verbatim when the Anthropic radio is chosen, regardless of the URL', async () => {
      const { component } = mount(authState);
      component.name.set('Requesty EU');
      // A URL that looks nothing like an Anthropic endpoint — the lane is the
      // user's declaration, never inferred from the host.
      component.baseUrl.set('https://router.eu.requesty.ai');
      component.selectLane('anthropic');

      await component.save();

      expect(authState.addCustomEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          lane: 'anthropic',
          baseUrl: 'https://router.eu.requesty.ai',
        }),
        undefined,
      );
    });

    it('renders both lanes as radio inputs, not a free-text protocol field', () => {
      const { fixture } = mount(authState);
      const radios = fixture.nativeElement.querySelectorAll(
        'input[type="radio"]',
      );
      expect(radios.length).toBe(2);
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-lane-anthropic"]',
        ),
      ).toBeTruthy();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-lane-openai"]',
        ),
      ).toBeTruthy();
    });
  });

  describe('API key handling', () => {
    it('passes the key as a sibling param and keeps it out of the entry', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.apiKey.set('sk-super-secret');

      await component.save();

      const [entry, key] = authState.addCustomEntry.mock.calls[0] as [
        Record<string, unknown>,
        string | undefined,
      ];
      expect(key).toBe('sk-super-secret');
      expect(entry).not.toHaveProperty('apiKey');
      expect(JSON.stringify(entry)).not.toContain('sk-super-secret');
    });

    it('omits the key entirely when the field is blank', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);

      await component.save();

      expect(authState.addCustomEntry).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
      );
    });

    it('clears the key field after a successful save', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.apiKey.set('sk-super-secret');

      await component.save();

      expect(component.apiKey()).toBe('');
    });
  });

  describe('optional pricing', () => {
    it('sends null pricing when both rates are blank, and says cost will be unavailable', () => {
      const { component, fixture } = mount(authState);
      fillValidDraft(component);
      fixture.detectChanges();

      const result = component.validation();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entry.pricing).toBeNull();
      }
      expect(component.pricingOmitted()).toBe(true);
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-pricing-hint"]',
        ).textContent,
      ).toContain('cost unavailable');
    });

    it('parses a complete per-1M rate pair', () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.priceInput.set('3');
      component.priceOutput.set('15');

      const result = component.validation();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entry.pricing).toEqual({
          inputPerMillion: 3,
          outputPerMillion: 15,
        });
      }
      expect(component.pricingOmitted()).toBe(false);
    });

    it('rejects a half-filled rate pair', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.priceInput.set('3');

      await component.save();

      expect(authState.addCustomEntry).not.toHaveBeenCalled();
      expect(component.visibleErrors().join(' ')).toContain('Pricing');
    });

    it('rejects a negative rate', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.priceInput.set('-1');
      component.priceOutput.set('15');

      await component.save();

      expect(authState.addCustomEntry).not.toHaveBeenCalled();
    });
  });

  describe('model tier mapping', () => {
    it('rejects a partially filled tier mapping', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.tierSonnet.set('vendor/model-a');

      await component.save();

      expect(authState.addCustomEntry).not.toHaveBeenCalled();
      expect(component.visibleErrors().join(' ')).toContain('all three tiers');
    });

    it('sends a complete tier mapping', async () => {
      const { component } = mount(authState);
      fillValidDraft(component);
      component.tierSonnet.set('vendor/sonnet');
      component.tierOpus.set('vendor/opus');
      component.tierHaiku.set('vendor/haiku');

      await component.save();

      expect(authState.addCustomEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultTiers: {
            sonnet: 'vendor/sonnet',
            opus: 'vendor/opus',
            haiku: 'vendor/haiku',
          },
        }),
        undefined,
      );
    });
  });

  describe('edit and delete affordances', () => {
    it('offers no delete control while the entry does not exist yet', () => {
      const { fixture } = mount(authState);
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-delete"]',
        ),
      ).toBeNull();
    });

    it('disables "Test connection" until the entry exists backend-side', () => {
      const { fixture } = mount(authState);
      const button: HTMLButtonElement = fixture.nativeElement.querySelector(
        '[data-testid="custom-provider-test"]',
      );
      expect(button.disabled).toBe(true);
    });

    it('offers delete once bound to a stored entry', () => {
      const { fixture } = mount(authState);
      fixture.componentRef.setInput('entry', makeEntry());
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-delete"]',
        ),
      ).toBeTruthy();
    });

    it('requires a confirmation before deleting', async () => {
      const { component, fixture } = mount(authState);
      fixture.componentRef.setInput('entry', makeEntry());
      fixture.detectChanges();

      component.requestDelete();
      fixture.detectChanges();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-delete-confirm"]',
        ),
      ).toBeTruthy();

      const deleted = jest.fn();
      component.deleted.subscribe(deleted);
      await component.confirmDelete();

      expect(authState.removeCustomEntry).toHaveBeenCalledWith('my-gateway');
      expect(deleted).toHaveBeenCalledWith('my-gateway');
    });

    it('keeps the entry when the delete fails', async () => {
      authState.removeCustomEntry.mockResolvedValueOnce(false);
      const { component, fixture } = mount(authState);
      fixture.componentRef.setInput('entry', makeEntry());
      fixture.detectChanges();

      const deleted = jest.fn();
      component.deleted.subscribe(deleted);
      component.requestDelete();
      await component.confirmDelete();

      expect(deleted).not.toHaveBeenCalled();
    });
  });

  describe('editing an existing entry', () => {
    it('seeds every field from the stored entry, except the key', () => {
      const entry = makeEntry({
        lane: 'anthropic',
        helpUrl: 'https://help.example.com',
        modelsEndpoint: 'https://gateway.example.com/v1/models',
        defaultTiers: { sonnet: 's', opus: 'o', haiku: 'h' },
        pricing: { inputPerMillion: 2, outputPerMillion: 8 },
      });
      const { component, fixture } = mount(authState);
      fixture.componentRef.setInput('entry', entry);
      fixture.detectChanges();

      expect(component.name()).toBe('My Gateway');
      expect(component.baseUrl()).toBe('https://gateway.example.com');
      expect(component.lane()).toBe('anthropic');
      expect(component.helpUrl()).toBe('https://help.example.com');
      expect(component.modelsEndpoint()).toBe(
        'https://gateway.example.com/v1/models',
      );
      expect(component.tierSonnet()).toBe('s');
      expect(component.priceInput()).toBe('2');
      expect(component.priceOutput()).toBe('8');
      expect(component.apiKey()).toBe('');
    });

    it('routes a save through updateCustomEntry with the entry id', async () => {
      const entry = makeEntry();
      const { component, fixture } = mount(authState);
      fixture.componentRef.setInput('entry', entry);
      fixture.detectChanges();
      component.name.set('Renamed Gateway');

      await component.save();

      expect(authState.updateCustomEntry).toHaveBeenCalledWith(
        'my-gateway',
        expect.objectContaining({ name: 'Renamed Gateway' }),
        undefined,
      );
      expect(authState.addCustomEntry).not.toHaveBeenCalled();
    });

    it('probes the endpoint through testCustomEntry', async () => {
      const entry = makeEntry();
      const { component, fixture } = mount(authState);
      fixture.componentRef.setInput('entry', entry);
      fixture.detectChanges();

      await component.testConnection();

      expect(authState.testCustomEntry).toHaveBeenCalledWith('my-gateway');
    });

    it('shows the probe message verbatim', () => {
      const entry = makeEntry();
      const { fixture } = mount(authState);
      fixture.componentRef.setInput('entry', entry);
      authState._customTestState.set({
        id: 'my-gateway',
        ok: false,
        message: 'TLS handshake failed — the certificate is not trusted.',
      });
      fixture.detectChanges();

      const result = fixture.nativeElement.querySelector(
        '[data-testid="custom-provider-test-result"]',
      );
      expect(result.textContent).toContain(
        'TLS handshake failed — the certificate is not trusted.',
      );
    });

    it('shows a pending state while the probe runs', () => {
      const entry = makeEntry();
      const { fixture } = mount(authState);
      fixture.componentRef.setInput('entry', entry);
      authState._customTestingId.set('my-gateway');
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-test-pending"]',
        ),
      ).toBeTruthy();
    });
  });

  describe('backend rejection', () => {
    it('does not emit saved and leaves the form open', async () => {
      authState.addCustomEntry.mockResolvedValueOnce({
        ok: false,
        entry: undefined as unknown as CustomProviderEntry,
      });
      const { component } = mount(authState);
      fillValidDraft(component);
      const saved = jest.fn();
      component.saved.subscribe(saved);

      await component.save();

      expect(saved).not.toHaveBeenCalled();
      expect(component.isEditing()).toBe(false);
    });

    it('renders the backend message verbatim', () => {
      authState._customEntryError.set(
        'baseUrl must use http(s) scheme (got \'ftp:\')',
      );
      const { fixture } = mount(authState);
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-backend-error"]',
        ).textContent,
      ).toContain("baseUrl must use http(s) scheme (got 'ftp:')");
    });
  });

  describe('successful create', () => {
    it('emits the stored entry and flips into edit mode so Test becomes reachable', async () => {
      const stored = makeEntry();
      authState.addCustomEntry.mockResolvedValueOnce({ ok: true, entry: stored });
      const { component, fixture } = mount(authState);
      fillValidDraft(component);
      const saved = jest.fn();
      component.saved.subscribe(saved);

      await component.save();
      fixture.detectChanges();

      expect(saved).toHaveBeenCalledWith(stored);
      expect(component.isEditing()).toBe(true);
      const testButton: HTMLButtonElement = fixture.nativeElement.querySelector(
        '[data-testid="custom-provider-test"]',
      );
      expect(testButton.disabled).toBe(false);
    });
  });

  describe('security copy', () => {
    it('names the host the user typed', () => {
      const { component, fixture } = mount(authState);
      component.baseUrl.set('https://gateway.example.com/v1');
      fixture.detectChanges();

      const note = fixture.nativeElement.querySelector(
        '[data-testid="custom-provider-security-note"]',
      );
      expect(note.textContent).toContain('gateway.example.com');
      expect(note.textContent).toContain('does not operate, vet, or monitor');
    });

    it('names no host while the URL is still unparseable', () => {
      const { component, fixture } = mount(authState);
      component.baseUrl.set('http');
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-security-note"]',
        ),
      ).toBeNull();
    });
  });

  describe('cancel', () => {
    it('clears transient state and emits', () => {
      const { component } = mount(authState);
      const cancelled = jest.fn();
      component.cancelled.subscribe(cancelled);

      component.cancel();

      expect(authState.clearCustomEntryError).toHaveBeenCalled();
      expect(authState.clearCustomTestState).toHaveBeenCalled();
      expect(cancelled).toHaveBeenCalled();
    });
  });
});
