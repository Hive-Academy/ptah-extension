import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  CLAUDE_CODE_INSTALL_COMMANDS,
  CLAUDE_CODE_SETUP_DOCS_URL,
  CLAUDE_CODE_SIGN_IN_COMMAND,
  VSCodeService,
  onboardingReadyTarget,
  type ClaudeCodeInstallCommand,
  type ClaudeCodeInstallTab,
  type OnboardingTarget,
} from '@ptah-extension/core';
import {
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  Loader,
  LogIn,
  LucideAngularModule,
  RefreshCw,
  Terminal,
  type LucideIconData,
} from 'lucide-angular';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { OnboardingAnnouncerService } from '../shell/onboarding-announcer.service';
import {
  ClaudeReadinessStore,
  type ClaudeReadinessErrorCause,
  type ClaudeReadinessState,
} from './claude-readiness.store';
import { CommandCopyRowComponent } from './command-copy-row.component';
import { ReadyStripComponent } from './ready-strip.component';
import { readyStripSettingsWord } from './ready-strip-state';

interface OsTab {
  readonly id: ClaudeCodeInstallTab;
  readonly label: string;
}

const OS_TABS: readonly OsTab[] = [
  { id: 'unix', label: 'macOS / Linux' },
  { id: 'windows', label: 'Windows' },
  { id: 'npm', label: 'npm' },
];

/** The Copy button's accessible name per install command (spec §12.7). */
const COPY_LABELS: Record<ClaudeCodeInstallCommand['id'], string> = {
  unix: 'Copy macOS and Linux install command',
  powershell: 'Copy Windows PowerShell install command',
  cmd: 'Copy Windows CMD install command',
  npm: 'Copy npm install command',
};

interface Chip {
  readonly label: string;
  readonly icon: LucideIconData;
  readonly tone: string;
}

const CHIPS: Record<ClaudeReadinessState, Chip> = {
  checking: { label: 'Checking', icon: Loader, tone: 'text-state-run' },
  ready: { label: 'Ready', icon: CircleCheck, tone: 'text-state-done' },
  missing: { label: 'Not installed', icon: Download, tone: 'text-state-need' },
  'signed-out': {
    label: 'Not signed in',
    icon: LogIn,
    tone: 'text-state-need',
  },
  error: {
    label: 'Could not check',
    icon: CircleAlert,
    tone: 'text-state-err',
  },
};

/** The "Signed in" line of the error state, one variant per cause (spec §12.2). */
const ERROR_SIGNED_IN: Record<ClaudeReadinessErrorCause, string> = {
  timeout:
    'Claude Code did not answer in time (30 s). Your sign-in could not be read.',
  unreadable: 'Ptah could not read the Claude Code sign-in.',
  local: 'Ptah could not ask this computer about Claude Code.',
};

/** What a finished Re-check announces (RD16). */
const RECHECK_ANNOUNCEMENTS: Record<ClaudeReadinessState, string> = {
  ready: 'Claude Code is ready',
  missing: 'Claude Code is still not installed',
  'signed-out': 'Claude Code is still not signed in',
  error: 'Ptah still could not check Claude Code',
  checking: 'Ptah still could not check Claude Code',
};

/**
 * Get ready stage 1 (`/onboarding/ready`): whether `claude` is installed and
 * signed in, how to install or sign in (D10), and the way on, ready or not
 * (D11). Copy is verbatim from spec §12.2. Electron only (route guard).
 */
