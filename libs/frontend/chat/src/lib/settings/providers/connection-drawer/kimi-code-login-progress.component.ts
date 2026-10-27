import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { Copy, LucideAngularModule } from 'lucide-angular';
import type { KimiCodeLoginErrorCode, KimiCodeLoginState } from '@ptah-extension/shared';

/**
 * Fixed copy per failure. The host's `error` text is never shown, even when present: this view
 * renders only this table and the generic copy below.
 */
const FAILURE_COPY: Readonly<Record<KimiCodeLoginErrorCode, string>> = {
  'not-installed': 'The Kimi Code CLI is not installed on this machine.',
  'spawn-failed': 'The Kimi Code CLI could not be started.',
  exited: 'Kimi Code sign-in did not finish.',
  timeout: 'Kimi Code sign-in timed out.',
  'no-credentials': 'Kimi Code did not save a sign-in.',
};
/** A failure without a code, including a start that could not reach the host. */
const FAILED_COPY = 'Kimi Code sign-in could not be completed. Retry.';
const CANCELLED_COPY = 'Sign-in cancelled.';

let INSTANCE_COUNTER = 0;

interface ProgressView {
  readonly text: string;
  readonly dot: string;
  readonly alert: boolean;
}

/**
 * Live progress of the in-app Kimi Code sign-in (`auth:kimiCodeLogin`): the phase, the verification
 * link and the device code the CLI printed (both copyable), and the install link when the CLI is
 * missing. Text only: the URL is an `https:` link the state already validated, never markup. A
 * succeeded sign-in shows nothing here; the connection status says it. The Cancel action belongs to
 * the container.
 */
@Component({
  selector: 'ptah-kimi-code-login-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    @if (view(); as current) {
      <div class="space-y-2" data-testid="kimi-login-progress">
        <p [attr.role]="current.alert ? 'alert' : 'status'" class="flex items-start gap-1.5 text-xs text-base-content"
          data-testid="kimi-login-status">
          <span [class]="current.dot" aria-hidden="true"></span> {{ current.text }}
        </p>
        @if (url(); as link) {
          <div class="space-y-1">
            <span class="block text-xs text-base-content-muted" [id]="uid + '-url'">Sign-in link</span>
            <div class="flex items-center justify-between gap-2 rounded border border-base-300 bg-base-100 px-2 py-1">
              <a [href]="link" target="_blank" rel="noopener noreferrer" [attr.aria-labelledby]="uid + '-url'"
                class="link link-hover min-w-0 break-all font-mono text-xs text-base-content" data-testid="kimi-login-url">{{ link }}</a>
              <button type="button" class="btn btn-ghost btn-xs shrink-0 gap-1" (click)="copy(link, 'link')"
                aria-label="Copy sign-in link" data-testid="kimi-login-copy-url">
                <lucide-angular [img]="CopyIcon" class="h-3 w-3" aria-hidden="true" /> Copy
              </button>
            </div>
          </div>
        }
        @if (code(); as userCode) {
          <div class="space-y-1">
            <span class="block text-xs text-base-content-muted">Code to enter</span>
            <div class="flex items-center justify-between gap-2 rounded border border-base-300 bg-base-100 px-2 py-1">
              <code class="font-mono text-sm font-semibold tracking-wider text-base-content"
                data-testid="kimi-login-code">{{ userCode }}</code>
              <button type="button" class="btn btn-ghost btn-xs shrink-0 gap-1" (click)="copy(userCode, 'code')"
                aria-label="Copy sign-in code" data-testid="kimi-login-copy-code">
                <lucide-angular [img]="CopyIcon" class="h-3 w-3" aria-hidden="true" /> Copy
              </button>
            </div>
          </div>
        }
        @if (notInstalled()) {
          <p class="text-xs text-base-content-muted" data-testid="kimi-login-install">
            Install the Kimi Code CLI, then sign in again, or use a Kimi Code API key instead.
            @if (safeInstallUrl(); as installLink) {
              <a [href]="installLink" target="_blank" rel="noopener noreferrer" class="link link-hover text-base-content"
                data-testid="kimi-login-install-link">Get the Kimi Code CLI →</a>
            }
          </p>
        }
        @if (copyMessage(); as message) {
          <p role="status" class="text-xs text-base-content-muted">{{ message }}</p>
        }
      </div>
    }
  `,
})
export class KimiCodeLoginProgressComponent {
  /** The host's last sign-in snapshot; null before a sign-in ran. */
  readonly state = input<KimiCodeLoginState | null>(null);
  /** Where to get the CLI (the registry entry's `helpUrl`); linked only when it is `https:`. */
  readonly installUrl = input<string | null>(null);

  protected readonly CopyIcon = Copy;
  protected readonly safeInstallUrl = computed(() => {
    const url = this.installUrl();
    return url && /^https:\/\//.test(url) ? url : null;
  });
  /** Unique per instance: the drawer and the page can show the progress at the same time. */
  protected readonly uid = `kimi-login-${(INSTANCE_COUNTER += 1)}`;
  protected readonly copyMessage = signal<string | null>(null);

  private readonly running = computed(() => {
    const status = this.state()?.status;
    return status === 'starting' || status === 'awaiting-browser';
  });
  /** The link and code matter only while the CLI waits for the browser. */
  protected readonly url = computed(() => (this.running() ? (this.state()?.verificationUrl ?? null) : null));
  protected readonly code = computed(() => (this.running() ? (this.state()?.userCode ?? null) : null));
  protected readonly notInstalled = computed(() => this.state()?.errorCode === 'not-installed');

  protected readonly view = computed<ProgressView | null>(() => {
    const state = this.state();
    const dot = (tone: string) => `mt-1 h-2 w-2 shrink-0 rounded-full ${tone}`;
    switch (state?.status) {
      case 'starting':
        return { text: 'Starting Kimi Code sign-in…', dot: dot('bg-base-content-muted'), alert: false };
      case 'awaiting-browser':
        return {
          text: state.browserOpened
            ? 'Approve the sign-in in your browser. If it did not open, use the link below.'
            : 'Open the link below and approve the sign-in.',
          dot: dot('bg-warning'),
          alert: false,
        };
      case 'failed':
        return {
          text: state.errorCode ? FAILURE_COPY[state.errorCode] : FAILED_COPY,
          dot: dot('bg-error'),
          alert: true,
        };
      case 'cancelled':
        return { text: CANCELLED_COPY, dot: dot('bg-base-content-muted'), alert: false };
      default:
        return null;
    }
  });

  protected async copy(text: string, what: 'link' | 'code'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copyMessage.set(what === 'link' ? 'Sign-in link copied.' : 'Sign-in code copied.');
    } catch {
      this.copyMessage.set('Copy is not available here. Select the text and copy it.');
    }
  }
}
