import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  CLAUDE_CODE_NPM_INSTALL_COMMAND,
  CLAUDE_CODE_SIGN_IN_COMMAND,
  type ProvidersConnection,
} from '@ptah-extension/core';
import type { AuthVerifyDraftConnectionParams, AuthVerifyDraftConnectionResult } from '@ptah-extension/shared';
import {
  CredentialsTabComponent, replaceKeyDraft, type CredentialsCommit, type ReplaceKeyRequest,
} from './credentials-tab.component';
import type { ConnectionKind } from './connection-kind';
import { isDisabledControl } from '../../feedback/busy-disabled.testing';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';

const connection = (overrides: Partial<ProvidersConnection> = {}): ProvidersConnection => ({
  id: 'requesty', name: 'Requesty', authMode: 'apiKey', hasKey: true, configured: true, custom: false,
  defaultsResolvable: true, accountLabel: null, tokenStale: false, ...overrides,
});
const result = (probeId: string, overrides: Partial<AuthVerifyDraftConnectionResult> = {}): AuthVerifyDraftConnectionResult => ({
  probeId, outcome: 'verified', reason: null, detail: null, latencyMs: 92, modelUsed: 'k3',
  checkedAt: '2026-09-30T10:00:00Z', ...overrides,
});
const SETUP = { baseUrl: 'https://gateway.example/v1', tiers: { sonnet: 'k3', opus: null, haiku: 'kimi-for-coding' } };

/** Resolves each check only when the test says so, so in-flight states are observable. */
class ProbeHost {
  readonly calls: AuthVerifyDraftConnectionParams[] = [];
  private pending: ((value: AuthVerifyDraftConnectionResult) => void)[] = [];
  readonly verify = jest.fn((params: AuthVerifyDraftConnectionParams) => {
    this.calls.push(params);
    return new Promise<AuthVerifyDraftConnectionResult>((resolve) => this.pending.push(resolve));
  });
  readonly cancel = jest.fn(async () => ({ cancelled: true }));
  settle(overrides: Partial<AuthVerifyDraftConnectionResult> = {}) {
    const params = this.calls[this.calls.length - 1];
    this.pending.shift()?.(result(params.probeId, overrides));
  }
}

describe('replaceKeyDraft', () => {
  const request: ReplaceKeyRequest = { key: 'sk-new', probeId: 'drawer-probe-1' };

  it('writes the credential only, connect-only, keeping the stored tiers unedited', () => {
    const draft = replaceKeyDraft(connection(), request, SETUP);
    expect(draft).toMatchObject({
      providerId: 'requesty', authMode: 'apiKey', credential: { kind: 'apiKey', value: 'sk-new' }, baseUrl: null,
      verified: { probeId: 'drawer-probe-1' }, editedTiers: [], saveTo: 'global', activation: 'connect-only',
      tiers: { everyday: 'k3', complex: '', fast: 'kimi-for-coding' },
      tierSnapshot: { everyday: 'k3', complex: null, fast: 'kimi-for-coding' },
    });
  });

  it('a custom entry is written as a key only, so its metadata is not rewritten', () => {
    const draft = replaceKeyDraft(connection({ id: 'sovereigneg', custom: true }), request, SETUP);
    expect(draft.authMode).toBe('apiKey');
    expect(draft.customName).toBeNull();
    expect(draft.baseUrl).toBeNull();
  });

  it('the Claude API key is stored through activation (plan :649-652)', () => {
    expect(replaceKeyDraft(connection({ id: 'anthropic', name: 'Claude API' }), request, null).activation).toBe('use-main-agent');
  });
});

