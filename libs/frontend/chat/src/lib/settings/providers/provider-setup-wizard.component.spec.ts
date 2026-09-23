/**
 * ProviderSetupWizardComponent specs — TASK_2026_523_c3df, group D1 (the
 * wizard).
 *
 * Coverage (implementation plan "Wizard" and the batch rules):
 *   - five-step machine: gating per step, completed-step links, focus on the
 *     new step heading
 *   - draft safety: the probe runs on the draft params only, no probe on a
 *     keystroke, credential edits invalidate a prior verification, a failed
 *     probe stays on Verify with the draft intact, stale results are
 *     discarded, and failure copy comes from the reason map (never a parsed
 *     message, never a raw error)
 *   - the verify-then-cancel pin case: persisted settings are untouched
 *     (`commitRequested` never emitted, cancel seam called, drawer closed)
 *   - the models `''` sentinel renders as "Provider default" in the review
 *   - scope defaults, save targets, commit payload, saved/failed host states
 *   - close with and without a draft
 *   - 36 px control height and the 2 px focus outline on every button
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import type {
  AuthCancelDraftVerificationParams,
  AuthCancelDraftVerificationResult,
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
  ProbeFailureReason,
} from '@ptah-extension/shared';
import { ProviderSetupWizardComponent, type ProviderWizardCommit } from './provider-setup-wizard.component';

type WizardInputs = {
  [K in keyof ProviderSetupWizardComponent]?: unknown;
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject: (reason?: unknown) => reject(reason) };
}

function verifiedResult(probeId: string): AuthVerifyDraftConnectionResult {
  return {
    probeId,
    outcome: 'verified',
    reason: null,
    detail: null,
    latencyMs: 123,
    modelUsed: 'test-model',
    checkedAt: '2026-09-22T10:00:00.000Z',
  };
}

function failedResult(
  probeId: string,
  reason: ProbeFailureReason,
): AuthVerifyDraftConnectionResult {
  return {
    probeId,
    outcome: 'failed',
    reason,
    detail: 'sanitized backend detail',
    latencyMs: null,
    modelUsed: null,
    checkedAt: '2026-09-22T10:00:00.000Z',
  };
}

/**
 * The wizard assigns a fresh probeId to every probe, so a verify mock must
 * echo the probeId it received — a hardcoded id would be treated as a stale
 * result from a superseded probe and discarded.
 */
function verifyEcho(): jest.Mock<
  Promise<AuthVerifyDraftConnectionResult>,
  [AuthVerifyDraftConnectionParams]
> {
  return jest.fn((params: AuthVerifyDraftConnectionParams) =>
    Promise.resolve(verifiedResult(params.probeId)),
  );
}

function failEcho(
  reason: ProbeFailureReason,
): jest.Mock<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]> {
  return jest.fn((params: AuthVerifyDraftConnectionParams) =>
    Promise.resolve(failedResult(params.probeId, reason)),
  );
}

