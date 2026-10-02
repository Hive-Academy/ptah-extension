import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ProvidersSettingsStateService, type ProvidersConnection, type ProvidersExternalAuth, type ProvidersSettingsCommit,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import { SAVE_REFUSED_MESSAGE, SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { AddCliInstanceModalComponent, type CliInstanceEditTarget } from './add-cli-instance-modal.component';

const ready = <T,>(data: T): ProvidersSettingsSection<T> => ({ status: 'ready', data, error: null });
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const CONTEXT = { scopeKey: 'workspace', activePath: '/ws' };
const KEY = 'sk-e2e-instance-key';

const connection = (id: string, name: string, authMode: ProvidersConnection['authMode']): ProvidersConnection => ({
  id, name, authMode, hasKey: false, configured: true, custom: false, defaultsResolvable: true, accountLabel: null, tokenStale: false,
});
const CONNECTIONS: ProvidersConnection[] = [
  connection('anthropic', 'Claude API', 'apiKey'),
  connection('claude-cli', 'Claude (Subscription)', 'cli'),
  connection('moonshot', 'Moonshot (Kimi)', 'apiKey'),
  connection('ollama-cloud', 'Ollama Cloud', 'local-native'),
  connection('ollama', 'Ollama', 'local-native'),
  connection('github-copilot', 'GitHub Copilot', 'oauth'),
  connection('openai-codex', 'OpenAI Codex', 'oauth'),
];

class StateStub {
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  readonly connections = signal<ProvidersSettingsSection<ProvidersConnection[]>>(ready(CONNECTIONS));
  readonly externalAuth = signal<ProvidersSettingsSection<ProvidersExternalAuth>>({ status: 'unloaded', data: null, error: null });
  readonly contextNow = signal<typeof CONTEXT | null>(CONTEXT);
  readonly reviewContext = jest.fn(() => this.contextNow());
  readonly cliAgents = signal<ProvidersSettingsSection<{ id: string; name: string }[]>>(ready([{ id: 'glm-1', name: 'Glm' }]));
  readonly clearCliTest = jest.fn((_id: string) => undefined);
  outcome: ProvidersSettingsCommit['status'] | 'refused' = 'saved';
  readonly saveSettings = jest.fn(async (_patch: unknown, _context: unknown) => {
    if (this.outcome === 'refused') return false;
    this.commit.set({ ...idle, status: this.outcome });
    return true;
  });
  /** What the host's sign-in leads to. */
  signIn: 'signed-in' | 'idle' | 'error' = 'signed-in';
  readonly performExternalAuth = jest.fn(async (providerId: string, _action: string) => {
    if (this.signIn === 'error') {
      this.externalAuth.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
      return;
    }
    this.externalAuth.set(ready({ providerId, signInState: this.signIn, accountLabel: null, cliInstalled: null,
      message: this.signIn === 'signed-in' ? 'Sign-in detected. Verify the connection before using it.' : 'Login has not been confirmed.' }));
  });
}

@Component({
  standalone: true,
  imports: [AddCliInstanceModalComponent],
  template: `<ptah-add-cli-instance-modal [open]="open()" [editing]="editing()" (created)="created.push($event)"
    (closed)="open.set(false); closed = closed + 1" />`,
})
class Host {
  readonly open = signal(true);
  readonly editing = signal<CliInstanceEditTarget | null>(null);
  closed = 0;
  readonly created: string[] = [];
}

describe('AddCliInstanceModalComponent', () => {
  let fixture: ComponentFixture<Host>;
  let state: StateStub;
  let feedback: SettingsSaveFeedbackService;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) => el().querySelector(`[data-testid="${id}"]`) as T | null;
  const submit = () => q<HTMLButtonElement>('add-cli-instance-submit');
  async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); fixture.detectChanges(); }
  function type(id: string, value: string) {
    const input = q<HTMLInputElement>(id);
    if (!input) throw new Error(`no ${id}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  function choose(providerId: string) {
    const select = q<HTMLSelectElement>('add-cli-instance-provider');
    if (!select) throw new Error('no provider select');
    select.value = providerId;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  });

  function create(editing: CliInstanceEditTarget | null = null) {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.editing.set(editing);
    fixture.detectChanges();
  }

  beforeEach(() => {
    state = new StateStub();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: ProvidersSettingsStateService, useValue: state }, SettingsSaveFeedbackService],
    });
    feedback = TestBed.inject(SettingsSaveFeedbackService);
  });
  afterEach(() => { feedback.dismiss(); TestBed.resetTestingModule(); });

  describe('create', () => {
    beforeEach(() => create());

    it('is the titled "Add Ptah CLI Agent Instance" dialog, open', () => {
      expect(el().querySelector('dialog')?.hasAttribute('open')).toBe(true);
      expect(el().querySelector('dialog')?.getAttribute('aria-labelledby')).toBe('add-cli-instance-title');
      expect(q('add-cli-instance-modal')?.textContent).toContain('Add Ptah CLI Agent Instance');
      expect(submit()?.textContent?.trim()).toBe('Create Instance');
      expect(submit()?.disabled).toBe(true);
    });

    it('keeps its footer toast only while open, so a closed modal leaves no second Undo in the page', () => {
      expect(el().querySelectorAll('ptah-settings-toast').length).toBe(1);
      fixture.componentInstance.open.set(false);
      fixture.detectChanges();
      expect(el().querySelectorAll('ptah-settings-toast').length).toBe(0);
    });

    it('offers every connection except Claude API and OpenAI Codex, with its modality', () => {
      const options = Array.from(q<HTMLSelectElement>('add-cli-instance-provider')?.options ?? []).map((option) => option.textContent?.trim());
      expect(options).toEqual(['Choose a provider connection…', 'Claude (Subscription) · CLI login', 'Moonshot (Kimi) · API key',
        'Ollama Cloud · Local server', 'Ollama · Local server', 'GitHub Copilot · OAuth']);
    });

    it('requires a key for an API-key provider, masked with show/hide (#49)', () => {
      type('add-cli-instance-name', 'Kimi-2');
      choose('moonshot');
      expect(q('add-cli-instance-key-help')?.textContent).toContain('Keys stored for the provider connection are not copied');
      expect(submit()?.disabled).toBe(true);
      type('add-cli-instance-key', KEY);
      expect(q<HTMLInputElement>('add-cli-instance-key')?.type).toBe('password');
      q<HTMLButtonElement>('add-cli-instance-toggle-visibility')?.click();
      fixture.detectChanges();
      expect(q<HTMLInputElement>('add-cli-instance-key')?.type).toBe('text');
      expect(q('add-cli-instance-toggle-visibility')?.getAttribute('aria-pressed')).toBe('true');
      expect(submit()?.disabled).toBe(false);
    });

    it.each([
      ['claude-cli', 'No API key needed — uses your local Claude login / subscription.', false],
      ['ollama', 'No API key needed — make sure Ollama is running locally.', false],
      ['ollama-cloud', 'Optional — run ollama signin to use Ollama Cloud', true],
    ] as const)('gives %s its keyless / optional-key hint (#48)', (providerId, hint, keyField) => {
      type('add-cli-instance-name', 'Local');
      choose(providerId);
      expect(q('add-cli-instance-key-help')?.textContent).toContain(hint);
      expect(!!q('add-cli-instance-key')).toBe(keyField);
      expect(submit()?.disabled).toBe(false);
    });

    it('creates through saveSettings, then closes and drops the key (no Undo for a create)', async () => {
      type('add-cli-instance-name', ' Kimi-2 ');
      choose('moonshot');
      type('add-cli-instance-key', KEY);
      submit()?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith(
        { cli: [{ action: 'create', params: { name: 'Kimi-2', providerId: 'moonshot', apiKey: KEY } }] }, CONTEXT);
      // M4: a stored key is not a checked one; the matrix runs the Test on `created`.
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Created Kimi-2. Key stored, not verified. Testing the connection.', canUndo: false });
      expect(fixture.componentInstance.created).toEqual(['Kimi-2']);
      expect(fixture.componentInstance.closed).toBe(1);
      // Reopened: an empty form, never the earlier key.
      fixture.componentInstance.open.set(true);
      fixture.detectChanges();
      expect(q<HTMLInputElement>('add-cli-instance-name')?.value).toBe('');
      expect(q('add-cli-instance-key')).toBeNull();
    });

    it('stays open with the form and key after a failed create (D15)', async () => {
      state.outcome = 'failed';
      type('add-cli-instance-name', 'Kimi-2');
      choose('moonshot');
      type('add-cli-instance-key', KEY);
      submit()?.click();
      await flush();
      expect(feedback.toast()?.tone).toBe('alert');
      expect(feedback.toast()?.message).not.toContain('Saved');
      expect(fixture.componentInstance.closed).toBe(0);
      expect(q<HTMLInputElement>('add-cli-instance-key')?.value).toBe(KEY);
    });

    it('reports a refused create and stays open', async () => {
      state.outcome = 'refused';
      type('add-cli-instance-name', 'Local');
      choose('ollama');
      submit()?.click();
      await flush();
      expect(feedback.toast()?.message).toBe(SAVE_REFUSED_MESSAGE);
      expect(fixture.componentInstance.closed).toBe(0);
    });

    it('holds GitHub Copilot until its inline sign-in reports signed-in (#47)', async () => {
      type('add-cli-instance-name', 'Copilot-agent');
      state.signIn = 'idle';
      choose('github-copilot');
      await flush();
      expect(q('add-cli-instance-key')).toBeNull();
      expect(q('add-cli-instance-copilot-state')?.textContent?.trim()).toBe('Awaiting sign-in');
      expect(submit()?.disabled).toBe(true);
      q<HTMLButtonElement>('add-cli-instance-copilot-login')?.click();
      await flush();
      expect(state.performExternalAuth).toHaveBeenCalledWith('github-copilot', 'sign-in');
      expect(submit()?.disabled).toBe(true);
      state.signIn = 'error';
      q<HTMLButtonElement>('add-cli-instance-copilot-login')?.click();
      await flush();
      expect(q('add-cli-instance-copilot-message')?.getAttribute('role')).toBe('alert');
      expect(q('add-cli-instance-copilot-login')?.textContent?.trim()).toBe('Retry login with GitHub');
      state.signIn = 'signed-in';
      q<HTMLButtonElement>('add-cli-instance-copilot-login')?.click();
      await flush();
      expect(q('add-cli-instance-copilot-state')?.textContent?.trim()).toBe('Signed in');
      expect(submit()?.disabled).toBe(false);
      submit()?.click();
      await flush();
      // The host contract's non-secret OAuth marker is added by the state service; the form sends no key.
      expect(state.saveSettings).toHaveBeenCalledWith(
        { cli: [{ action: 'create', params: { name: 'Copilot-agent', providerId: 'github-copilot', apiKey: '' } }] }, CONTEXT);
    });

    it('does not count another provider\'s sign-in as Copilot\'s', () => {
      state.performExternalAuth.mockImplementationOnce(async () => undefined);
      state.externalAuth.set(ready({ providerId: 'openai-codex', signInState: 'signed-in', accountLabel: null, cliInstalled: null, message: null }));
      type('add-cli-instance-name', 'Copilot-agent');
      choose('github-copilot');
      expect(submit()?.disabled).toBe(true);
    });

    it('M6: an earlier Copilot sign-in in the shared store never counts; choosing Copilot re-reads the sign-in', async () => {
      state.externalAuth.set(ready({ providerId: 'github-copilot', signInState: 'signed-in', accountLabel: null, cliInstalled: null, message: null }));
      // Open the form with that stale data still in the store: Copilot is not chosen yet, nothing reads it.
      state.performExternalAuth.mockImplementationOnce(async () => {
        state.externalAuth.set({ status: 'loading', data: null, error: null });
      });
      type('add-cli-instance-name', 'Copilot-agent');
      choose('github-copilot');
      expect(state.performExternalAuth).toHaveBeenCalledWith('github-copilot', 'cli-check');
      fixture.detectChanges();
      expect(q('add-cli-instance-copilot-state')?.textContent?.trim()).toBe('Checking sign-in…');
      expect(submit()?.disabled).toBe(true);
      state.signIn = 'idle';
      await state.performExternalAuth('github-copilot', 'cli-check');
      fixture.detectChanges();
      expect(q('add-cli-instance-copilot-state')?.textContent?.trim()).toBe('Awaiting sign-in');
      expect(submit()?.disabled).toBe(true);
      // A fresh signed-in read enables Create.
      state.signIn = 'signed-in';
      choose('ollama');
      choose('github-copilot');
      await flush();
      expect(q('add-cli-instance-copilot-state')?.textContent?.trim()).toBe('Signed in');
      expect(submit()?.disabled).toBe(false);
    });

    it('M6: a reopened form forgets the previous open sign-in', async () => {
      type('add-cli-instance-name', 'Copilot-agent');
      choose('github-copilot');
      await flush();
      expect(submit()?.disabled).toBe(false);
      fixture.componentInstance.open.set(false);
      fixture.detectChanges();
      fixture.componentInstance.open.set(true);
      fixture.detectChanges();
      expect(q('add-cli-instance-copilot')).toBeNull();
      expect(q('add-cli-instance-copilot-state')).toBeNull();
    });

    it('S2: switching provider drops the typed key; a hidden key field is never submitted', async () => {
      type('add-cli-instance-name', 'Kimi-2');
      choose('moonshot');
      type('add-cli-instance-key', KEY);
      choose('ollama-cloud');
      expect(q<HTMLInputElement>('add-cli-instance-key')?.value).toBe('');
      type('add-cli-instance-key', KEY);
      choose('ollama');
      expect(q('add-cli-instance-key')).toBeNull();
      submit()?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith(
        { cli: [{ action: 'create', params: { name: 'Kimi-2', providerId: 'ollama', apiKey: '' } }] }, CONTEXT);
      expect(JSON.stringify(state.saveSettings.mock.calls)).not.toContain(KEY);
      expect(feedback.toast()?.message).toBe('Saved Ptah CLI instance Kimi-2 to All Ptah apps.');
    });

    it('M9: rejects a duplicate name, case-insensitively, with a fixed message', () => {
      type('add-cli-instance-name', ' gLM ');
      choose('ollama');
      expect(q('add-cli-instance-name-error')?.textContent?.trim()).toBe('Another Ptah CLI instance already uses this name.');
      expect(q('add-cli-instance-name')?.getAttribute('aria-invalid')).toBe('true');
      expect(submit()?.disabled).toBe(true);
      type('add-cli-instance-name', 'Glm-2');
      expect(q('add-cli-instance-name-error')).toBeNull();
      expect(submit()?.disabled).toBe(false);
    });

    it('M2: a refused create stays open even when an earlier commit says saved', async () => {
      state.commit.set({ ...idle, status: 'saved' });
      state.outcome = 'refused';
      type('add-cli-instance-name', 'Local');
      choose('ollama');
      submit()?.click();
      await flush();
      expect(fixture.componentInstance.closed).toBe(0);
      expect(fixture.componentInstance.created).toEqual([]);
    });

    it('writes nothing while the settings scopes are not loaded, or while another save runs (D3)', () => {
      type('add-cli-instance-name', 'Local');
      choose('ollama');
      state.contextNow.set(null);
      fixture.detectChanges();
      expect(submit()?.disabled).toBe(true);
      state.contextNow.set(CONTEXT);
      state.commit.set({ ...idle, status: 'saving' });
      fixture.detectChanges();
      expect(submit()?.disabled).toBe(true);
      expect(submit()?.textContent?.trim()).toBe('Saving…');
    });

    it('closes from Cancel and drops the typed key; a save already running still reports through the toast', async () => {
      type('add-cli-instance-name', 'Kimi-2');
      choose('moonshot');
      type('add-cli-instance-key', KEY);
      let release: (value: boolean) => void = () => undefined;
      state.saveSettings.mockImplementationOnce(() => new Promise<boolean>((resolve) => { release = resolve; }));
      submit()?.click();
      fixture.detectChanges();
      Array.from(el().querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Cancel')?.click();
      fixture.detectChanges();
      expect(fixture.componentInstance.closed).toBe(1);
      state.commit.set({ ...idle, status: 'saved' });
      release(true);
      await flush();
      expect(feedback.toast()?.message).toBe('Created Kimi-2. Key stored, not verified. Testing the connection.');
      // It does not close (or reopen) again for that late result, nor report a create for the closed form.
      expect(fixture.componentInstance.created).toEqual([]);
      expect(fixture.componentInstance.closed).toBe(1);
    });
  });

  describe('edit (#50)', () => {
    const GLM: CliInstanceEditTarget = { id: 'glm-1', name: 'Glm', providerId: 'moonshot', providerName: 'Moonshot (Kimi)' };
    const COPILOT_AGENT: CliInstanceEditTarget = { id: 'cp-1', name: 'Cop', providerId: 'github-copilot', providerName: 'GitHub Copilot' };

    it('shows the name and a replacement key; the provider is fixed', () => {
      create(GLM);
      expect(q('add-cli-instance-modal')?.textContent).toContain('Edit Glm');
      expect(q<HTMLInputElement>('add-cli-instance-name')?.value).toBe('Glm');
      expect(q('add-cli-instance-provider')).toBeNull();
      expect(q('add-cli-instance-provider-fixed')?.textContent?.trim()).toBe('Moonshot (Kimi)');
      expect(el().textContent).toContain('Replacement API key (leave empty to keep the stored one)');
      expect(submit()?.textContent?.trim()).toBe('Save changes');
      expect(submit()?.disabled).toBe(true);
    });

    it('renames through ptahCli:update with an Undo that writes the old name back', async () => {
      create(GLM);
      type('add-cli-instance-name', 'Glm-Main');
      submit()?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ cli: [{ action: 'update', params: { id: 'glm-1', name: 'Glm-Main' } }] }, CONTEXT);
      expect(feedback.toast()?.canUndo).toBe(true);
      await feedback.undo();
      expect(state.saveSettings).toHaveBeenLastCalledWith({ cli: [{ action: 'update', params: { id: 'glm-1', name: 'Glm' } }] }, CONTEXT);
    });

    it('replaces only the key when the name is unchanged, with no Undo', async () => {
      create(GLM);
      type('add-cli-instance-key', KEY);
      submit()?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ cli: [{ action: 'update', params: { id: 'glm-1', apiKey: KEY } }] }, CONTEXT);
      expect(feedback.toast()).toEqual({ tone: 'status', message: 'Saved Glm instance. Key stored, not verified.', canUndo: false });
      // M8: the last Test described the old key.
      expect(state.clearCliTest).toHaveBeenCalledWith('glm-1');
    });

    it('M7: name and key are two writes; a saved rename with a failed key says exactly that', async () => {
      create(GLM);
      state.saveSettings.mockImplementationOnce(async () => {
        state.commit.set({ ...idle, status: 'partial', saved: ['ptahCliAgents.glm-1.name'], unsaved: ['ptahCliAgents.glm-1.apiKey'] });
        return true;
      });
      type('add-cli-instance-name', 'Glm-Main');
      type('add-cli-instance-key', KEY);
      submit()?.click();
      await flush();
      expect(state.saveSettings).toHaveBeenCalledWith({ cli: [
        { action: 'update', params: { id: 'glm-1', name: 'Glm-Main' } },
        { action: 'update', params: { id: 'glm-1', apiKey: KEY } },
      ] }, CONTEXT);
      expect(feedback.toast()).toEqual({ tone: 'alert', message: 'Name saved. The key was not saved.', canUndo: false });
      expect(fixture.componentInstance.closed).toBe(0);
      expect(state.clearCliTest).toHaveBeenCalledWith('glm-1');
    });

    it('M9: an edit may keep its own name but not take the name of another instance', () => {
      state.cliAgents.set(ready([{ id: 'glm-1', name: 'Glm' }, { id: 'k-1', name: 'Kimi' }]));
      create(GLM);
      expect(q('add-cli-instance-name-error')).toBeNull();
      type('add-cli-instance-name', 'kimi');
      expect(q('add-cli-instance-name-error')).not.toBeNull();
      expect(submit()?.disabled).toBe(true);
    });

    it('M6: editing a Copilot instance shows no sign-in panel while Copilot is signed in, and shows it when signed out', () => {
      create(COPILOT_AGENT);
      expect(q('add-cli-instance-copilot')).toBeNull();
      expect(q('add-cli-instance-key')).toBeNull();
      state.connections.set(ready(CONNECTIONS.map((entry) => entry.id === 'github-copilot' ? { ...entry, configured: false } : entry)));
      fixture.detectChanges();
      expect(q('add-cli-instance-copilot')?.textContent).toContain('GitHub Copilot is signed out.');
      type('add-cli-instance-name', 'Cop-2');
      expect(submit()?.disabled).toBe(false);
    });
  });
});
