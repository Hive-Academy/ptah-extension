/**
 * Stored-key probes for modes that send a URL — PR 581 review round 1.
 *
 * No shipped registry entry is a local-native / local-proxy provider with an
 * optional key (`ollama-cloud` is `isLocal: false`, so the wizard treats it as
 * `apiKey`). These fixtures add synthetic entries so the local branch of
 * `usesStoredKey` and its saved-URL guard are exercised directly. The host binds
 * a stored key to the SAVED endpoint (`DraftVerificationService.bindStoredDraft`),
 * so the wizard must only ask for `{ kind: 'stored' }` with exactly that URL.
 */

jest.mock('@ptah-extension/shared', () => {
  const actual = jest.requireActual('@ptah-extension/shared');
  const fixtures = [
    {
      ...actual.getAnthropicProvider('ollama'),
      id: 'fixture-local',
      name: 'Fixture Local',
      baseUrl: 'http://127.0.0.1:1111',
      isLocal: true,
      requiresProxy: false,
      supportsOptionalApiKey: true,
    },
    {
      ...actual.getAnthropicProvider('lm-studio'),
      id: 'fixture-proxy',
      name: 'Fixture Proxy',
      baseUrl: 'http://127.0.0.1:1112',
      isLocal: true,
      requiresProxy: true,
      supportsOptionalApiKey: true,
    },
    {
      ...actual.getAnthropicProvider('openrouter'),
      id: 'my-endpoint',
      name: 'My endpoint',
      baseUrl: 'http://custom.example:3333',
      isCustom: true,
    },
  ];
  return {
    ...actual,
    getAllAnthropicProviders: () => [...actual.getAllAnthropicProviders(), ...fixtures],
    getAnthropicProvider: (id: string) =>
      fixtures.find((entry) => entry.id === id) ?? actual.getAnthropicProvider(id),
  };
});

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import type {
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
} from '@ptah-extension/shared';
import { ProviderSetupWizardComponent } from './provider-setup-wizard.component';

const SAVED = 'http://saved.example:2222';

function verifyEcho() {
  return jest.fn(
    (params: AuthVerifyDraftConnectionParams): Promise<AuthVerifyDraftConnectionResult> =>
      Promise.resolve({
        probeId: params.probeId,
        outcome: 'verified',
        reason: null,
        detail: null,
        latencyMs: 1,
        modelUsed: 'm',
        checkedAt: '2026-09-22T10:00:00.000Z',
      }),
  );
}

describe('ProviderSetupWizardComponent — stored key with a saved endpoint', () => {
  let fixture: ComponentFixture<ProviderSetupWizardComponent>;
  let verify: ReturnType<typeof verifyEcho>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProviderSetupWizardComponent],
      providers: [
        {
          provide: PROVIDER_MODELS_LOADER,
          useValue: { listModels: jest.fn().mockResolvedValue({ models: [] }) },
        },
      ],
    }).compileComponents();
    verify = verifyEcho();
    fixture = TestBed.createComponent(ProviderSetupWizardComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('verifyDraftConnection', verify);
    fixture.componentRef.setInput(
      'cancelDraftVerification',
      jest.fn(() => Promise.resolve({ cancelled: true })),
    );
    fixture.componentRef.setInput('existingCredentialPresent', true);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  function click(id: string) {
    (q(id) as HTMLButtonElement | null)?.click();
    fixture.detectChanges();
  }
  function selectProvider(id: string) {
    el().querySelector<HTMLInputElement>(`input[name="wizard-provider"][value="${id}"]`)?.click();
    fixture.detectChanges();
  }
  function loadSetup(providerId: string, baseUrl: string, custom = false) {
    fixture.componentRef.setInput('initialSetup', {
      providerId,
      baseUrl,
      tiers: { sonnet: null, opus: null, haiku: null },
      ...(custom ? { customName: 'My endpoint', customProtocol: 'openai' as const } : {}),
    });
    fixture.detectChanges();
  }
  function typeUrl(value: string) {
    const input = q('wizard-base-url') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  async function settle() {
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }
  const lastParams = () => verify.mock.calls.at(-1)?.[0] as AuthVerifyDraftConnectionParams;

  it.each(['fixture-local', 'fixture-proxy'])(
    '%s: probes the stored key against the SAVED endpoint and reviews it as unchanged',
    async (providerId) => {
      selectProvider(providerId);
      loadSetup(providerId, SAVED);
      click('wizard-continue');
      expect(q('wizard-local-stored-key')?.textContent).toContain('Key stored');
      click('wizard-continue');
      click('wizard-verify-start');
      expect(lastParams()).toMatchObject({
        providerId,
        credential: { kind: 'stored' },
        baseUrl: SAVED,
      });
      await settle();
      click('wizard-continue');
      click('wizard-continue');
      expect(q('wizard-review-credential')?.textContent?.trim()).toBe('Stored key (unchanged)');
    },
  );

  it.each(['fixture-local', 'fixture-proxy'])(
    '%s: an edited URL is a new destination — no stored-key request is sent',
    async (providerId) => {
      selectProvider(providerId);
      loadSetup(providerId, SAVED);
      click('wizard-continue');
      typeUrl('http://elsewhere.example:9999');
      expect(q('wizard-local-stored-key')).toBeNull();
      click('wizard-continue');
      click('wizard-verify-start');
      expect(lastParams().credential).toBeUndefined();
      expect(lastParams().baseUrl).toBe('http://elsewhere.example:9999');
    },
  );

  it('compares against the saved override, not the registry default, when setup loads late', async () => {
    selectProvider('fixture-local');
    click('wizard-continue');
    // Setup not loaded yet: the draft holds the registry default, and the saved
    // endpoint is unknown, so no stored-key probe is offered.
    expect((q('wizard-base-url') as HTMLInputElement).value).toBe('http://127.0.0.1:1111');
    expect(q('wizard-local-stored-key')).toBeNull();
    click('wizard-continue');
    click('wizard-verify-start');
    expect(lastParams().credential).toBeUndefined();
    await settle();

    // The saved override arrives: the draft follows it and the stored key binds to it.
    click('wizard-back');
    loadSetup('fixture-local', SAVED);
    expect((q('wizard-base-url') as HTMLInputElement).value).toBe(SAVED);
    expect(q('wizard-local-stored-key')).not.toBeNull();

    // Typing the registry default back is a different destination from the saved override.
    typeUrl('http://127.0.0.1:1111');
    expect(q('wizard-local-stored-key')).toBeNull();
  });

  it('custom endpoint: the stored key follows the saved URL and is withdrawn when the URL is edited', async () => {
    fixture.componentRef.setInput('deepLinkProviderId', 'my-endpoint');
    fixture.detectChanges();
    loadSetup('my-endpoint', SAVED, true);
    click('wizard-continue');
    expect(q('wizard-custom-stored-key')).not.toBeNull();
    click('wizard-continue');
    click('wizard-verify-start');
    expect(lastParams()).toMatchObject({
      providerId: 'my-endpoint',
      authMode: 'custom',
      credential: { kind: 'stored' },
      baseUrl: SAVED,
    });
    await settle();

    click('wizard-back');
    typeUrl('http://moved.example:4444');
    expect(q('wizard-custom-stored-key')).toBeNull();
    // A custom endpoint needs a key; with no stored key for the new URL, verification cannot start.
    expect((q('wizard-continue') as HTMLButtonElement).disabled).toBe(true);
  });
});
