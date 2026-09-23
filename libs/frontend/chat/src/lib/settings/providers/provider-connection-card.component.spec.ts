/**
 * ProviderConnectionCardComponent specs — TASK_2026_523_c3df, Batch D-i.
 *
 * Full coverage of design-spec.md ("3. Your connections", "State table (state -> visual -> copy)",
 * "Accessibility notes") and implementation-plan.md:
 * - One spec case per row of the design spec's state table (active, connected, needs-key,
 *   unauthenticated, unreachable, not-installed, not-configured, checking, not-checked,
 *   check-unavailable).
 * - Safety rule: A status that is not a confirmed success is never shown as Connected
 *   (unknown -> Not checked, skipped -> Check unavailable, missing -> Not configured,
 *   connected with positiveProbeEvidence=false -> Not checked, reachable without probe -> Not checked).
 * - Blocked main route displays "Main agent · Needs attention" and exact failure, never the healthy badge.
 * - Non-truncation of provider name and auth modality.
 * - Accessibility: 36 px minimum control height (min-h-9), 2 px focus outlines, and explicit aria-labels.
 * - Scope row embedding and intent emission.
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ProviderConnectionCardComponent } from './provider-connection-card.component';
import type { SettingScopeDisplay } from './setting-scope-row.component';

type CardInputs = {
  [K in keyof ProviderConnectionCardComponent]: unknown;
};

function createComponent(
  inputs: Partial<CardInputs> = {},
): ComponentFixture<ProviderConnectionCardComponent> {
  const fixture = TestBed.createComponent(ProviderConnectionCardComponent);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture;
}

function query(
  fixture: ComponentFixture<ProviderConnectionCardComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function button(
  fixture: ComponentFixture<ProviderConnectionCardComponent>,
  testId: string,
): HTMLButtonElement | null {
  return query(fixture, testId) as HTMLButtonElement | null;
}

describe('ProviderConnectionCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProviderConnectionCardComponent],
    }).compileComponents();
  });

  describe('State Table (one spec case per row of design-spec.md)', () => {
    it('row 1 [active]: renders secondary spine, CheckCircle, Active for main agent badge, exact copy, and Change main provider button', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'active',
      });

      const card = query(fixture, 'provider-connection-card');
      const spine = card?.querySelector('[data-testid="native-card-spine"]');
      expect(spine).not.toBeNull();
      expect(card?.querySelector('[data-tone="secondary"]')).not.toBeNull();

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Active for main agent');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe('Used for new main-agent requests.');

      const changeBtn = button(fixture, 'btn-change-main');
      expect(changeBtn).not.toBeNull();
      expect(changeBtn?.textContent?.trim()).toBe('Change main provider');

      let changeEmitted = false;
      fixture.componentInstance.changeMainProviderRequested.subscribe(() => {
        changeEmitted = true;
      });
      changeBtn?.click();
      expect(changeEmitted).toBe(true);
    });

    it('row 2 [connected]: renders neutral card, CheckCircle, Connected · Available badge, exact copy, and Use for main agent / Manage buttons', () => {
      const fixture = createComponent({
        providerId: 'openai',
        providerName: 'OpenAI',
        status: 'connected',
        positiveProbeEvidence: true,
      });

      const card = query(fixture, 'provider-connection-card');
      const spine = card?.querySelector('[data-testid="native-card-spine"]');
      expect(spine).toBeNull();
      expect(card?.querySelector('[data-tone="neutral"]')).not.toBeNull();

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Connected · Available');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe('Connected and available to use.');

      const activateBtn = button(fixture, 'btn-activate-main');
      expect(activateBtn).not.toBeNull();
      expect(activateBtn?.textContent?.trim()).toBe('Use for main agent');

      const manageBtn = button(fixture, 'btn-manage');
      expect(manageBtn).not.toBeNull();
      expect(manageBtn?.textContent?.trim()).toBe('Manage');

      let activateEmitted = false;
      let manageEmitted = false;
      fixture.componentInstance.activateMainRequested.subscribe(() => {
        activateEmitted = true;
      });
      fixture.componentInstance.manageRequested.subscribe(() => {
        manageEmitted = true;
      });

      activateBtn?.click();
      expect(activateEmitted).toBe(true);

      manageBtn?.click();
      expect(manageEmitted).toBe(true);
    });

    it('row 3 [needs-key]: renders warning spine, Key, Needs API key badge, exact copy, and Add API key button', () => {
      const fixture = createComponent({
        providerId: 'gemini',
        providerName: 'Google Gemini',
        status: 'needs-key',
      });

      const card = query(fixture, 'provider-connection-card');
      const spine = card?.querySelector('[data-testid="native-card-spine"]');
      expect(spine).not.toBeNull();
      expect(card?.querySelector('[data-tone="warning"]')).not.toBeNull();

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Needs API key');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Add an API key to connect Google Gemini.',
      );

      const addKeyBtn = button(fixture, 'btn-add-key');
      expect(addKeyBtn).not.toBeNull();
      expect(addKeyBtn?.textContent?.trim()).toBe('Add API key');

      let addKeyEmitted = false;
      fixture.componentInstance.addKeyRequested.subscribe(() => {
        addKeyEmitted = true;
      });
      addKeyBtn?.click();
      expect(addKeyEmitted).toBe(true);
    });

    it('row 4a [unauthenticated - sign-in]: renders LogOut, Sign-in required badge, exact copy, and Sign in button for CLI/OAuth', () => {
      const fixture = createComponent({
        providerId: 'claude-cli',
        providerName: 'Claude',
        authModality: 'cli',
        status: 'unauthenticated',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Sign-in required');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Your credential is missing or expired; authenticate again.',
      );

      const signInBtn = button(fixture, 'btn-sign-in');
      expect(signInBtn).not.toBeNull();
      expect(signInBtn?.textContent?.trim()).toBe('Sign in');

      let signInEmitted = false;
      fixture.componentInstance.signInRequested.subscribe(() => {
        signInEmitted = true;
      });
      signInBtn?.click();
      expect(signInEmitted).toBe(true);
    });

    it('row 4b [unauthenticated - credential rejected]: renders LogOut, Credential rejected badge, exact copy, and Replace key button for API key', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        authModality: 'api-key',
        status: 'unauthenticated',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Credential rejected');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Your credential is missing or expired; authenticate again.',
      );

      const replaceKeyBtn = button(fixture, 'btn-replace-key');
      expect(replaceKeyBtn).not.toBeNull();
      expect(replaceKeyBtn?.textContent?.trim()).toBe('Replace key');

      let replaceKeyEmitted = false;
      fixture.componentInstance.replaceKeyRequested.subscribe(() => {
        replaceKeyEmitted = true;
      });
      replaceKeyBtn?.click();
      expect(replaceKeyEmitted).toBe(true);
    });

    it('row 5 [unreachable]: renders warning spine, AlertTriangle, Unreachable badge, exact copy, and Retry / Edit connection buttons', () => {
      const fixture = createComponent({
        providerId: 'ollama',
        providerName: 'Ollama',
        status: 'unreachable',
      });

      const card = query(fixture, 'provider-connection-card');
      const spine = card?.querySelector('[data-testid="native-card-spine"]');
      expect(spine).not.toBeNull();
      expect(card?.querySelector('[data-tone="warning"]')).not.toBeNull();

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Unreachable');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Could not reach Ollama; check the connection and retry.',
      );

      const retryBtn = button(fixture, 'btn-retry');
      expect(retryBtn).not.toBeNull();
      expect(retryBtn?.textContent?.trim()).toBe('Retry');

      const editBtn = button(fixture, 'btn-edit-connection');
      expect(editBtn).not.toBeNull();
      expect(editBtn?.textContent?.trim()).toBe('Edit connection');

      let retryEmitted = false;
      let editEmitted = false;
      fixture.componentInstance.retryRequested.subscribe(() => {
        retryEmitted = true;
      });
      fixture.componentInstance.editConnectionRequested.subscribe(() => {
        editEmitted = true;
      });

      retryBtn?.click();
      expect(retryEmitted).toBe(true);

      editBtn?.click();
      expect(editEmitted).toBe(true);
    });

    it('row 6 [not-installed]: renders Terminal, Not installed badge, exact copy, and Installation instructions / Check again buttons', () => {
      const fixture = createComponent({
        providerId: 'claude-cli',
        providerName: 'Claude',
        cliName: 'Claude CLI',
        status: 'not-installed',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not installed');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Install Claude CLI to use this connection.',
      );

      const installBtn = button(fixture, 'btn-install-instructions');
      expect(installBtn).not.toBeNull();
      expect(installBtn?.textContent?.trim()).toBe('Installation instructions');

      const checkAgainBtn = button(fixture, 'btn-check-again');
      expect(checkAgainBtn).not.toBeNull();
      expect(checkAgainBtn?.textContent?.trim()).toBe('Check again');

      let installEmitted = false;
      let checkAgainEmitted = false;
      fixture.componentInstance.installInstructionsRequested.subscribe(() => {
        installEmitted = true;
      });
      fixture.componentInstance.checkAgainRequested.subscribe(() => {
        checkAgainEmitted = true;
      });

      installBtn?.click();
      expect(installEmitted).toBe(true);

      checkAgainBtn?.click();
      expect(checkAgainEmitted).toBe(true);
    });

    it('row 7 [not-configured]: renders neutral card, Plus, Not configured badge, exact copy, and Set up button', () => {
      const fixture = createComponent({
        providerId: 'mistral',
        providerName: 'Mistral',
        status: 'not-configured',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not configured');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Set up Mistral when you are ready.',
      );

      const setupBtn = button(fixture, 'btn-setup');
      expect(setupBtn).not.toBeNull();
      expect(setupBtn?.textContent?.trim()).toBe('Set up');

      let setupEmitted = false;
      fixture.componentInstance.setupRequested.subscribe(() => {
        setupEmitted = true;
      });
      setupBtn?.click();
      expect(setupEmitted).toBe(true);
    });

    it('row 8 [checking]: renders Loader2 icon, Checking… badge, exact copy, and no interactive buttons', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'checking',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Checking…');

      const spinner = badge?.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe('Checking Anthropic…');

      // No action buttons while actively checking
      expect(button(fixture, 'btn-change-main')).toBeNull();
      expect(button(fixture, 'btn-activate-main')).toBeNull();
      expect(button(fixture, 'btn-setup')).toBeNull();
    });

    it('row 9 [not-checked]: renders HelpCircle, Not checked badge, exact copy, and Check connection button', () => {
      const fixture = createComponent({
        providerId: 'openai',
        providerName: 'OpenAI',
        status: 'not-checked',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not checked');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe('Connection has not been verified.');

      const checkBtn = button(fixture, 'btn-check-connection');
      expect(checkBtn).not.toBeNull();
      expect(checkBtn?.textContent?.trim()).toBe('Check connection');

      let checkEmitted = false;
      fixture.componentInstance.checkConnectionRequested.subscribe(() => {
        checkEmitted = true;
      });
      checkBtn?.click();
      expect(checkEmitted).toBe(true);
    });

    it('row 10 [check-unavailable]: renders AlertCircle, Check unavailable badge, exact copy, and Retry button', () => {
      const fixture = createComponent({
        providerId: 'openrouter',
        providerName: 'OpenRouter',
        status: 'check-unavailable',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Check unavailable');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Could not check this connection. Retry.',
      );

      const retryBtn = button(fixture, 'btn-retry');
      expect(retryBtn).not.toBeNull();
      expect(retryBtn?.textContent?.trim()).toBe('Retry');

      let retryEmitted = false;
      fixture.componentInstance.retryRequested.subscribe(() => {
        retryEmitted = true;
      });
      retryBtn?.click();
      expect(retryEmitted).toBe(true);
    });
  });

  describe('Enforcement rule: A status that is not confirmed success is NEVER shown as Connected', () => {
    it('maps "unknown" directly to Not checked (Connection has not been verified.), NEVER Connected', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'unknown',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not checked');
      expect(badge?.textContent?.trim()).not.toContain('Connected');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe('Connection has not been verified.');
      // Not checkable is not failed: activation stays available (TASK_2026_534 R2.5).
      expect(button(fixture, 'btn-activate-main')).not.toBeNull();
    });

    it('maps "skipped" directly to Check unavailable (Could not check this connection. Retry.), NEVER Connected', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'skipped',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Check unavailable');
      expect(badge?.textContent?.trim()).not.toContain('Connected');

      const copy = query(fixture, 'status-copy');
      expect(copy?.textContent?.trim()).toBe(
        'Could not check this connection. Retry.',
      );
      // Local servers report `skipped`; they must stay activatable (TASK_2026_534 R2.5).
      expect(button(fixture, 'btn-activate-main')).not.toBeNull();
    });

    it('does not offer activation for uncheckable status when activation is disabled', () => {
      const fixture = createComponent({
        providerId: 'ollama',
        providerName: 'Ollama',
        status: 'skipped',
        canActivateMain: false,
      });
      expect(button(fixture, 'btn-activate-main')).toBeNull();
    });

    it('maps "missing" directly to Not configured, NEVER Connected', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'missing',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not configured');
      expect(badge?.textContent?.trim()).not.toContain('Connected');
    });

    it('downgrades status "connected" to "Not checked" if positiveProbeEvidence is explicitly false', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'connected',
        positiveProbeEvidence: false,
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not checked');
      expect(badge?.textContent?.trim()).not.toContain('Connected');
      expect(button(fixture, 'btn-activate-main')).toBeNull();
    });

    it('downgrades candidate "active" to "Not checked" if positiveProbeEvidence is explicitly false', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'active',
        positiveProbeEvidence: false,
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not checked');
      expect(badge?.textContent?.trim()).not.toContain('Active');
    });

    it('downgrades status "reachable" to "Not checked" when positive probe evidence is absent', () => {
      const fixture = createComponent({
        providerId: 'ollama',
        providerName: 'Ollama',
        status: 'reachable',
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Not checked');
      expect(badge?.textContent?.trim()).not.toContain('Connected');
    });

    it('promotes status "reachable" to "Connected · Available" only when positive probe evidence is explicitly confirmed', () => {
      const fixture = createComponent({
        providerId: 'ollama',
        providerName: 'Ollama',
        status: 'reachable',
        positiveProbeEvidence: true,
      });

      const badge = query(fixture, 'status-badge');
      expect(badge?.textContent?.trim()).toContain('Connected · Available');
    });
  });

  describe('Main Agent Blocked State Invariant', () => {
    it('displays "Main agent · Needs attention" and failure badge when active route is blocked/unreachable', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'unreachable',
        isActive: true,
      });

      const blockedBadge = query(fixture, 'blocked-main-badge');
      expect(blockedBadge).not.toBeNull();
      expect(blockedBadge?.textContent?.trim()).toContain(
        'Main agent · Needs attention',
      );

      const statusBadge = query(fixture, 'status-badge');
      expect(statusBadge?.textContent?.trim()).toContain('Unreachable');

      // MUST NEVER get the healthy active badge while blocked
      expect(statusBadge?.textContent?.trim()).not.toContain(
        'Active for main agent',
      );

      // Warning tone applied to card
      const card = query(fixture, 'provider-connection-card');
      expect(card?.querySelector('[data-tone="warning"]')).not.toBeNull();
    });

    it('displays "Main agent · Needs attention" when isBlocked flag is explicitly set', () => {
      const fixture = createComponent({
        providerId: 'openai',
        providerName: 'OpenAI',
        status: 'needs-key',
        isBlocked: true,
      });

      const blockedBadge = query(fixture, 'blocked-main-badge');
      expect(blockedBadge).not.toBeNull();
      expect(blockedBadge?.textContent?.trim()).toContain(
        'Main agent · Needs attention',
      );
      expect(query(fixture, 'status-badge')?.textContent?.trim()).toContain(
        'Needs API key',
      );
    });
  });

  describe('Identity, Auth Modality and Layout Non-truncation', () => {
    it('renders provider name and explicit auth modality label without truncation classes', () => {
      const fixture = createComponent({
        providerId: 'claude-cli',
        providerName: 'Claude',
        authModality: 'cli',
      });

      const nameEl = query(fixture, 'provider-name');
      expect(nameEl?.textContent?.trim()).toBe('Claude');
      expect(nameEl?.classList.contains('truncate')).toBe(false);

      const modalityEl = query(fixture, 'auth-modality');
      expect(modalityEl?.textContent?.trim()).toBe('CLI subscription');
      expect(modalityEl?.classList.contains('truncate')).toBe(false);
    });

    it('formats recognized auth modalities accurately', () => {
      const testCases: [string, string][] = [
        ['api-key', 'API key'],
        ['apiKey', 'API key'],
        ['cli', 'CLI subscription'],
        ['oauth', 'OAuth'],
        ['local', 'Local endpoint'],
        ['local-native', 'Local endpoint'],
      ];

      for (const [modality, expected] of testCases) {
        const fixture = createComponent({
          providerId: 'test',
          authModality: modality,
        });
        expect(query(fixture, 'auth-modality')?.textContent?.trim()).toBe(
          expected,
        );
      }
    });

    it('renders preformatted authModalityText verbatim when supplied', () => {
      const fixture = createComponent({
        providerId: 'custom-corp',
        authModality: 'custom',
        authModalityText: 'Custom SSO (Enterprise)',
      });

      expect(query(fixture, 'auth-modality')?.textContent?.trim()).toBe(
        'Custom SSO (Enterprise)',
      );
    });

    it('suppresses "Use for main agent" when canActivateMain is false (CLI-only integration)', () => {
      const fixture = createComponent({
        providerId: 'claude-cli',
        providerName: 'Claude CLI',
        status: 'connected',
        positiveProbeEvidence: true,
        canActivateMain: false,
      });

      expect(button(fixture, 'btn-activate-main')).toBeNull();
      expect(button(fixture, 'btn-manage')).not.toBeNull();
    });
  });

  describe('Timestamps and Diagnostics', () => {
    it('renders prior success "Last connected {time}" alongside failure status', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'unreachable',
        lastConnectedText: '2 hours ago',
      });

      const lastConn = query(fixture, 'last-connected');
      expect(lastConn?.textContent?.trim()).toBe('Last connected 2 hours ago');
    });

    it('renders last failed check timestamp when supplied', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'unreachable',
        lastFailedText: '5 minutes ago',
      });

      const lastFailed = query(fixture, 'last-failed');
      expect(lastFailed?.textContent?.trim()).toBe(
        'Last check failed 5 minutes ago',
      );
    });
  });

  describe('Scope Row Embedding and Provenance', () => {
    it('embeds SettingScopeRowComponent when scope input is provided', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        scope: 'workspace' as SettingScopeDisplay,
        workspaceName: 'ptah-extension',
      });

      const scopeWrapper = query(fixture, 'card-scope-wrapper');
      expect(scopeWrapper).not.toBeNull();
      const scopeBadge = query(fixture, 'scope-source-badge');
      expect(scopeBadge?.textContent?.trim()).toContain(
        'From Workspace · ptah-extension',
      );
    });

    it('forwards scope actions to component outputs', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        scope: 'global' as SettingScopeDisplay,
        supportedTargets: ['global', 'workspace'],
        hasOverride: false,
      });

      let overrideEmitted = false;
      fixture.componentInstance.scopeOverrideRequested.subscribe(() => {
        overrideEmitted = true;
      });

      const overrideBtn = button(fixture, 'scope-override');
      expect(overrideBtn).not.toBeNull();
      overrideBtn?.click();
      expect(overrideEmitted).toBe(true);
    });

    it('renders simple source-strip when sourceLabel is supplied without scope', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        sourceLabel: 'From Workspace · ptah-extension',
      });

      const sourceStrip = query(fixture, 'source-strip');
      expect(sourceStrip?.textContent?.trim()).toBe(
        'From Workspace · ptah-extension',
      );
    });
  });

  describe('Accessibility Requirements', () => {
    it('enforces min-h-9 (36 px) and 2 px focus outline classes on every action button', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'connected',
        positiveProbeEvidence: true,
      });

      const buttons = fixture.nativeElement.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);

      for (const btn of Array.from(buttons) as HTMLButtonElement[]) {
        expect(btn.classList.contains('min-h-9')).toBe(true);
        expect(btn.classList.contains('focus-visible:outline-2')).toBe(true);
        expect(btn.getAttribute('aria-label')).toBeTruthy();
      }
    });

    it('includes provider name in all action button aria-labels', () => {
      const fixture = createComponent({
        providerId: 'anthropic',
        providerName: 'Anthropic',
        status: 'connected',
        positiveProbeEvidence: true,
      });

      const activateBtn = button(fixture, 'btn-activate-main');
      expect(activateBtn?.getAttribute('aria-label')).toBe(
        'Use Anthropic for main agent',
      );

      const manageBtn = button(fixture, 'btn-manage');
      expect(manageBtn?.getAttribute('aria-label')).toBe('Manage Anthropic');
    });

    it('includes CLI name in not-installed button aria-labels', () => {
      const fixture = createComponent({
        providerId: 'claude-cli',
        providerName: 'Claude',
        cliName: 'Claude CLI',
        status: 'not-installed',
      });

      const installBtn = button(fixture, 'btn-install-instructions');
      expect(installBtn?.getAttribute('aria-label')).toBe(
        'Installation instructions for Claude CLI',
      );

      const checkAgainBtn = button(fixture, 'btn-check-again');
      expect(checkAgainBtn?.getAttribute('aria-label')).toBe(
        'Check again for Claude CLI',
      );
    });
  });
});
