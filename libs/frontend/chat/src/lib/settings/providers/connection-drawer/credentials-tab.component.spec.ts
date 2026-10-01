import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ProvidersConnection } from '@ptah-extension/core';
import type { AuthVerifyDraftConnectionParams, AuthVerifyDraftConnectionResult } from '@ptah-extension/shared';
import {
  CredentialsTabComponent, replaceKeyDraft, type CredentialsCommit, type ReplaceKeyRequest,
} from './credentials-tab.component';
import type { ConnectionKind } from './connection-kind';

const connection = (overrides: Partial<ProvidersConnection> = {}): ProvidersConnection => ({
  id: 'moonshot', name: 'Moonshot (Kimi)', authMode: 'apiKey', hasKey: true, configured: true, custom: false,
  defaultsResolvable: true, accountLabel: null, tokenStale: false, ...overrides,
});
const result = (probeId: string, overrides: Partial<AuthVerifyDraftConnectionResult> = {}): AuthVerifyDraftConnectionResult => ({
  probeId, outcome: 'verified', reason: null, detail: null, latencyMs: 92, modelUsed: 'kimi-k2.5',
  checkedAt: '2026-09-30T10:00:00Z', ...overrides,
});
const SETUP = { baseUrl: 'https://gateway.example/v1', tiers: { sonnet: 'kimi-k2.5', opus: null, haiku: 'kimi-fast' } };

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
      providerId: 'moonshot', authMode: 'apiKey', credential: { kind: 'apiKey', value: 'sk-new' }, baseUrl: null,
      verified: { probeId: 'drawer-probe-1' }, editedTiers: [], saveTo: 'global', activation: 'connect-only',
      tiers: { everyday: 'kimi-k2.5', complex: '', fast: 'kimi-fast' },
      tierSnapshot: { everyday: 'kimi-k2.5', complex: null, fast: 'kimi-fast' },
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

  beforeEach(() => {
    probe = new ProbeHost();
    rendered = false;
    TestBed.configureTestingModule({ imports: [CredentialsTabComponent] });
    fixture = TestBed.createComponent(CredentialsTabComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('verifyDraftConnection', probe.verify);
    fixture.componentRef.setInput('cancelDraftVerification', probe.cancel);
  });
  afterEach(() => TestBed.resetTestingModule());

  const query = <T extends HTMLElement = HTMLElement>(id: string) => element.querySelector<T>(`[data-testid="${id}"]`);
  let rendered = false;
  /** The first render defaults to Moonshot (api-key); later renders change only what they name. */
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
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
      typeKey('  sk-new  ');
      query('credentials-verify')?.click(); fixture.detectChanges();
      expect(probe.calls[0]).toMatchObject({ providerId: 'moonshot', authMode: 'apiKey', credential: { kind: 'apiKey', value: 'sk-new' } });
      expect(query('credentials-probe')?.textContent).toContain('Checking');
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
      probe.settle(); await flush();
      expect(query('credentials-probe')?.textContent).toContain('Key verified (92ms)');
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
      const text = query('credentials-probe')?.textContent ?? '';
      expect(text).toContain('Check failed (80ms)');
      expect(text).toContain('The provider rejected this key.');
      expect(text).toContain('Nothing was saved.');
      expect(text).not.toContain('host detail');
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
      query('credentials-save')?.click();
      expect(replace).not.toHaveBeenCalled();
    });

    it('editing the key after a pass needs a new check', async () => {
      typeKey('sk-new');
      query('credentials-verify')?.click(); fixture.detectChanges();
      probe.settle(); await flush();
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(false);
      typeKey('sk-newer');
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
    });

    it('a rejected check call is shown as a failed check, never as verified', async () => {
      typeKey('sk-new');
      probe.verify.mockImplementationOnce(async () => { throw new Error('rpc down'); });
      query('credentials-verify')?.click(); await flush();
      expect(query('credentials-probe')?.textContent).toContain('Check failed');
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
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
      render({ commit: { status: 'saving', message: null } satisfies CredentialsCommit });
      expect(query('credentials-commit')?.textContent).toContain('Saving…');
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
      render({ commit: { status: 'failed', message: 'Connection credential could not be saved.' } });
      expect(query('credentials-commit')?.textContent).toContain('Not saved. Connection credential could not be saved.');
      expect(query('credentials-commit')?.textContent).not.toContain('replaced');
      expect(query('credentials-commit')?.getAttribute('role')).toBe('alert');
      expect(query('credentials-new-key')).not.toBeNull();
      render({ commit: { status: 'unconfirmed', message: null } });
      expect(query('credentials-commit')?.textContent).toContain('Save not confirmed');
      render({ commit: { status: 'saved', message: null } });
      expect(query('credentials-commit')?.textContent).toContain('Key replaced.');
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
      expect(query('credentials-commit')?.textContent).toContain('Stored key deleted.');
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
      expect(query<HTMLButtonElement>('credentials-delete')?.disabled).toBe(true);
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

  it('Claude CLI shows the login and install commands with Copy, and Check again (#10)', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const action = jest.fn();
    fixture.componentInstance.externalActionRequested.subscribe(action);
    render({ connection: connection({ id: 'claude-cli', name: 'Claude (Subscription)', authMode: 'cli', hasKey: false }), kind: 'claude-cli' });
    expect(query('credentials-cli')?.textContent).toContain('claude login');
    expect(query('credentials-cli')?.textContent).toContain('npm install -g @anthropic-ai/claude-code');
    query('credentials-copy-login')?.click(); await flush();
    expect(writeText).toHaveBeenCalledWith('claude login');
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
      expect(query<HTMLButtonElement>('credentials-open-login')?.disabled).toBe(true);
      expect(query('credentials-open-login')?.textContent?.trim()).toBe('Waiting for sign-in…');
      expect(query('credentials-external-busy')?.getAttribute('role')).toBe('status');
    });

    it('a failed sign-in shows a fixed alert instead of a stale message, and Open login is available again', () => {
      render({ connection: codex, kind: 'oauth', externalAuth: { status: 'error', message: 'Sign-in detected. Verify the connection before using it.' } });
      expect(query('credentials-external-error')?.getAttribute('role')).toBe('alert');
      expect(query('credentials-external-error')?.textContent).toContain('Sign-in could not be checked. Retry.');
      expect(query('credentials-external-message')).toBeNull();
      expect(query<HTMLButtonElement>('credentials-open-login')?.disabled).toBe(false);
    });

    it('Check again (Claude CLI) waits too, and the settled message shows', () => {
      const cli = connection({ id: 'claude-cli', name: 'Claude (Subscription)', authMode: 'cli', hasKey: false });
      render({ connection: cli, kind: 'claude-cli', externalAuth: { status: 'loading', message: null } });
      expect(query<HTMLButtonElement>('credentials-cli-check')?.disabled).toBe(true);
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
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
      render({ setupError: true });
      expect(query('credentials-setup-missing')?.textContent).toContain('Could not read the stored models');
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(true);
      render({ setup: SETUP, setupError: false });
      expect(query('credentials-setup-missing')).toBeNull();
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(false);
    });

    it('the Claude API key writes no tiers, so it does not wait for them', async () => {
      render({ connection: connection({ id: 'anthropic', name: 'Claude API' }), isActiveDriver: true, setup: null });
      await verifiedKey();
      expect(query('credentials-setup-missing')).toBeNull();
      expect(query<HTMLButtonElement>('credentials-save')?.disabled).toBe(false);
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
});