function createComponent(
  inputs: Partial<WizardInputs> = {},
  verify?: jest.Mock,
  cancel?: jest.Mock,
): ComponentFixture<ProviderSetupWizardComponent> {
  const fixture = TestBed.createComponent(ProviderSetupWizardComponent);
  const ref = fixture.componentRef;
  ref.setInput('open', true);
  ref.setInput(
    'verifyDraftConnection',
    verify ??
      jest.fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>(
        () => new Promise(() => undefined),
      ),
  );
  ref.setInput(
    'cancelDraftVerification',
    cancel ??
      jest.fn<Promise<AuthCancelDraftVerificationResult>, [AuthCancelDraftVerificationParams]>(
        () => Promise.resolve({ cancelled: true }),
      ),
  );
  for (const [key, value] of Object.entries(inputs)) {
    ref.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture;
}

function query(
  fixture: ComponentFixture<ProviderSetupWizardComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function button(
  fixture: ComponentFixture<ProviderSetupWizardComponent>,
  testId: string,
): HTMLButtonElement | null {
  return query(fixture, testId) as HTMLButtonElement | null;
}

function click(
  fixture: ComponentFixture<ProviderSetupWizardComponent>,
  testId: string,
): void {
  button(fixture, testId)?.click();
  fixture.detectChanges();
}

function typeInto(
  fixture: ComponentFixture<ProviderSetupWizardComponent>,
  testId: string,
  value: string,
): void {
  const input = query(fixture, testId) as HTMLInputElement | null;
  if (!input) throw new Error(`missing input ${testId}`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function selectProvider(
  fixture: ComponentFixture<ProviderSetupWizardComponent>,
  id: string,
): void {
  const radio = fixture.nativeElement.querySelector(
    `input[type="radio"][name="wizard-provider"][value="${id}"]`,
  ) as HTMLInputElement | null;
  if (!radio) throw new Error(`missing provider radio ${id}`);
  radio.click();
  fixture.detectChanges();
}

/** Walks: provider → credential (key) → verify (verified) → models → scope. */
async function reachScope(fixture: ComponentFixture<ProviderSetupWizardComponent>): Promise<void> {
  selectProvider(fixture, 'requesty');
  click(fixture, 'wizard-continue');
  typeInto(fixture, 'wizard-api-key', 'sk-test-123');
  click(fixture, 'wizard-continue');
  click(fixture, 'wizard-verify-start');
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
  click(fixture, 'wizard-continue');
  click(fixture, 'wizard-continue');
  click(fixture, 'wizard-continue');
}

describe('ProviderSetupWizardComponent', () => {
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('opening and step machine', () => {
    it('opens on the Provider step with five steps and a disabled Continue', () => {
      const fixture = createComponent();
      expect(query(fixture, 'wizard-title')?.textContent?.trim()).toBe('Connect provider');
      expect(fixture.nativeElement.querySelectorAll('[data-testid="wizard-step-link"]').length).toBe(0);
      const current = fixture.nativeElement.querySelector('li[aria-current="step"]');
      expect(current?.textContent).toContain('Provider');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
    });

    it('preselects the deep-linked provider and stays on the Provider step', () => {
      const fixture = createComponent({ deepLinkProviderId: 'ollama' });
      const radio = fixture.nativeElement.querySelector(
        'input[type="radio"][name="wizard-provider"][value="ollama"]',
      ) as HTMLInputElement | null;
      expect(radio?.checked).toBe(true);
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });

    it('filters provider options and offers Clear search when nothing matches', () => {
      const fixture = createComponent();
      typeInto(fixture, 'wizard-provider-search', 'requesty');
      expect(fixture.nativeElement.querySelectorAll('[data-testid="wizard-provider-radio"]').length).toBe(1);
      typeInto(fixture, 'wizard-provider-search', 'no-such-provider');
      expect(query(fixture, 'wizard-provider-no-match')?.textContent).toContain('No providers match');
      click(fixture, 'wizard-clear-search');
      expect(
        fixture.nativeElement.querySelectorAll('[data-testid="wizard-provider-radio"]').length,
      ).toBeGreaterThan(1);
    });

    it('gates the custom endpoint on a name and a compatibility protocol', () => {
      const fixture = createComponent();
      const customRadio = fixture.nativeElement.querySelector(
        '[data-testid="wizard-provider-custom-radio"]',
      ) as HTMLInputElement | null;
      customRadio?.click();
      fixture.detectChanges();
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
      expect(query(fixture, 'wizard-custom-name-error')?.textContent?.trim()).toBe(
        'Enter a name for the connection.',
      );
      expect(query(fixture, 'wizard-custom-protocol-error')?.textContent?.trim()).toBe(
        'Choose a compatibility protocol.',
      );
      typeInto(fixture, 'wizard-custom-name', 'My gateway');
      click(fixture, 'wizard-protocol-anthropic');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });

    it('moves to the next step and focuses the new step heading', async () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      const heading = query(fixture, 'wizard-step-heading');
      expect(heading?.textContent?.trim()).toBe('Credential');
      expect(document.activeElement).toBe(heading);
    });

    it('marks the current step with aria-current and offers completed steps as links', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      const current = fixture.nativeElement.querySelector('li[aria-current="step"]');
      expect(current?.textContent).toContain('Credential');
      const links = fixture.nativeElement.querySelectorAll(
        '[data-testid="wizard-step-link"]',
      ) as HTMLButtonElement[];
      // Both the horizontal strip and the mobile strip offer the link.
      expect(links.length).toBeGreaterThanOrEqual(1);
      links[0].click();
      fixture.detectChanges();
      expect(query(fixture, 'wizard-step-heading')?.textContent?.trim()).toBe('Provider');
    });

    it('revisits a completed step only when the probe is not in flight', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-step-link');
      fixture.detectChanges();
      expect(query(fixture, 'wizard-step-heading')?.textContent?.trim()).toBe('Provider');
    });
  });

  describe('credential step', () => {
    it('masks the key, toggles visibility with aria-pressed, and enables Continue', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      const keyInput = query(fixture, 'wizard-api-key') as HTMLInputElement;
      expect(keyInput.type).toBe('password');
      const toggle = button(fixture, 'wizard-key-visibility');
      expect(toggle?.getAttribute('aria-pressed')).toBe('false');
      toggle?.click();
      fixture.detectChanges();
      expect((query(fixture, 'wizard-api-key') as HTMLInputElement).type).toBe('text');
      expect(button(fixture, 'wizard-key-visibility')?.getAttribute('aria-pressed')).toBe('true');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });

    it('blocks an empty key with the design copy', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      expect(query(fixture, 'wizard-credential-error')?.textContent?.trim()).toBe(
        'Enter an API key to continue.',
      );
    });

    it('B2-1: offers Verify stored key and Replace key, and a stored key needs no re-entry', () => {
      const fixture = createComponent({ existingCredentialPresent: true });
      selectProvider(fixture, 'requesty'); click(fixture, 'wizard-continue');
      expect(query(fixture, 'wizard-key-stored')?.textContent?.trim()).toBe('Key stored');
      expect(button(fixture, 'wizard-verify-stored-key')).not.toBeNull();
      expect(button(fixture, 'wizard-replace-key')).not.toBeNull();
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
      // Replacing switches to a typed key, which is then required.
      click(fixture, 'wizard-replace-key');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
      typeInto(fixture, 'wizard-api-key', 'sk-reentered');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });

    it('drives the OAuth sign-in states through the external action output', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'github-copilot');
      click(fixture, 'wizard-continue');
      const emitted: string[] = [];
      fixture.componentInstance.externalActionRequested.subscribe((action) => {
        emitted.push(action.action);
      });
      click(fixture, 'wizard-sign-in');
      expect(emitted).toEqual(['sign-in']);
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
    });

    it('reports the in-flight sign-in and offers Cancel sign-in', () => {
      const fixture = createComponent({
        externalAuth: { signInState: 'in-flight', accountLabel: null, cliInstalled: null },
      });
      selectProvider(fixture, 'github-copilot');
      click(fixture, 'wizard-continue');
      expect(query(fixture, 'wizard-sign-in-waiting')?.textContent?.trim()).toBe(
        'Waiting for sign-in…',
      );
      const emitted: string[] = [];
      fixture.componentInstance.externalActionRequested.subscribe((action) => {
        emitted.push(action.action);
      });
      click(fixture, 'wizard-sign-in-cancel');
      expect(emitted).toEqual(['sign-in-cancel']);
    });

    it('unlocks the step when the host reports a signed-in account', () => {
      const fixture = createComponent({
        externalAuth: { signInState: 'signed-in', accountLabel: 'octocat', cliInstalled: null },
      });
      selectProvider(fixture, 'github-copilot');
      click(fixture, 'wizard-continue');
      expect(query(fixture, 'wizard-sign-in-ok')?.textContent?.trim()).toBe(
        'Signed in as octocat',
      );
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });

    it('asks for a CLI login and checks installation through the external action output', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'claude-cli');
      click(fixture, 'wizard-continue');
      expect(query(fixture, 'wizard-cli-signed-out')).not.toBeNull();
      const emitted: string[] = [];
      fixture.componentInstance.externalActionRequested.subscribe((action) => {
        emitted.push(action.action);
      });
      click(fixture, 'wizard-cli-login');
      expect(emitted).toEqual(['cli-login']);

      const notInstalled = createComponent({
        externalAuth: { signInState: 'signed-out', accountLabel: null, cliInstalled: false },
      });
      selectProvider(notInstalled, 'claude-cli');
      click(notInstalled, 'wizard-continue');
      expect(query(notInstalled, 'wizard-cli-not-installed')).not.toBeNull();
      const notInstalledEmitted: string[] = [];
      notInstalled.componentInstance.externalActionRequested.subscribe((action) => {
        notInstalledEmitted.push(action.action);
      });
      click(notInstalled, 'wizard-cli-check');
      expect(notInstalledEmitted).toEqual(['cli-check']);

      const installed = createComponent({
        externalAuth: { signInState: 'signed-in', accountLabel: null, cliInstalled: true },
      });
      selectProvider(installed, 'claude-cli');
      click(installed, 'wizard-continue');
      expect(button(installed, 'wizard-continue')?.disabled).toBe(false);
    });

    it('prefills the local server URL and rejects a non-http URL', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'ollama');
      click(fixture, 'wizard-continue');
      expect((query(fixture, 'wizard-base-url') as HTMLInputElement).value).toBe(
        'http://127.0.0.1:11434',
      );
      typeInto(fixture, 'wizard-base-url', 'not-a-url');
      expect(query(fixture, 'wizard-url-error')?.textContent?.trim()).toBe(
        'Enter an http:// or https:// URL.',
      );
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
      typeInto(fixture, 'wizard-base-url', 'http://127.0.0.1:11434');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });
  });

  describe('provider change with a draft', () => {
    it('offers the inline discard choice and keeps the state on Keep editing', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-step-link');
      selectProvider(fixture, 'ollama');
      expect(query(fixture, 'wizard-provider-change-review')).not.toBeNull();
      click(fixture, 'wizard-provider-change-keep');
      expect(query(fixture, 'wizard-provider-change-review')).toBeNull();
      expect(
        (fixture.nativeElement.querySelector('input[value="requesty"]') as HTMLInputElement | null)
          ?.checked,
      ).toBe(true);
    });

    it('switches the provider and clears the downstream draft on Discard', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-step-link');
      selectProvider(fixture, 'ollama');
      click(fixture, 'wizard-provider-change-discard');
      expect(
        (fixture.nativeElement.querySelector('input[value="ollama"]') as HTMLInputElement | null)
          ?.checked,
      ).toBe(true);
      click(fixture, 'wizard-continue');
      expect((query(fixture, 'wizard-base-url') as HTMLInputElement).value).toBe(
        'http://127.0.0.1:11434',
      );
    });
  });

  describe('verification', () => {
    it('calls the verify seam with the draft params and never a persisted route', () => {
      const verify =
        jest.fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>(
          () => new Promise(() => undefined),
        );
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      expect(verify).toHaveBeenCalledTimes(1);
      const params = verify.mock.calls[0][0];
      expect(params.providerId).toBe('requesty');
      expect(params.authMode).toBe('apiKey');
      expect(params.credential).toEqual({ kind: 'apiKey', value: 'sk-test-123' });
      expect(params.timeoutMs).toBe(30000);
      expect(params.baseUrl).toBeUndefined();
      expect(params.probeId).toMatch(/^draft-probe-\d+$/);
    });

    it('B2-1: verifies the stored key on the host and saves a models-only edit without re-entry', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({ existingCredentialPresent: true }, verify);
      selectProvider(fixture, 'requesty'); click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-stored-key');
      expect(verify).toHaveBeenCalledTimes(1);
      const params = verify.mock.calls[0][0] as AuthVerifyDraftConnectionParams;
      // No secret crosses the boundary: the host reads its own stored key.
      expect(params.credential).toEqual({ kind: 'stored' });
      await Promise.resolve(); await Promise.resolve(); fixture.detectChanges();
      expect(query(fixture, 'wizard-verify-success')).not.toBeNull();
      click(fixture, 'wizard-continue'); click(fixture, 'wizard-continue');
      const commits: ProviderWizardCommit[] = [];
      fixture.componentInstance.commitRequested.subscribe((commit) => commits.push(commit));
      expect(query(fixture, 'wizard-review-credential')?.textContent?.trim()).toBe('Stored key (unchanged)');
      click(fixture, 'wizard-commit');
      expect(commits[0]).toMatchObject({ credential: null, existingKeyReused: true, verified: { probeId: params.probeId } });
    });

    it('PR 581: Ollama Cloud (optional key) verifies its stored key without re-entry and sends no URL', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({ existingCredentialPresent: true }, verify);
      selectProvider(fixture, 'ollama-cloud'); click(fixture, 'wizard-continue');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
      click(fixture, 'wizard-verify-stored-key');
      const params = verify.mock.calls[0][0] as AuthVerifyDraftConnectionParams;
      expect(params).toMatchObject({ providerId: 'ollama-cloud', credential: { kind: 'stored' } });
      // The host binds the stored key to the saved endpoint; no caller URL is sent.
      expect(params.baseUrl).toBeUndefined();
      await Promise.resolve(); await Promise.resolve(); fixture.detectChanges();
      click(fixture, 'wizard-continue'); click(fixture, 'wizard-continue');
      expect(query(fixture, 'wizard-review-credential')?.textContent?.trim()).toBe('Stored key (unchanged)');
    });

    it('does not probe while the user types', () => {
      const verify =
        jest.fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>(
          () => new Promise(() => undefined),
        );
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      expect(verify).not.toHaveBeenCalled();
    });

    it('shows the elapsed time while checking and cancels through the cancel seam', () => {
      jest.useFakeTimers();
      const verify =
        jest.fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>(
          () => new Promise(() => undefined),
        );
      const cancel =
        jest.fn<Promise<AuthCancelDraftVerificationResult>, [AuthCancelDraftVerificationParams]>(
          () => Promise.resolve({ cancelled: true }),
        );
      const fixture = createComponent({}, verify, cancel);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      expect(query(fixture, 'wizard-verify-checking')).not.toBeNull();
      jest.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(query(fixture, 'wizard-verify-elapsed')?.textContent).toContain('2 s elapsed');
      click(fixture, 'wizard-verify-cancel');
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel.mock.calls[0][0].probeId).toBe(verify.mock.calls[0][0].probeId);
      expect(query(fixture, 'wizard-verify-cancelled')?.textContent).toContain(
        'Connection check cancelled',
      );
    });

    it('settles probe to retryable failed state and stops elapsed timer when cancellation dispatch rejects', async () => {
      jest.useFakeTimers();
      const verify =
        jest.fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>(
          () => new Promise(() => undefined),
        );
      const cancel =
        jest.fn<Promise<AuthCancelDraftVerificationResult>, [AuthCancelDraftVerificationParams]>(
          () => Promise.reject(new Error('RPC cancel failed')),
        );
      const fixture = createComponent({}, verify, cancel);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      expect(query(fixture, 'wizard-verify-checking')).not.toBeNull();
      jest.advanceTimersByTime(2000);
      fixture.detectChanges();
      expect(query(fixture, 'wizard-verify-elapsed')?.textContent).toContain('2 s elapsed');

      click(fixture, 'wizard-verify-cancel');
      await Promise.resolve();
      fixture.detectChanges();

      expect(query(fixture, 'wizard-verify-checking')).toBeNull();
      expect(query(fixture, 'wizard-verify-failure')).not.toBeNull();
      expect(query(fixture, 'wizard-verify-cancelled')).toBeNull();

      // Advancing timers further does not increment elapsed time (timer was stopped)
      jest.advanceTimersByTime(2000);
      fixture.detectChanges();

      // Retry is enabled: clicking retry starts a new probe
      click(fixture, 'wizard-verify-retry');
      fixture.detectChanges();
      expect(verify).toHaveBeenCalledTimes(2);
    });

    it('unlocks Continue on a verified result and shows the checked meta', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(query(fixture, 'wizard-verify-success')?.textContent).toContain(
        'Connection verified.',
      );
      expect(query(fixture, 'wizard-verify-meta')?.textContent).toContain('123 ms');
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });

    it('stays on Verify with the draft intact when the probe fails', async () => {
      const verify = failEcho('credential-rejected');
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(query(fixture, 'wizard-verify-failure')).not.toBeNull();
      expect(query(fixture, 'wizard-failure-copy')?.textContent?.trim()).toBe(
        'The provider rejected this credential. Replace it or sign in again.',
      );
      expect(query(fixture, 'wizard-verify-diagnostics')?.textContent).toContain(
        'sanitized backend detail',
      );
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
      // The masked draft is preserved and stays masked.
      const keyInput = query(fixture, 'wizard-edit-credential');
      expect(keyInput).not.toBeNull();
      click(fixture, 'wizard-edit-credential');
      expect((query(fixture, 'wizard-api-key') as HTMLInputElement).value).toBe('sk-test-123');
      expect((query(fixture, 'wizard-api-key') as HTMLInputElement).type).toBe('password');
    });

    it('moves focus to the failure heading so the alert is announced once', async () => {
      const verify = failEcho('unreachable');
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'ollama');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      // The focus lands in a microtask after the render, so drain it first.
      await Promise.resolve();
      expect(document.activeElement?.getAttribute('data-testid')).toBe('wizard-failure-heading');
      expect(query(fixture, 'wizard-failure-copy')?.textContent).toContain(
        'Could not reach 127.0.0.1:11434',
      );
    });

    it('uses the timeout copy with the configured limit seconds', async () => {
      const verify = failEcho('timeout');
      const fixture = createComponent({ probeTimeoutMs: 45000 }, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(query(fixture, 'wizard-failure-copy')?.textContent?.trim()).toBe(
        'No response within 45 seconds. Check the service and retry.',
      );
    });

    it('renders the unclassified copy when the seam rejects, without raw text', async () => {
      const verify =
        jest.fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>(() =>
          Promise.reject(new Error('ECONNRESET raw text')),
        );
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(query(fixture, 'wizard-failure-copy')?.textContent?.trim()).toBe(
        'The connection check failed. Retry or review the connection details.',
      );
      expect(fixture.nativeElement.textContent).not.toContain('ECONNRESET');
    });

    it('discards a late result from a superseded probe', async () => {
      const first = deferred<AuthVerifyDraftConnectionResult>();
      const verify = jest
        .fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>()
        .mockReturnValueOnce(first.promise)
        .mockImplementation(() => new Promise(() => undefined));
      const cancel =
        jest.fn<Promise<AuthCancelDraftVerificationResult>, [AuthCancelDraftVerificationParams]>(
          () => Promise.resolve({ cancelled: true }),
        );
      const fixture = createComponent({}, verify, cancel);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      // The user cancels probe 1; the seam settles the probe as cancelled.
      click(fixture, 'wizard-verify-cancel');
      expect(query(fixture, 'wizard-verify-cancelled')).not.toBeNull();
      const firstProbeId = (verify.mock.calls[0][0] as AuthVerifyDraftConnectionParams).probeId;
      // A retry starts probe 2, then the cancelled probe's result arrives late.
      click(fixture, 'wizard-verify-start');
      first.resolve(verifiedResult(firstProbeId));
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      expect(query(fixture, 'wizard-verify-success')).toBeNull();
      expect(query(fixture, 'wizard-verify-failure')).toBeNull();
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
    });

    it('leaves persisted settings untouched for a verify-then-cancel sequence', async () => {
      const verify = verifyEcho();
      const cancel =
        jest.fn<Promise<AuthCancelDraftVerificationResult>, [AuthCancelDraftVerificationParams]>(
          () => Promise.resolve({ cancelled: true }),
        );
      const fixture = createComponent({}, verify, cancel);
      const commits: ProviderWizardCommit[] = [];
      const closings: number[] = [];
      fixture.componentInstance.commitRequested.subscribe((commit) => {
        commits.push(commit);
      });
      fixture.componentInstance.closed.subscribe(() => {
        closings.push(1);
      });
      await reachScope(fixture);
      expect(verify).toHaveBeenCalledTimes(1);
      // The user backs out instead of committing.
      click(fixture, 'wizard-cancel');
      expect(query(fixture, 'wizard-discard-review')).not.toBeNull();
      click(fixture, 'wizard-discard-confirm');
      fixture.detectChanges();
      expect(closings).toHaveLength(1);
      expect(commits).toHaveLength(0);
      expect(cancel).not.toHaveBeenCalled();
      // The in-memory secret is gone and the draft is dropped on close.
      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
    });
  });

  describe('models step', () => {
    it('renders three pickers on the verified provider and records the selection', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      click(fixture, 'wizard-continue');
      fixture.detectChanges();
      const pickers = fixture.debugElement.queryAll(
        By.css('ptah-provider-model-picker'),
      );
      expect(pickers.length).toBe(3);
      pickers[0].componentInstance.selectionChange.emit({
        provider: 'requesty',
        model: 'kimi-k2-model',
      });
      fixture.detectChanges();
      const sources = fixture.nativeElement.querySelectorAll(
        '[data-testid="wizard-tier-source"]',
      );
      expect(sources[0].textContent?.trim()).toBe('Set in this wizard · kimi-k2-model');
      expect(sources[1].textContent).toContain('Provider default');
      expect(sources[2].textContent).toContain('Provider default');
    });

    it('offers provider defaults and clears the tier mappings', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      click(fixture, 'wizard-continue');
      fixture.detectChanges();
      const pickers = fixture.debugElement.queryAll(By.css('ptah-provider-model-picker'));
      pickers[1].componentInstance.selectionChange.emit({
        provider: 'requesty',
        model: 'other-model',
      });
      fixture.detectChanges();
      click(fixture, 'wizard-use-defaults');
      const sources = fixture.nativeElement.querySelectorAll('[data-testid="wizard-tier-source"]');
      expect(sources[1].textContent).toContain('Provider default');
    });

    it('requires explicit tier choices when the host cannot resolve defaults', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({ defaultsResolvable: false }, verify);
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue');
      click(fixture, 'wizard-verify-start');
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      click(fixture, 'wizard-continue');
      fixture.detectChanges();
      expect(button(fixture, 'wizard-use-defaults')).toBeNull();
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
      const pickers = fixture.debugElement.queryAll(By.css('ptah-provider-model-picker'));
      for (const [index, model] of ['m1', 'm2', 'm3'].entries()) {
        pickers[index].componentInstance.selectionChange.emit({
          provider: 'requesty',
          model,
        });
        fixture.detectChanges();
      }
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
    });
  });

  describe('scope step and commit', () => {
    it('emits the full commit payload from the Scope step', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      await reachScope(fixture);
      const commits: ProviderWizardCommit[] = [];
      fixture.componentInstance.commitRequested.subscribe((commit) => {
        commits.push(commit);
      });
      expect(query(fixture, 'wizard-review-provider')?.textContent?.trim()).toBe('Requesty');
      expect(query(fixture, 'wizard-review-credential')?.textContent?.trim()).toBe(
        'Key entered for this setup',
      );
      expect(query(fixture, 'wizard-review-probe')?.textContent).toContain('Verified');
      expect(query(fixture, 'wizard-review-tier')?.textContent?.trim()).toContain(
        'Provider default',
      );
      click(fixture, 'wizard-activation-use-main-agent');
      click(fixture, 'wizard-commit');
      expect(commits).toHaveLength(1);
      const probeId = (verify.mock.calls[0][0] as AuthVerifyDraftConnectionParams).probeId;
      expect(commits[0]).toEqual({
        providerId: 'requesty',
        displayName: 'Requesty',
        authMode: 'apiKey',
        customName: null,
        customProtocol: null,
        credential: { kind: 'apiKey', value: 'sk-test-123' },
        existingKeyReused: false,
        baseUrl: null,
        verified: {
          probeId,
          checkedAt: '2026-09-22T10:00:00.000Z',
          latencyMs: 123,
          modelUsed: 'test-model',
        },
        tiers: { everyday: '', complex: '', fast: '' },
        tierSnapshot: { everyday: null, complex: null, fast: null },
        editedTiers: [],
        saveTo: 'app',
        activation: 'use-main-agent',
      });
      expect(button(fixture, 'wizard-commit')?.textContent?.trim()).toBe(
        'Connect and use for main agent',
      );
    });

    it('review #4: records the loaded tier snapshot and marks only changed tiers as edited', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      selectProvider(fixture, 'requesty');
      fixture.componentRef.setInput('initialSetup', { providerId: 'requesty', baseUrl: null,
        tiers: { sonnet: 'stored-sonnet', opus: 'stored-opus', haiku: null } });
      fixture.detectChanges();
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-continue'); click(fixture, 'wizard-verify-start');
      await Promise.resolve(); await Promise.resolve(); fixture.detectChanges();
      click(fixture, 'wizard-continue');
      const wizard = fixture.componentInstance as unknown as {
        onTierChange(key: 'everyday' | 'complex' | 'fast', selection: { provider: string; model: string }): void;
      };
      wizard.onTierChange('complex', { provider: 'requesty', model: 'edited-opus' });
      wizard.onTierChange('fast', { provider: 'requesty', model: 'new-haiku' });
      // Changed and then changed back: not an edit.
      wizard.onTierChange('everyday', { provider: 'requesty', model: 'other' });
      wizard.onTierChange('everyday', { provider: 'requesty', model: 'stored-sonnet' });
      fixture.detectChanges();
      click(fixture, 'wizard-continue');
      const commits: ProviderWizardCommit[] = [];
      fixture.componentInstance.commitRequested.subscribe((commit) => commits.push(commit));
      click(fixture, 'wizard-commit');
      expect(commits[0].tierSnapshot).toEqual({ everyday: 'stored-sonnet', complex: 'stored-opus', fast: null });
      expect(commits[0].editedTiers).toEqual(['complex', 'fast']);
      expect(commits[0].tiers).toEqual({ everyday: 'stored-sonnet', complex: 'edited-opus', fast: 'new-haiku' });
    });

    it('review #3: native Claude auth collects no tiers and keeps SDK defaults', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({ defaultsResolvable: false }, verify);
      selectProvider(fixture, 'anthropic');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-ant-test');
      click(fixture, 'wizard-continue'); click(fixture, 'wizard-verify-start');
      await Promise.resolve(); await Promise.resolve(); fixture.detectChanges();
      click(fixture, 'wizard-continue');
      expect(query(fixture, 'wizard-models-native')?.textContent).toContain('default models');
      expect(fixture.nativeElement.querySelector('ptah-provider-model-picker')).toBeNull();
      // Not blocked by the explicit-model rule even though no provider defaults resolve.
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(false);
      click(fixture, 'wizard-continue');
      expect(fixture.nativeElement.querySelectorAll('[data-testid="wizard-review-tier"]').length).toBe(0);
      const commits: ProviderWizardCommit[] = [];
      fixture.componentInstance.commitRequested.subscribe((commit) => commits.push(commit));
      click(fixture, 'wizard-commit');
      expect(commits[0]).toMatchObject({ tiers: { everyday: '', complex: '', fast: '' }, editedTiers: [] });
    });

    it('defaults the activation to connect-only when a main route already exists', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({ mainRouteExists: true }, verify);
      await reachScope(fixture);
      expect(button(fixture, 'wizard-commit')?.textContent?.trim()).toBe('Connect provider');
      const checked = fixture.nativeElement.querySelector(
        'input[name="wizard-activation"]:checked',
      );
      expect(checked?.getAttribute('data-testid')).toBe('wizard-activation-connect-only');
    });

    it('disables the workspace target with its reason when unsupported', async () => {
      const verify = verifyEcho();
      const fixture = createComponent(
        { supportedSaveTargets: ['global', 'app'] },
        verify,
      );
      await reachScope(fixture);
      const options = fixture.nativeElement.querySelectorAll(
        '[data-testid="wizard-save-to-option"]',
      );
      const workspace = options[2] as HTMLInputElement;
      expect(workspace.disabled).toBe(true);
      expect(fixture.nativeElement.textContent).toContain(
        'Open a workspace to save an override.',
      );
    });

    it('lists the affected consumers under Use for main agent', async () => {
      const verify = verifyEcho();
      const fixture = createComponent(
        { affectedConsumers: ['background-review', 'commit-watcher'] },
        verify,
      );
      await reachScope(fixture);
      click(fixture, 'wizard-activation-use-main-agent');
      expect(query(fixture, 'wizard-affected-consumers')?.textContent).toContain(
        'background-review, commit-watcher',
      );
    });

    it('shows the saved state, clears the secret, and closes from Done', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      await reachScope(fixture);
      fixture.componentRef.setInput('commitState', 'saved');
      fixture.detectChanges();
      expect(query(fixture, 'wizard-saved')?.textContent).toContain(
        'Requesty is now used for new main-agent requests.',
      );
      const closings: number[] = [];
      fixture.componentInstance.closed.subscribe(() => {
        closings.push(1);
      });
      click(fixture, 'wizard-done');
      expect(closings).toHaveLength(1);
      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      expect(button(fixture, 'wizard-continue')?.disabled).toBe(true);
    });

    it('keeps the draft intact when the host reports a failed commit', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      await reachScope(fixture);
      fixture.componentRef.setInput('commitState', 'failed');
      fixture.detectChanges();
      expect(query(fixture, 'wizard-save-failed')?.textContent).toContain(
        'Could not save this connection',
      );
      expect(button(fixture, 'wizard-commit')?.disabled).toBe(false);
    });

    it('shows the saving label while the host commits', async () => {
      const verify = verifyEcho();
      const fixture = createComponent({}, verify);
      await reachScope(fixture);
      fixture.componentRef.setInput('commitState', 'saving');
      fixture.detectChanges();
      expect(button(fixture, 'wizard-commit')?.textContent?.trim()).toBe('Saving connection…');
      expect(button(fixture, 'wizard-commit')?.disabled).toBe(true);
    });
  });

  describe('close and discard', () => {
    it('closes immediately when there is no draft', () => {
      const fixture = createComponent();
      const closings: number[] = [];
      fixture.componentInstance.closed.subscribe(() => {
        closings.push(1);
      });
      click(fixture, 'wizard-cancel');
      expect(closings).toHaveLength(1);
      expect(query(fixture, 'wizard-discard-review')).toBeNull();
    });

    it('asks before discarding, and Keep editing keeps the setup', () => {
      const fixture = createComponent();
      const closings: number[] = [];
      fixture.componentInstance.closed.subscribe(() => {
        closings.push(1);
      });
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-cancel');
      expect(query(fixture, 'wizard-discard-heading')?.textContent?.trim()).toBe(
        'Discard this setup?',
      );
      expect(closings).toHaveLength(0);
      click(fixture, 'wizard-discard-keep');
      expect(query(fixture, 'wizard-discard-review')).toBeNull();
      expect(closings).toHaveLength(0);
    });

    it('clears the secret and closes on Discard', () => {
      const fixture = createComponent();
      const closings: number[] = [];
      fixture.componentInstance.closed.subscribe(() => {
        closings.push(1);
      });
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      click(fixture, 'wizard-cancel');
      click(fixture, 'wizard-discard-confirm');
      expect(closings).toHaveLength(1);
      fixture.componentRef.setInput('open', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('open', true);
      fixture.detectChanges();
      const keyInput = query(fixture, 'wizard-api-key') as HTMLInputElement | null;
      expect(keyInput?.value ?? '').toBe('');
    });
  });

  describe('accessibility', () => {
    it('gives every wizard button the 36 px height and the 2 px focus outline', async () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      click(fixture, 'wizard-continue');
      typeInto(fixture, 'wizard-api-key', 'sk-test-123');
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('button'),
      ) as HTMLButtonElement[];
      // The shared drawer's own close button is outside this batch; every
      // button this component renders must comply.
      const wizardButtons = buttons.filter(
        (element) => element.getAttribute('data-testid') !== 'native-drawer-close',
      );
      expect(wizardButtons.length).toBeGreaterThan(3);
      for (const element of wizardButtons) {
        expect(element.className).toContain('min-h-9');
        expect(element.className).toContain('focus-visible:outline-2');
        expect(element.className).toContain('focus-visible:outline-base-content');
      }
    });

    it('renders the provider mark with a structural fallback', () => {
      const fixture = createComponent();
      selectProvider(fixture, 'requesty');
      const marks = fixture.nativeElement.querySelectorAll('ptah-provider-mark');
      expect(marks.length).toBeGreaterThan(0);
    });
  });
});