@Component({
  selector: 'ptah-ready-claude-step',
  standalone: true,
  imports: [
    RouterLink,
    LucideAngularModule,
    CommandCopyRowComponent,
    ReadyStripComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'data-testid': 'ready-claude-step' },
  template: `
    <section aria-labelledby="ready-claude-title">
      <ptah-ready-strip
        class="mb-5"
        [current]="1"
        [claude]="view().state"
        [settings]="settingsWord()"
      />

      <div class="flex items-center gap-3 max-[480px]:gap-2.5">
        <span
          class="grid size-11 flex-none place-items-center rounded-xl border border-base-300 bg-base-200 max-[480px]:size-[38px]"
          data-glass-surface="tile"
          aria-hidden="true"
        >
          <lucide-angular
            [img]="icons.terminal"
            class="size-[1.35rem]"
            aria-hidden="true"
          />
        </span>
        <h1
          id="ready-claude-title"
          tabindex="-1"
          class="text-[1.7rem] font-semibold leading-tight tracking-tight outline-none max-[720px]:text-[1.35rem]"
        >
          Check Claude Code
        </h1>
      </div>
      <p class="mt-2 max-w-[62ch] text-base-content-muted">
        Ptah is built on Claude Code. Make sure it is installed and signed in.
        If you skip this, you can fix it later.
      </p>

      <div
        class="mt-5 rounded-[22px] border border-base-300 bg-base-200 p-5 max-[480px]:p-4"
        data-glass-surface="content"
        data-testid="ready-claude-panel"
        [attr.aria-busy]="busy()"
        [attr.data-state]="view().state"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">Claude Code</h2>
            <p class="text-sm text-base-content-muted">
              The <span class="font-mono">claude</span> command on this computer
            </p>
          </div>
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-base-300 px-2.5 py-0.5 text-xs font-medium"
            [class]="chip().tone"
            data-glass-surface="tile"
            data-testid="ready-claude-chip"
          >
            <lucide-angular
              [img]="chip().icon"
              [class]="
                view().state === 'checking'
                  ? 'size-[1.1em] animate-spin'
                  : 'size-[1.1em]'
              "
              aria-hidden="true"
            />
            {{ chip().label }}
          </span>
        </div>

        <dl
          class="mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm max-[480px]:grid-cols-1 max-[480px]:gap-y-1"
          data-testid="ready-claude-facts"
        >
          <dt class="text-base-content-muted">Installed</dt>
          <dd class="min-w-0 break-all max-[480px]:mb-2">
            @switch (view().state) {
              @case ('checking') {
                <span
                  class="skeleton inline-block h-3.5 w-40 align-middle"
                  aria-hidden="true"
                ></span>
                <span class="sr-only">Checking</span>
              }
              @case ('missing') {
                No <span class="font-mono">claude</span> command was found.
              }
              @case ('error') {
                Unknown
              }
              @default {
                <span class="font-mono">{{ view().path ?? 'Unknown' }}</span>
              }
            }
          </dd>
          <dt class="text-base-content-muted">Version</dt>
          <dd class="max-[480px]:mb-2">
            @switch (view().state) {
              @case ('checking') {
                <span
                  class="skeleton inline-block h-3.5 w-16 align-middle"
                  aria-hidden="true"
                ></span>
              }
              @case ('missing') {
                Not available
              }
              @case ('error') {
                Not available
              }
              @default {
                <span class="font-mono">{{
                  view().version ?? 'Not available'
                }}</span>
              }
            }
          </dd>
          <dt class="text-base-content-muted">Signed in</dt>
          <dd>
            @switch (view().state) {
              @case ('checking') {
                <span
                  class="skeleton inline-block h-3.5 w-24 align-middle"
                  aria-hidden="true"
                ></span>
              }
              @case ('ready') {
                Yes. Your Claude account is connected.
              }
              @case ('signed-out') {
                No. Sign in to use Claude Code.
              }
              @case ('missing') {
                Install Claude Code first.
              }
              @case ('error') {
                {{ errorSignedIn() }}
              }
            }
          </dd>
        </dl>

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
      </div>

      @if (notReady()) {
        <p
          class="mt-4 text-sm text-base-content-muted"
          data-testid="ready-continue-note"
        >
          You can continue without it. A warning stays on the next screens until
          Claude Code is ready.
        </p>
      }

      <div
        class="mt-5 flex flex-wrap items-center justify-between gap-3 max-[480px]:flex-col max-[480px]:items-stretch"
      >
        <span class="text-sm text-base-content-muted">
          @if (view().state === 'checking' && !rechecking()) {
            Checking your computer...
          }
        </span>
        <div
          class="flex flex-wrap gap-2 max-[480px]:grid max-[480px]:grid-cols-1"
        >
          @if (view().state === 'ready') {
            <button
              #continueButton
              type="button"
              class="btn btn-primary min-h-9"
              data-testid="ready-continue"
              (click)="continue()"
            >
              Continue
            </button>
          } @else {
            @if (showRecheck()) {
              <button
                type="button"
                class="btn btn-primary min-h-9"
                data-testid="ready-recheck"
                [attr.aria-disabled]="rechecking()"
                [class.btn-disabled]="rechecking()"
                (click)="recheck()"
              >
                <lucide-angular
                  [img]="icons.refresh"
                  [class]="rechecking() ? 'size-4 animate-spin' : 'size-4'"
                  aria-hidden="true"
                />
                {{ rechecking() ? 'Checking...' : 'Re-check' }}
              </button>
            }
            <button
              type="button"
              class="btn btn-ghost min-h-9"
              data-testid="ready-continue-anyway"
              (click)="continueAnyway()"
            >
              Continue anyway
            </button>
          }
        </div>
      </div>
    </section>
  `,
})
export class ReadyClaudeStepPage {
  private readonly store = inject(ClaudeReadinessStore);
  private readonly flags = inject(OnboardingFlagService);
  private readonly router = inject(Router);
  private readonly announcer = inject(OnboardingAnnouncerService);
  private readonly vscode = inject(VSCodeService);
  private readonly injector = inject(Injector);
  private readonly continueButton =
    viewChild<ElementRef<HTMLButtonElement>>('continueButton');

