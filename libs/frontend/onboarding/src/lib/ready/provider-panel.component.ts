import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { CLAUDE_CODE_INSTALL_COMMANDS, CLAUDE_CODE_SETUP_DOCS_URL, CLAUDE_CODE_SIGN_IN_COMMAND, CODEX_INSTALL_COMMANDS, CODEX_SETUP_DOCS_URL, codexTerminalLoginCommand, onboardingReadyTarget, type ClaudeCodeInstallCommand, type ClaudeCodeInstallTab } from '@ptah-extension/core';
import { CodexSignInBlockComponent } from '@ptah-extension/chat';
import { CircleAlert, CircleCheck, CircleMinus, Clock, Download, ExternalLink, Info, Loader, LogIn, LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { CommandCopyRowComponent } from './command-copy-row.component';
import type { ProviderReadinessView, ProviderReadinessState } from './provider-readiness.derive';

const OS_TABS: readonly { id: ClaudeCodeInstallTab; label: string }[] = [
  { id: 'unix', label: 'macOS / Linux' }, { id: 'windows', label: 'Windows' }, { id: 'npm', label: 'npm' },
];
const COPY_LABELS: Record<ClaudeCodeInstallCommand['id'], string> = {
  unix: 'Copy macOS and Linux install command', powershell: 'Copy Windows PowerShell install command',
  cmd: 'Copy Windows CMD install command', npm: 'Copy npm install command',
};
const CHIP: Record<ProviderReadinessState, { label: string; icon: LucideIconData; tone: string }> = {
  checking: { label: 'Checking', icon: Loader, tone: 'text-state-run' },
  slow: { label: 'Taking longer', icon: Clock, tone: 'text-state-run' },
  ready: { label: 'Ready', icon: CircleCheck, tone: 'text-state-done' },
  missing: { label: 'Not installed', icon: Download, tone: 'text-state-need' },
  'signed-out': { label: 'Not signed in', icon: LogIn, tone: 'text-state-need' },
  stale: { label: 'Sign in again', icon: LogIn, tone: 'text-state-need' },
  error: { label: 'Could not check', icon: CircleAlert, tone: 'text-state-err' },
};

@Component({
  selector: 'ptah-provider-panel', standalone: true,
  imports: [RouterLink, NgTemplateOutlet, LucideAngularModule, CommandCopyRowComponent, CodexSignInBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="rounded-[22px] border p-5 max-[480px]:p-4" [class.border-primary]="role() === 'main'"
      [class.bg-base-200]="role() === 'main'" [class.border-base-300]="role() !== 'main'"
      [class.bg-base-100]="role() !== 'main'" [attr.data-testid]="view().provider === 'claude-cli' ? 'ready-claude-panel' : 'ready-codex-panel'"
      [attr.data-state]="view().state" [attr.aria-busy]="view().state === 'checking' || view().state === 'slow'">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="text-lg font-semibold">{{ name() }}</h2>
          <p class="text-sm text-base-content-muted">The <span class="font-mono">{{ commandName() }}</span> command on this computer</p>
          @if (role() === 'main') { <span class="rounded-full border border-primary px-2 text-xs font-semibold">Main connection</span> }
          @else if (role() === 'information') { <span class="rounded-full border border-base-300 px-2 text-xs text-base-content-muted">Not your main connection</span> }
        </div>
        <span class="inline-flex items-center gap-1.5 rounded-full border border-base-300 px-2.5 py-0.5 text-xs font-medium"
          [class]="role() === 'information' && view().state !== 'ready' ? 'text-base-content-muted border-dashed' : chip().tone"
          data-glass-surface="tile">
          <lucide-angular [img]="role() === 'information' && view().state !== 'ready' ? (view().state === 'error' ? icons.info : icons.minus) : chip().icon"
            class="size-4" aria-hidden="true" />{{ chip().label }}
        </span>
      </header>
      <dl class="mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm max-[480px]:grid-cols-1 max-[480px]:gap-y-1">
        <dt class="text-base-content-muted">Installed</dt><dd class="min-w-0 [overflow-wrap:anywhere]">
          @if (view().state === 'checking' || view().state === 'slow') { <span class="skeleton inline-block h-3.5 w-40" aria-hidden="true"></span><span class="sr-only">Checking</span> }
          @else if (view().state === 'missing') { No <span class="font-mono">{{ commandName() }}</span> command was found. }
          @else if (view().path && view().source === 'bundled') { <span class="font-mono">Ptah bundled copy: {{ view().path }}</span><br />Yes. Ptah's bundled copy is used. }
          @else if (view().path) { <span class="font-mono">{{ view().path }}</span> }
          @else { Unknown }
        </dd>
        <dt class="text-base-content-muted">Version</dt><dd>
          @if (view().state === 'checking' || view().state === 'slow') { <span class="skeleton inline-block h-3.5 w-16" aria-hidden="true"></span> }
          @else { <span class="font-mono">{{ view().version ?? 'Not available' }}</span> }
        </dd>
        <dt class="text-base-content-muted">Signed in</dt><dd>{{ signedInText() }}</dd>
      </dl>
      @if (helpVisible()) {
        @if (role() === 'information') {
          <details class="mt-5 border-t border-base-300 pt-4"><summary class="cursor-pointer text-sm">Help with {{ name() }}</summary>
            <ng-container [ngTemplateOutlet]="help" />
          </details>
        } @else { <ng-container [ngTemplateOutlet]="help" /> }
      }
      <ng-template #help>
        @if (view().provider === 'claude-cli') {
                  @switch (view().state) {
          @case ('missing') {
            <div
              class="mt-5 border-t border-base-300 pt-4"
              data-testid="ready-install-block"
            >
              <h3 class="font-semibold">Install Claude Code</h3>
              <p class="mt-1 text-sm text-base-content-muted">
                Open a terminal, paste the command for your system, press Enter.
                The installer prints nothing while it downloads. When the prompt
                returns, press Re-check.
              </p>
              <div
                role="tablist"
                aria-label="Operating system"
                class="mt-3 inline-flex gap-1 rounded-full border border-base-300 p-1"
                data-testid="ready-os-tablist"
              >
                @for (tab of osTabs; track tab.id; let i = $index) {
                  <button
                    type="button"
                    role="tab"
                    class="min-h-8 rounded-full px-3 text-sm"
                    [class.bg-base-300]="osTab() === tab.id"
                    [class.font-semibold]="osTab() === tab.id"
                    [id]="'ready-os-tab-' + tab.id"
                    [attr.aria-controls]="'ready-os-panel-' + tab.id"
                    [attr.aria-selected]="osTab() === tab.id"
                    [attr.tabindex]="osTab() === tab.id ? 0 : -1"
                    (click)="osTab.set(tab.id)"
                    (keydown)="onOsTabKey($event, i)"
                  >
                    {{ tab.label }}
                  </button>
                }
              </div>
              @for (tab of osTabs; track tab.id) {
                <div
                  role="tabpanel"
                  tabindex="0"
                  class="mt-3 grid gap-2"
                  [id]="'ready-os-panel-' + tab.id"
                  [attr.aria-labelledby]="'ready-os-tab-' + tab.id"
                  [hidden]="osTab() !== tab.id"
                  [attr.data-testid]="'ready-os-panel-' + tab.id"
                >
                  @for (row of commandsFor(tab.id); track row.id) {
                    <p class="text-xs text-base-content-muted">
                      {{ row.label }}
                    </p>
                    <ptah-command-copy-row
                      [command]="row.command"
                      [copyLabel]="copyLabels[row.id]"
                    />
                  }
                </div>
              }
              <p class="mt-4 text-sm text-base-content-muted">
                Still not found after installing? Open a new terminal, and if
                Re-check keeps failing, restart Ptah so it picks up the updated
                PATH.
              </p>
              <a
                class="btn btn-ghost btn-sm mt-2"
                [href]="docsUrl"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="ready-docs-link"
              >
                Open the official install guide
                <lucide-angular
                  [img]="icons.externalLink"
                  class="size-4"
                  aria-hidden="true"
                />
              </a>
            </div>
          }
          @case ('signed-out') {
            <div
              class="mt-5 border-t border-base-300 pt-4"
              data-testid="ready-sign-in-block"
            >
              <h3 class="font-semibold">Sign in to Claude Code</h3>
              <p class="mt-1 text-sm text-base-content-muted">
                Run this in a terminal and follow the browser prompts. Claude
                Code needs a Pro, Max, Team, Enterprise or Console account. Then
                press Re-check.
              </p>
              <p class="mt-3 text-xs text-base-content-muted">Terminal</p>
              <ptah-command-copy-row
                class="mt-1"
                [command]="signInCommand"
                copyLabel="Copy sign-in command"
              />
              <p class="mt-4 text-sm text-base-content-muted">
                Prefer a separate Claude account for Ptah?
                <a
                  class="link"
                  [routerLink]="accountsLink.commands"
                  [queryParams]="accountsLink.queryParams"
                  data-testid="ready-named-account-link"
                  >Add a named account in Providers</a
                >. The check above still reads your main Claude Code login.
              </p>
            </div>
          }
          @case ('error') {
            <div
              class="mt-5 border-t border-base-300 pt-4"
              data-testid="ready-error-block"
            >
              <h3 class="font-semibold">Ptah could not read Claude Code</h3>
              <p class="mt-1 text-sm text-base-content-muted">
                @if (view().errorCause === 'timeout') {
                  The check timed out.
                }
                This is not the same as being signed out. Press Re-check. If it
                keeps failing, run <span class="font-mono">claude doctor</span>
                in a terminal.
              </p>
              <details class="mt-3 text-sm">
                <summary class="cursor-pointer">
                  Install or sign in by hand
                </summary>
                <p class="mt-2 text-base-content-muted">
                  Install guide and sign-in steps are in the official docs.
                </p>
                <a
                  class="btn btn-ghost btn-sm mt-1"
                  [href]="docsUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="ready-docs-link"
                >
                  Open the official install guide
                  <lucide-angular
                    [img]="icons.externalLink"
                    class="size-4"
                    aria-hidden="true"
                  />
                </a>
              </details>
            </div>
          }
        }
        } @else {
          @if (view().state === 'missing' && view().source !== 'bundled') {
            <div class="mt-5 border-t border-base-300 pt-4" data-testid="ready-install-block">
              <h3 class="font-semibold">Install Codex</h3>
              <div role="tablist" aria-label="Install method for Codex" class="mt-3 inline-flex gap-1 rounded-full border border-base-300 p-1">
                @for (tab of codexTabs; track tab.id; let i = $index) {
                  <button type="button" role="tab" class="min-h-8 rounded-full px-3 text-sm" [id]="'codex-tab-' + tab.id"
                    [attr.aria-controls]="'codex-panel-' + tab.id" [attr.aria-selected]="codexTab() === tab.id"
                    [attr.tabindex]="codexTab() === tab.id ? 0 : -1" (click)="codexTab.set(tab.id)"
                    (keydown)="onCodexTabKey($event, i)">{{ tab.label }}</button>
                }
              </div>
              @for (tab of codexTabs; track tab.id) {
                <div role="tabpanel" tabindex="0" [id]="'codex-panel-' + tab.id" [attr.aria-labelledby]="'codex-tab-' + tab.id"
                  [hidden]="codexTab() !== tab.id">
                  @for (row of codexCommandsFor(tab.id); track row.id) {
                    <p class="mt-3 text-xs text-base-content-muted">{{ row.label }}</p>
                    <ptah-command-copy-row [command]="row.command" [copyLabel]="'Copy ' + row.label + ' install command'" />
                  }
                </div>
              }
              <p class="mt-4 text-sm text-base-content-muted">Still not found after installing? Open a new terminal, and if Re-check keeps failing, restart Ptah so it picks up the updated PATH.</p>
              <a class="btn btn-ghost btn-sm mt-2" [href]="codexDocsUrl" target="_blank" rel="noopener noreferrer">Open the official Codex install guide</a>
            </div>
          } @else if (showCodexSignIn()) {
            <div class="mt-5 border-t border-base-300 pt-4" data-testid="ready-sign-in-block">
              <h3 class="font-semibold">{{ view().state === 'stale' ? 'Sign in to Codex again' : 'Sign in to Codex' }}</h3>
              <ptah-codex-sign-in-block layout="panel" [role]="role() === 'main' ? 'chosen' : 'information'"
                [terminalCommand]="terminalCommand()" [bundledNote]="view().source === 'bundled'" [executablePath]="view().path" />
            </div>
          } @else if (view().state === 'error') {
            <div class="mt-5 border-t border-base-300 pt-4" data-testid="ready-error-block">
              <h3 class="font-semibold">{{ view().errorCause === 'home' ? 'Ptah could not read the Codex home folder' : 'Ptah could not check Codex' }}</h3>
              <p class="text-sm text-base-content-muted">This is not the same as being signed out. Press Re-check.</p>
              <a class="link text-sm" [href]="codexDocsUrl" target="_blank" rel="noopener noreferrer">Open the official Codex guide</a>
            </div>
          }
        }
      </ng-template>
    </section>
  `,
})
export class ProviderPanelComponent {
  readonly view = input.required<ProviderReadinessView>();
  readonly role = input.required<'main' | 'information' | 'neutral'>();
  readonly platform = input.required<string>();
  protected readonly icons = { externalLink: ExternalLink, info: Info, minus: CircleMinus } as const;
  protected readonly chip = computed(() => CHIP[this.view().state]);
  protected readonly name = computed(() => this.view().provider === 'claude-cli' ? 'Claude Code' : 'Codex');
  protected readonly commandName = computed(() => this.view().provider === 'claude-cli' ? 'claude' : 'codex');
  protected readonly osTabs = OS_TABS;
  protected readonly copyLabels = COPY_LABELS;
  protected readonly docsUrl = CLAUDE_CODE_SETUP_DOCS_URL;
  protected readonly signInCommand = CLAUDE_CODE_SIGN_IN_COMMAND;
  protected readonly accountsLink = { commands: ['/onboarding', ...onboardingReadyTarget('settings', 'providers', 'claude-accounts').subPath], queryParams: onboardingReadyTarget('settings', 'providers', 'claude-accounts').queryParams };
  protected readonly osTab = signal<ClaudeCodeInstallTab>('unix');
  protected readonly codexTab = signal<'npm' | 'brew'>('npm');
  protected readonly codexTabs = [{ id: 'npm' as const, label: 'npm' }, { id: 'brew' as const, label: 'Homebrew' }];
  protected readonly codexDocsUrl = CODEX_SETUP_DOCS_URL;
  protected readonly terminalCommand = computed(() => {
    const view = this.view();
    return view.path && view.source ? codexTerminalLoginCommand({ path: view.path, source: view.source }, this.platform()) : null;
  });
  protected readonly showCodexSignIn = computed(() => (this.view().state === 'signed-out' || this.view().state === 'stale') &&
    this.view().errorCause !== 'home' && this.view().errorCause !== 'unreadable');
  protected readonly helpVisible = computed(() => this.view().state === 'missing' || this.view().state === 'signed-out' ||
    this.view().state === 'stale' || this.view().state === 'error');
  protected readonly signedInText = computed(() => {
    const v = this.view(), name = this.name();
    if (v.state === 'checking' || v.state === 'slow') return 'Checking';
    if (v.state === 'ready') return v.provider === 'claude-cli' ? 'Yes. Your Claude account is connected.' : 'Yes. Codex is signed in.';
    if (v.state === 'missing') return `Install ${name} first.`;
    if (v.state === 'signed-out') return `No. Sign in to use ${name}.`;
    if (v.state === 'stale') return 'Your Codex sign-in has expired. Sign in again.';
    if (v.errorCause === 'home' || v.errorCause === 'unreadable') return 'Ptah could not read the Codex home folder, so no sign-in was found. This is not the same as being signed out.';
    if (v.failedFact === 'sign-in') return v.errorCause === 'timeout' ? `${name} did not answer the sign-in check in time. Your sign-in could not be read.` : `Ptah could not read your ${name} sign-in.`;
    return v.errorCause === 'timeout' ? `${name} did not answer in time. Your sign-in could not be read.` : `Ptah could not ask this computer about ${name}.`;
  });
  protected commandsFor(tab: ClaudeCodeInstallTab): readonly ClaudeCodeInstallCommand[] { return CLAUDE_CODE_INSTALL_COMMANDS.filter(row => row.tab === tab); }
  protected codexCommandsFor(tab: 'npm' | 'brew') { return CODEX_INSTALL_COMMANDS.filter(row => row.tab === tab); }
  protected onOsTabKey(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + OS_TABS.length + step) % OS_TABS.length;
    this.osTab.set(OS_TABS[next].id);
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
  protected onCodexTabKey(event: KeyboardEvent, index: number): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + this.codexTabs.length + step) % this.codexTabs.length;
    this.codexTab.set(this.codexTabs[next].id);
    (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
}
