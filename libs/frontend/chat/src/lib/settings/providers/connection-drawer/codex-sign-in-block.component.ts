import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { CodexSignInService } from '@ptah-extension/core';
import type { CodexLoginState } from '@ptah-extension/shared';

const isRunning = (state: CodexLoginState | null): boolean =>
  state?.status === 'starting' || state?.status === 'running' || state?.status === 'awaiting-user';

/** The shared, host-independent view of the in-app Codex sign-in. */
@Component({
  selector: 'ptah-codex-sign-in-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (phase() !== 'ready' || layout() === 'panel' || copyMessage()) {
    <div class="rounded-xl border p-3 text-sm" [class.border-error]="failure() && connectionRole() === 'chosen'"
      [class.border-dashed]="failure() && connectionRole() === 'information'"
      [class.border-base-300]="!failure() || connectionRole() === 'information'"
      [attr.role]="failure() && connectionRole() === 'chosen' ? 'alert' : phase() === 'ready' ? null : 'status'"
      data-testid="codex-sign-in-block">
      @switch (phase()) {
        @case ('ready') {
          @if (layout() === 'panel') {
            <button type="button" class="btn btn-primary btn-sm" (click)="start()">Sign in with Codex</button>
            <p class="mt-2 text-xs text-base-content-muted">Opens your browser. Ptah never sees your password.</p>
            @if (terminalCommand(); as command) {
              <div class="mt-2 flex items-center gap-2 rounded border border-base-300 p-2">
                <code class="min-w-0 break-all">{{ command }}</code>
                <button type="button" class="btn btn-outline btn-xs" (click)="copy(command, 'command')">Copy command</button>
              </div>
              @if (bundledNote()) {
                <p class="mt-1 text-xs text-base-content-muted">Ptah's bundled copy is used. A plain codex login command needs Codex installed.</p>
              }
            } @else if (bundledNote()) {
              <p class="mt-2 text-xs text-base-content-muted">Terminal sign-in needs Codex installed on this computer. Use the button above.</p>
            }
          }
        }
        @case ('starting') {
          <span class="codex-loader inline-block h-4 w-4 rounded-full border-2 border-base-300 border-t-primary" aria-hidden="true"></span>
          <p class="font-semibold">Starting Codex sign-in...</p>
          <p class="text-base-content-muted">Ptah is starting Codex. This can take a few seconds.</p>
        }
        @case ('waiting-empty') {
          <span class="codex-loader inline-block h-4 w-4 rounded-full border-2 border-base-300 border-t-primary" aria-hidden="true"></span>
          <p class="font-semibold">Starting Codex sign-in...</p>
          <p class="text-base-content-muted">Codex is running. Ptah is waiting for it to show a sign-in page or code.</p>
        }
        @case ('waiting-late') {
          <p class="font-semibold">Codex has not shown a sign-in page yet.</p>
          <p class="text-base-content-muted">Ptah cannot tell whether a browser opened. Try again, use a device code instead, or cancel.</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button" class="btn btn-outline btn-sm" (click)="restart()">Try again</button>
            <button type="button" class="btn btn-outline btn-sm" (click)="restartDevice()">Use a device code</button>
          </div>
        }
        @case ('waiting') {
          <p class="font-semibold">Waiting for you to sign in</p>
          <p class="text-base-content-muted">Open the sign-in page and finish signing in there. Ptah continues on its own when you are done.</p>
          @if (state()?.browserOpened === true) {
            <p class="text-base-content-muted">Ptah opened the sign-in page in your browser.</p>
          } @else if (state()?.browserOpened === false) {
            <p class="text-base-content-muted">Ptah could not open your browser. Use Open sign-in page or copy the link.</p>
          }
          @if (code(); as userCode) {
            <div class="mt-2 rounded border border-base-300 p-2">
              <p class="text-xs text-base-content-muted">Enter this code on the page</p>
              <code class="select-text text-2xl font-semibold tracking-[0.12em]" [attr.aria-label]="spelledCode()">{{ userCode }}</code>
              <button type="button" class="btn btn-outline btn-xs ml-2" (click)="copy(userCode, 'code')">Copy code</button>
            </div>
          }
          @if (url(); as link) {
            <div class="mt-2 flex flex-wrap gap-2">
              <a class="btn btn-outline btn-sm" [href]="link" target="_blank" rel="noopener noreferrer">Open sign-in page</a>
              <button type="button" class="btn btn-outline btn-sm" (click)="copy(link, 'link')">Copy link</button>
            </div>
          }
        }
        @case ('checking') {
          <span class="codex-loader inline-block h-4 w-4 rounded-full border-2 border-base-300 border-t-primary" aria-hidden="true"></span>
          <p class="font-semibold">Signed in to Codex.</p>
          <p class="text-base-content-muted">Ptah is checking your sign-in now...</p>
        }
        @case ('confirmation-failed') {
          <p class="font-semibold">Signed in to Codex.</p>
          <p class="text-base-content-muted">Signed in, but Ptah could not confirm it.</p>
          <button type="button" class="btn btn-outline btn-sm mt-2" (click)="checkAgain()">Check again</button>
        }
        @case ('failed') {
          <p class="font-semibold">Codex sign-in did not finish.</p>
          <p class="text-base-content-muted">{{ failureCopy() }}@if (connectionRole() === 'information') { Your main connection is not affected. }</p>
          <button type="button" [class]="connectionRole() === 'chosen' ? 'btn btn-primary btn-sm mt-2' : 'btn btn-outline btn-sm mt-2'" (click)="restart()">Try again</button>
        }
        @case ('timed-out') {
          <p class="font-semibold">Codex sign-in timed out.</p>
          <p class="text-base-content-muted">Ptah stopped waiting after 10 minutes. The page or code may have expired. Start a new sign-in.@if (connectionRole() === 'information') { Your main connection is not affected. }</p>
          <button type="button" [class]="connectionRole() === 'chosen' ? 'btn btn-primary btn-sm mt-2' : 'btn btn-outline btn-sm mt-2'" (click)="restart()">Try again</button>
        }
        @case ('cancelled') {
          <p class="font-semibold">Sign-in cancelled.</p>
          <p class="text-base-content-muted">You are still not signed in. Nothing was changed.</p>
          <button type="button" class="btn btn-outline btn-sm mt-2" (click)="start()">Sign in again</button>
        }
      }
      @if (running() && layout() === 'panel') {
        <button type="button" class="btn btn-ghost btn-sm mt-2" (click)="cancel()">Cancel sign-in</button>
      }
      @if (running() && layout() === 'panel') {
        <p class="mt-2 text-xs text-base-content-muted">Ptah stops waiting after 10 minutes.</p>
      }
      @if (copyMessage(); as message) { <p role="status" class="mt-1 text-xs">{{ message }}</p> }
    </div>
    }
  `,
  styles: [`@media (prefers-reduced-motion: no-preference) { .codex-loader { animation: spin 1s linear infinite; } }`],
})
export class CodexSignInBlockComponent {
  readonly connectionRole = input<'chosen' | 'information'>('chosen');
  readonly layout = input<'panel' | 'compact'>('panel');
  readonly terminalCommand = input<string | null>(null);
  readonly bundledNote = input(false);
  readonly executablePath = input<string | null>(null);
  private readonly service = inject(CodexSignInService);
  private readonly destroyRef = inject(DestroyRef);
  readonly state = this.service.state;
  readonly running = computed(() => isRunning(this.state()));
  readonly code = computed(() => this.state()?.userCode ?? null);
  readonly url = computed(() => {
    const value = this.state()?.verificationUrl;
    return value && /^https:\/\/[^\s]+$/i.test(value) ? value : null;
  });
  readonly spelledCode = computed(() => this.code()?.split('').map(char => char === '-' ? 'dash' : char).join(', ') ?? '');
  readonly phase = computed(() => {
    const state = this.state();
    if (!state) return 'ready';
    if (state.status === 'succeeded') return this.service.refreshFailed?.() ? 'confirmation-failed' : 'checking';
    if (state.status === 'cancelled') return 'cancelled';
    if (state.status === 'failed') return state.errorCode === 'timeout' ? 'timed-out' : 'failed';
    if (state.status === 'starting') return 'starting';
    if (this.url() || this.code()) return 'waiting';
    return this.service.nothingSeen() ? 'waiting-late' : 'waiting-empty';
  });
  readonly failure = computed(() => this.phase() === 'failed' || this.phase() === 'timed-out' || this.phase() === 'confirmation-failed');
  readonly failureCopy = computed(() => {
    const state = this.state();
    if (state?.errorCode === 'spawn-failed') return this.executablePath()
      ? `Ptah could not start Codex at ${this.executablePath()}. You are still not signed in.`
      : 'Ptah could not start Codex. You are still not signed in.';
    if (state?.errorCode === 'exited' && state.exitCode != null)
      return `Codex closed with an error (exit code ${state.exitCode}). You are still not signed in.`;
    if (state?.errorCode === 'no-credentials') return 'Codex did not save a sign-in. You are still not signed in.';
    if (state?.errorCode === 'unavailable') return 'Codex is unavailable. You are still not signed in.';
    return 'Codex sign-in could not be completed. You are still not signed in.';
  });
  readonly copyMessage = signal<string | null>(null);
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  constructor() { this.destroyRef.onDestroy(() => { if (this.copyTimer) clearTimeout(this.copyTimer); }); }
  start(): void { void this.service.start(); }
  restart(): void { void this.service.restart(); }
  restartDevice(): void { void this.service.restart('device'); }
  cancel(): void { void this.service.cancel(); }
  checkAgain(): void { void this.service.checkAuthStatus(); }
  async copy(value: string, kind: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copyMessage.set(`${kind === 'command' ? 'Command' : kind === 'code' ? 'Code' : 'Link'} copied.`);
      if (this.copyTimer) clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => this.copyMessage.set(null), 2000);
    } catch { this.copyMessage.set('Could not copy. Select the text and copy it instead.'); }
  }
}