  protected readonly icons = {
    terminal: Terminal,
    refresh: RefreshCw,
    externalLink: ExternalLink,
  } as const;
  protected readonly osTabs = OS_TABS;
  protected readonly copyLabels = COPY_LABELS;
  protected readonly docsUrl = CLAUDE_CODE_SETUP_DOCS_URL;
  protected readonly signInCommand = CLAUDE_CODE_SIGN_IN_COMMAND;

  /** The stage-1 named-account link: Providers with the Claude Accounts drawer. */
  protected readonly accountsLink = toLink(
    onboardingReadyTarget('settings', 'providers', 'claude-accounts'),
  );

  protected readonly view = this.store.view;
  protected readonly rechecking = this.store.rechecking;
  protected readonly chip = computed(() => CHIPS[this.view().state]);
  protected readonly busy = computed(
    () => this.view().state === 'checking' || this.rechecking(),
  );
  protected readonly notReady = computed(() => {
    const state = this.view().state;
    return state === 'missing' || state === 'signed-out' || state === 'error';
  });
  /** Re-check stays on screen (and focused) while its own check runs. */
  protected readonly showRecheck = computed(
    () => this.notReady() || this.rechecking(),
  );
  protected readonly errorSignedIn = computed(
    () => ERROR_SIGNED_IN[this.view().errorCause ?? 'local'],
  );
  protected readonly settingsWord = computed(() =>
    readyStripSettingsWord(this.flags.flag().ready, false),
  );

  /** Preselected from the OS Electron reports; the user may switch. */
  protected readonly osTab = signal<ClaudeCodeInstallTab>(
    this.vscode.config().platform === 'win32' ? 'windows' : 'unix',
  );

  constructor() {
    void this.store.refresh(false);
  }

  protected commandsFor(
    tab: ClaudeCodeInstallTab,
  ): readonly ClaudeCodeInstallCommand[] {
    return CLAUDE_CODE_INSTALL_COMMANDS.filter((row) => row.tab === tab);
  }

  /** Left/Right move between tabs and wrap; selection follows focus. */
  protected onOsTabKey(event: KeyboardEvent, index: number): void {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + OS_TABS.length) % OS_TABS.length;
    this.osTab.set(OS_TABS[next].id);
    const tablist = (event.currentTarget as HTMLElement).parentElement;
    tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  protected async recheck(): Promise<void> {
    if (this.rechecking()) return;
    const state = await this.store.refresh(true);
    this.announcer.announce(RECHECK_ANNOUNCEMENTS[state]);
    // A ready result swaps Re-check for Continue; move focus with it so the
    // keyboard user does not fall back to the page.
    if (state === 'ready') {
      afterNextRender(() => this.continueButton()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }

  protected continue(): void {
    this.flags.markReady('claudeAt');
    this.toSettings();
  }

  protected continueAnyway(): void {
    this.flags.markReady('skippedAt');
    this.toSettings();
  }

  private toSettings(): void {
    const { commands } = toLink(onboardingReadyTarget('settings'));
    void this.router.navigate(commands);
  }
}

/** Router commands for an onboarding target. */
function toLink(target: OnboardingTarget): {
  readonly commands: string[];
  readonly queryParams: Record<string, string>;
} {
  return {
    commands: ['/onboarding', ...target.subPath],
    queryParams: { ...target.queryParams },
  };
}