describe('CredentialsTabComponent', () => {
  let fixture: ComponentFixture<CredentialsTabComponent>;
  let element: HTMLElement;
  let probe: ProbeHost;
  /** The page toast (`SettingsSaveFeedbackService.announce`): every outcome this tab says lands here. */
  let announce: jest.Mock<void, [string, 'status' | 'alert']>;
  const announced = () => announce.mock.calls.map(([message, tone]) => `${tone}: ${message}`);

  beforeEach(() => {
    probe = new ProbeHost();
    announce = jest.fn();
    rendered = false;
    TestBed.configureTestingModule({
      imports: [CredentialsTabComponent],
      providers: [{ provide: SettingsSaveFeedbackService, useValue: { announce } }],
    });
    fixture = TestBed.createComponent(CredentialsTabComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('verifyDraftConnection', probe.verify);
    fixture.componentRef.setInput('cancelDraftVerification', probe.cancel);
  });
  afterEach(() => TestBed.resetTestingModule());

  const query = <T extends HTMLElement = HTMLElement>(id: string) => element.querySelector<T>(`[data-testid="${id}"]`);
  let rendered = false;
  /** The first render defaults to Requesty (api-key); later renders change only what they name. */
  function render(inputs: { connection?: ProvidersConnection; kind?: ConnectionKind } & Record<string, unknown> = {}) {
    const { connection: value, kind, ...rest } = inputs;
    if (value || !rendered) fixture.componentRef.setInput('connection', value ?? connection());
    if (kind || !rendered) fixture.componentRef.setInput('kind', kind ?? 'api-key');
    rendered = true;
    for (const [name, input] of Object.entries(rest)) fixture.componentRef.setInput(name, input);
    fixture.detectChanges();
  }
  function typeKey(value: string) {
    const input = query<HTMLInputElement>('credentials-new-key');
    if (!input) throw new Error('No key input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  async function flush() { await fixture.whenStable(); fixture.detectChanges(); }

  it('without a host hint, shows a fixed mask for a stored key, never any part of it', () => {
    render();
    expect(query('credentials-key-mask')?.textContent?.trim()).toBe('••••••••••••••••');
    render({ connection: connection({ hasKey: false }) });
    expect(query('credentials-key-mask')?.textContent?.trim()).toBe('No key stored');
    expect(query('credentials-delete')).toBeNull();
  });

  describe('unreadable stored key (final review M-6)', () => {
    const unreadable = () => connection({ hasKey: false, keyUnreadable: true });

    it('shows "Could not read the stored key." with Retry and Replace, never "No key stored", "Not set" or "Add key"', () => {
      render({ connection: unreadable() });
      const text = query('credentials-key-unreadable');
      expect(text?.textContent?.trim()).toBe('Could not read the stored key.');
      expect(text?.className).toContain('text-base-content');
      expect(text?.querySelector('lucide-angular')?.getAttribute('class')).toContain('text-warning');
      const retry = query<HTMLButtonElement>('credentials-key-unreadable-retry');
      expect(retry?.textContent?.trim()).toBe('Retry');
      expect(retry?.className).toContain('focus-visible:outline-base-content');
      expect(query('credentials-key-mask')).toBeNull();
      // The user may overwrite an unreadable key.
      expect(query('credentials-replace')?.textContent?.trim()).toBe('Replace');
      const all = element.textContent ?? '';
      for (const wording of ['No key stored', 'Not set', 'Add API key', 'Add key']) expect(all).not.toContain(wording);
    });

    it('Retry emits keyRetryRequested', () => {
      render({ connection: unreadable() });
      const retried = jest.fn();
      fixture.componentInstance.keyRetryRequested.subscribe(retried);
      query<HTMLButtonElement>('credentials-key-unreadable-retry')?.click();
      expect(retried).toHaveBeenCalledTimes(1);
    });

    it('an unreadable key can be deleted: Delete key shows and opens the confirm (re-check N-4)', () => {
      render({ connection: unreadable() });
      query<HTMLButtonElement>('credentials-delete')?.click(); fixture.detectChanges();
      expect(query('credentials-delete-confirm')).not.toBeNull();
    });

    it('a local connection with an unreadable optional key says so, with Retry (re-check N-2)', () => {
      render({ connection: connection({ id: 'ollama', name: 'Ollama', authMode: 'local-native', hasKey: false, keyUnreadable: true }), kind: 'local' });
      expect(query('credentials-local-key-unreadable')?.textContent).toContain('Could not read the stored key.');
      const retried = jest.fn();
      fixture.componentInstance.keyRetryRequested.subscribe(retried);
      query<HTMLButtonElement>('credentials-local-key-unreadable-retry')?.click();
      expect(retried).toHaveBeenCalledTimes(1);
      // A readable local connection shows no unreadable state.
      render({ connection: connection({ id: 'ollama', name: 'Ollama', authMode: 'local-native', hasKey: false }) });
      expect(query('credentials-local-key-unreadable')).toBeNull();
    });
  });

  it('shows the host\'s masked hint for a stored key, not selectable and with no copy action (Batch 28d)', () => {
    render({ connection: connection({ keyHint: '•••• 8f21' }) });
    const mask = query('credentials-key-mask');
    expect(mask?.textContent?.trim()).toBe('•••• 8f21');
    expect(mask?.className).toContain('select-none');
    expect(mask?.className).toContain('text-base-content');
    expect(mask?.parentElement?.querySelector('[aria-label^="Copy"], [data-testid^="credentials-copy"]')).toBeNull();
    // A hint left over without a stored key is never shown.
    render({ connection: connection({ hasKey: false, keyHint: '•••• 8f21' }) });
    expect(query('credentials-key-mask')?.textContent?.trim()).toBe('No key stored');
  });

  it('show/hide toggles the new key field between password and text (#49)', () => {
    render();
    query('credentials-replace')?.click(); fixture.detectChanges();
    const input = query<HTMLInputElement>('credentials-new-key');
    expect(input?.type).toBe('password');
    const toggle = query('credentials-toggle-visibility');
    expect(toggle?.getAttribute('aria-label')).toBe('Show API key');
    toggle?.click(); fixture.detectChanges();
    expect(query<HTMLInputElement>('credentials-new-key')?.type).toBe('text');
    expect(query('credentials-toggle-visibility')?.getAttribute('aria-pressed')).toBe('true');
  });

  describe('Replace: verify, then save', () => {
    beforeEach(() => {
      render({ setup: SETUP });
      query('credentials-replace')?.click(); fixture.detectChanges();
    });

    it('Save stays disabled until the typed key passed a check; a verified key saves once', async () => {
      const replace = jest.fn();
      fixture.componentInstance.replaceKeyRequested.subscribe(replace);
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
      typeKey('  sk-new  ');
      query('credentials-verify')?.click(); fixture.detectChanges();
      expect(probe.calls[0]).toMatchObject({ providerId: 'requesty', authMode: 'apiKey', credential: { kind: 'apiKey', value: 'sk-new' } });
      expect(query('credentials-probe')?.textContent).toContain('Checking');
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
      probe.settle(); await flush();
      // The result is the page toast and stays inline too: it is what enables Save.
      expect(announced()).toEqual(['status: Key verified (92ms). Save it to replace the stored key.']);
      expect(query('credentials-probe')?.textContent?.trim()).toBe('Key verified (92ms). Save it to replace the stored key.');
      query('credentials-save')?.click();
      expect(replace).toHaveBeenCalledWith({ key: 'sk-new', probeId: probe.calls[0].probeId });
    });

    it('a failed check leaves Save disabled, shows the reason and latency, and asks for nothing to be saved', async () => {
      const replace = jest.fn();
      fixture.componentInstance.replaceKeyRequested.subscribe(replace);
      typeKey('sk-bad');
      query('credentials-verify')?.click(); fixture.detectChanges();
      probe.settle({ outcome: 'failed', reason: 'credential-rejected', latencyMs: 80, detail: 'host detail must not show' });
      await flush();
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce.mock.calls[0][1]).toBe('alert');
      const text = announce.mock.calls[0][0];
      expect(text).toContain('Check failed (80ms)');
      expect(text).toContain('The provider rejected this key.');
      expect(text).toContain('Nothing was saved.');
      expect(text).not.toContain('host detail');
      expect(query('credentials-probe')?.textContent?.trim()).toBe(text);
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
      query('credentials-save')?.click();
      expect(replace).not.toHaveBeenCalled();
    });

    it('editing the key after a pass needs a new check', async () => {
      typeKey('sk-new');
      query('credentials-verify')?.click(); fixture.detectChanges();
      probe.settle(); await flush();
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(false);
      typeKey('sk-newer');
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
    });

    it('a rejected check call is shown as a failed check, never as verified', async () => {
      typeKey('sk-new');
      probe.verify.mockImplementationOnce(async () => { throw new Error('rpc down'); });
      query('credentials-verify')?.click(); await flush();
      expect(announced()[0]).toContain('alert: Check failed');
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
    });

    it('Cancel and destroy drop the typed key and cancel a running check', () => {
      typeKey('sk-secret');
      query('credentials-verify')?.click(); fixture.detectChanges();
      query('credentials-cancel-replace')?.click(); fixture.detectChanges();
      expect(probe.cancel).toHaveBeenCalledWith({ probeId: probe.calls[0].probeId });
      expect(query('credentials-new-key')).toBeNull();
      query('credentials-replace')?.click(); fixture.detectChanges();
      expect(query<HTMLInputElement>('credentials-new-key')?.value).toBe('');

      typeKey('sk-secret-2');
      const component = fixture.componentInstance as unknown as { keyDraft(): string };
      fixture.destroy();
      expect(component.keyDraft()).toBe('');
    });

    it('a saved Replace closes the form and drops the key; a failure keeps it and says Not saved (D15)', async () => {
      typeKey('sk-new');
      query('credentials-verify')?.click(); fixture.detectChanges();
      probe.settle(); await flush();
      query('credentials-save')?.click();
      announce.mockClear();
      render({ commit: { status: 'saving', message: null } satisfies CredentialsCommit });
      // No inline "Saving…": Save is disabled meanwhile and the toast says the result.
      expect(query('credentials-commit')).toBeNull();
      expect(announce).not.toHaveBeenCalled();
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
      render({ commit: { status: 'failed', message: 'Connection credential could not be saved.' } });
      expect(announced()).toEqual(['alert: Not saved. Connection credential could not be saved.']);
      expect(query('credentials-new-key')).not.toBeNull();
      render({ commit: { status: 'unconfirmed', message: null } });
      expect(announced()[1]).toBe('alert: Save not confirmed.');
      render({ commit: { status: 'saved', message: null } });
      expect(announced()[2]).toBe('status: Key replaced.');
      expect(announce).toHaveBeenCalledTimes(3);
      expect(query('credentials-new-key')).toBeNull();
    });
  });

  it('a custom endpoint checks the key against its stored endpoint, and cannot Replace without one', () => {
    const custom = connection({ id: 'sovereigneg', name: 'sovereigneg', custom: true });
    render({ connection: custom, kind: 'custom', setup: null });
    expect(query('credentials-replace')).toBeNull();
    render({ setup: SETUP });
    query('credentials-replace')?.click(); fixture.detectChanges();
    typeKey('sk-sov');
    query('credentials-verify')?.click();
    expect(probe.calls[0]).toMatchObject({ providerId: 'sovereigneg', authMode: 'custom', baseUrl: 'https://gateway.example/v1' });
  });

  describe('Claude API (plan :649-652, RUX-4)', () => {
    const claude = connection({ id: 'anthropic', name: 'Claude API' });

    it('offers Replace only while Claude API drives the main agent, and says saving restarts sessions', () => {
      render({ connection: claude, isActiveDriver: false });
      expect(query('credentials-replace')).toBeNull();
      expect(query('credentials-anthropic-guidance')?.textContent).toContain('Connect provider');
      render({ isActiveDriver: true });
      expect(query('credentials-anthropic-guidance')).toBeNull();
      query('credentials-replace')?.click(); fixture.detectChanges();
      expect(query('credentials-replace-form')?.textContent).toContain('restarts running chat sessions');
    });
  });

  describe('Delete key (#7/#8)', () => {
    it('asks inline before deleting, and warns when this connection drives the main agent', () => {
      const deleted = jest.fn();
      fixture.componentInstance.deleteKeyRequested.subscribe(deleted);
      render({ isActiveDriver: true });
      query('credentials-delete')?.click(); fixture.detectChanges();
      expect(deleted).not.toHaveBeenCalled();
      expect(query('credentials-active-driver-warning')?.textContent).toContain('New requests fail until a key is added.');
      query('credentials-delete-confirm-button')?.click(); fixture.detectChanges();
      expect(deleted).toHaveBeenCalledTimes(1);
      expect(query('credentials-delete-confirm')).toBeNull();
      render({ commit: { status: 'saved', message: null } });
      expect(announced()).toEqual(['status: Stored key deleted.']);
    });

    it('no active-driver warning for an inactive connection; Cancel deletes nothing', () => {
      const deleted = jest.fn();
      fixture.componentInstance.deleteKeyRequested.subscribe(deleted);
      render({ isActiveDriver: false });
      query('credentials-delete')?.click(); fixture.detectChanges();
      expect(query('credentials-active-driver-warning')).toBeNull();
      Array.from(query('credentials-delete-confirm')?.querySelectorAll('button') ?? []).find((b) => b.textContent?.trim() === 'Cancel')?.click();
      fixture.detectChanges();
      expect(deleted).not.toHaveBeenCalled();
      expect(query('credentials-delete-confirm')).toBeNull();
    });

    it('is disabled while a save is in flight', () => {
      render({ saving: true });
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-delete'))).toBe(true);
    });
  });

  it('GitHub Copilot shows the account and signs out after an inline confirm (#12)', () => {
    const signOut = jest.fn();
    fixture.componentInstance.signOutRequested.subscribe(signOut);
    render({ connection: connection({ id: 'github-copilot', name: 'GitHub Copilot', authMode: 'oauth', hasKey: false, accountLabel: 'octocat' }), kind: 'oauth' });
    expect(query('credentials-account')?.textContent?.trim()).toBe('octocat');
    query('credentials-sign-out')?.click(); fixture.detectChanges();
    expect(signOut).not.toHaveBeenCalled();
    query('credentials-sign-out-confirm-button')?.click();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('OpenAI Codex shows token-expired copy and Open login (#13)', () => {
    const action = jest.fn();
    fixture.componentInstance.externalActionRequested.subscribe(action);
    render({ connection: connection({ id: 'openai-codex', name: 'OpenAI Codex', authMode: 'oauth', hasKey: false, tokenStale: true }), kind: 'oauth' });
    expect(query('credentials-codex-copy')?.textContent).toContain('~/.codex/auth.json has expired');
    query('credentials-open-login')?.click();
    expect(action).toHaveBeenCalledWith('sign-in');
    render({ connection: connection({ id: 'openai-codex', name: 'OpenAI Codex', authMode: 'oauth', hasKey: false, tokenStale: false }) });
    expect(query('credentials-codex-copy')?.textContent).toContain('uses the Codex login');
  });

  it('Claude CLI shows the sign-in and install commands with Copy, and Check again (#10)', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const action = jest.fn();
    fixture.componentInstance.externalActionRequested.subscribe(action);
    render({ connection: connection({ id: 'claude-cli', name: 'Claude (Subscription)', authMode: 'cli', hasKey: false }), kind: 'claude-cli' });
    expect(CLAUDE_CODE_SIGN_IN_COMMAND).toBe('claude');
    expect(query('credentials-cli')?.textContent).toContain(`Run ${CLAUDE_CODE_SIGN_IN_COMMAND} in your terminal and follow the browser prompts`);
    expect(query('credentials-cli')?.textContent).not.toContain('claude login');
    expect(query('credentials-cli')?.textContent).toContain(CLAUDE_CODE_NPM_INSTALL_COMMAND);
    expect(query('credentials-copy-login')?.getAttribute('aria-label')).toBe('Copy sign-in command');
    expect(query('credentials-copy-install')?.getAttribute('aria-label')).toBe('Copy install command');
    query('credentials-copy-login')?.click(); await flush();
    expect(writeText).toHaveBeenCalledWith(CLAUDE_CODE_SIGN_IN_COMMAND);
    expect(announced()).toEqual([`status: Copied "${CLAUDE_CODE_SIGN_IN_COMMAND}".`]);
    query('credentials-copy-install')?.click(); await flush();
    expect(writeText).toHaveBeenCalledWith(CLAUDE_CODE_NPM_INSTALL_COMMAND);
    query('credentials-cli-check')?.click();
    expect(action).toHaveBeenCalledWith('cli-check');
  });

  it('Ollama Cloud explains its optional key and links to the provider (#15, #9)', () => {
    render({ connection: connection({ id: 'ollama-cloud', name: 'Ollama Cloud' }) });
    expect(query('credentials-optional-key')?.textContent).toContain('optional');
    expect(query('credentials-get-key')?.getAttribute('href')).toMatch(/^https:\/\//);
    expect(query('credentials-get-key')?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  describe('external sign-in feedback (Batch 21 review M1)', () => {
    const codex = connection({ id: 'openai-codex', name: 'OpenAI Codex', authMode: 'oauth', hasKey: false });

    it('while the sign-in runs, Open login is disabled and says it is waiting', () => {
      render({ connection: codex, kind: 'oauth', externalAuth: { status: 'loading', message: null } });
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-open-login'))).toBe(true);
      expect(query('credentials-open-login')?.textContent?.trim()).toBe('Waiting for sign-in…');
      expect(query('credentials-external-busy')?.getAttribute('role')).toBe('status');
    });

    it('a failed sign-in shows a fixed alert instead of a stale message, and Open login is available again', () => {
      render({ connection: codex, kind: 'oauth', externalAuth: { status: 'error', message: 'Sign-in detected. Verify the connection before using it.' } });
      expect(query('credentials-external-error')?.getAttribute('role')).toBe('alert');
      expect(query('credentials-external-error')?.textContent).toContain('Sign-in could not be checked. Retry.');
      expect(query('credentials-external-message')).toBeNull();
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-open-login'))).toBe(false);
    });

    it('Check again (Claude CLI) waits too, and the settled message shows', () => {
      const cli = connection({ id: 'claude-cli', name: 'Claude (Subscription)', authMode: 'cli', hasKey: false });
      render({ connection: cli, kind: 'claude-cli', externalAuth: { status: 'loading', message: null } });
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-cli-check'))).toBe(true);
      render({ externalAuth: { status: 'idle', message: 'Login has not been confirmed. Complete external login, then check again.' } });
      expect(query('credentials-external-message')?.textContent).toContain('Login has not been confirmed');
      expect(query('credentials-cli-detected')?.textContent).toContain('Claude CLI detected on this machine.');
    });
  });

  describe('stored models for the Replace draft (Batch 21 review minor 5)', () => {
    async function verifiedKey() {
      query('credentials-replace')?.click(); fixture.detectChanges();
      typeKey('sk-new');
      query('credentials-verify')?.click(); fixture.detectChanges();
      probe.settle(); await flush();
    }

    it('Save waits for the stored models, and a failed read says why it stays disabled', async () => {
      render({ setup: null, setupError: false });
      await verifiedKey();
      expect(query('credentials-setup-missing')?.textContent).toContain('Loading the stored models');
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
      render({ setupError: true });
      expect(query('credentials-setup-missing')?.textContent).toContain('Could not read the stored models');
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(true);
      render({ setup: SETUP, setupError: false });
      expect(query('credentials-setup-missing')).toBeNull();
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(false);
    });

    it('the Claude API key writes no tiers, so it does not wait for them', async () => {
      render({ connection: connection({ id: 'anthropic', name: 'Claude API' }), isActiveDriver: true, setup: null });
      await verifiedKey();
      expect(query('credentials-setup-missing')).toBeNull();
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-save'))).toBe(false);
    });
  });

  it('a local server needs no key', () => {
    render({ connection: connection({ id: 'ollama', name: 'Ollama', authMode: 'local-native', hasKey: false }), kind: 'local' });
    expect(query('credentials-local')?.textContent).toContain('No key needed');
  });

  it('opening another connection drops the typed key and any open confirm', () => {
    render();
    query('credentials-replace')?.click(); fixture.detectChanges();
    typeKey('sk-typed');
    render({ connection: connection({ id: 'openrouter', name: 'OpenRouter' }) });
    expect(query('credentials-new-key')).toBeNull();
    query('credentials-replace')?.click(); fixture.detectChanges();
    expect(query<HTMLInputElement>('credentials-new-key')?.value).toBe('');
  });

  describe('Kimi Code: CLI sign-in first, stored key as fallback', () => {
    const kimi = (overrides: Partial<ProvidersConnection> = {}) => connection({
      id: 'kimi-code', name: 'Kimi Code', authMode: 'oauth', hasKey: false, credentialSource: 'none', ...overrides,
    });
    const status = () => query('credentials-kimi-status')?.textContent?.trim();

    it.each<[string, Partial<ProvidersConnection>, string]>([
      ['cli-login', { credentialSource: 'cli-login', configured: true }, 'Connected via Kimi Code CLI'],
      ['stale', { credentialSource: 'none', tokenStale: true }, 'Kimi Code CLI login expired'],
      ['stale with a key', { credentialSource: 'api-key', tokenStale: true, hasKey: true }, 'Kimi Code CLI login expired · using the stored API key'],
      ['api-key', { credentialSource: 'api-key', hasKey: true }, 'Using the stored API key'],
      ['none', { credentialSource: 'none' }, 'Not signed in'],
    ])('names the credential in use as text, not only a colour (%s)', (_label, overrides, text) => {
      render({ connection: kimi(overrides), kind: 'oauth' });
      expect(status()).toBe(text);
      expect(query('credentials-kimi-status')?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    it('signs in in the app, checks again, and copies kimi login', async () => {
      const writeText = jest.fn(async () => undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      const action = jest.fn();
      fixture.componentInstance.externalActionRequested.subscribe(action);
      render({ connection: kimi(), kind: 'oauth' });
      expect(query('credentials-kimi-copy')?.textContent).toContain('~/.kimi-code');
      query('credentials-kimi-sign-in')?.click();
      expect(action).toHaveBeenLastCalledWith('sign-in');
      query('credentials-kimi-check')?.click();
      expect(action).toHaveBeenLastCalledWith('cli-check');
      const copy = query('credentials-copy-kimi-login');
      expect(copy?.getAttribute('aria-label')).toBe('Copy kimi login');
      copy?.click(); await flush();
      expect(writeText).toHaveBeenCalledWith('kimi login');
      expect(query('credentials-kimi-cancel')).toBeNull();
    });

    it('while the sign-in runs, shows the link and the code and offers Cancel instead of Sign in', () => {
      const action = jest.fn();
      fixture.componentInstance.externalActionRequested.subscribe(action);
      render({ connection: kimi(), kind: 'oauth', kimiLogin: {
        status: 'awaiting-browser', verificationUrl: 'https://auth.example.test/device?code=FAKE-1234', userCode: 'FAKE-1234',
        browserOpened: false,
      } });
      const link = query<HTMLAnchorElement>('kimi-login-url');
      expect(link?.getAttribute('href')).toBe('https://auth.example.test/device?code=FAKE-1234');
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link?.textContent?.trim()).toBe('https://auth.example.test/device?code=FAKE-1234');
      expect(query('kimi-login-code')?.textContent?.trim()).toBe('FAKE-1234');
      expect(query('kimi-login-copy-url')?.getAttribute('aria-label')).toBe('Copy sign-in link');
      expect(query('kimi-login-copy-code')?.getAttribute('aria-label')).toBe('Copy sign-in code');
      expect(query('kimi-login-status')?.textContent).toContain('Open the link below');
      expect(query('credentials-kimi-sign-in')).toBeNull();
      expect(isDisabledControl(query<HTMLButtonElement>('credentials-kimi-check'))).toBe(true);
      query('credentials-kimi-cancel')?.click();
      expect(action).toHaveBeenCalledWith('sign-in-cancel');
    });

    it('a missing CLI shows the fixed failure, the install link and the key option', () => {
      render({ connection: kimi(), kind: 'oauth', kimiLogin: {
        status: 'failed', errorCode: 'not-installed',
      } });
      expect(query('kimi-login-status')?.getAttribute('role')).toBe('alert');
      expect(query('kimi-login-status')?.textContent).toContain('The Kimi Code CLI is not installed on this machine.');
      expect(query('kimi-login-install-link')?.getAttribute('href')).toMatch(/^https:\/\//);
      expect(query('credentials-kimi-sign-in')).not.toBeNull();
      expect(query('credentials-key')).not.toBeNull();
    });

    it('reuses the stored-key block as the optional fallback key, checked as an API key', () => {
      render({ connection: kimi({ hasKey: true, credentialSource: 'api-key' }), kind: 'oauth', setup: SETUP });
      const block = query('credentials-key');
      expect(block?.textContent).toContain('Optional API key');
      expect(query('credentials-fallback-key-copy')?.textContent?.trim()).toBe('Used only when the Kimi Code CLI is not signed in.');
      expect(query('credentials-replace')).not.toBeNull();
      expect(query('credentials-delete')).not.toBeNull();
      query('credentials-replace')?.click(); fixture.detectChanges();
      typeKey('fake-kimi-key');
      query('credentials-verify')?.click(); fixture.detectChanges();
      expect(probe.calls[0]).toMatchObject({ providerId: 'kimi-code', authMode: 'apiKey' });
      expect(replaceKeyDraft(kimi(), { key: 'fake-kimi-key', probeId: 'p' }, SETUP).authMode).toBe('apiKey');
    });

    it('an api-key connection keeps its plain label', () => {
      render();
      expect(query('credentials-key')?.textContent).toContain('Stored API key');
      expect(query('credentials-fallback-key-copy')).toBeNull();
      expect(query('credentials-kimi')).toBeNull();
    });
  });
});
