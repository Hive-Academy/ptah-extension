import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, output, signal } from '@angular/core';
import type { OperatorSettings, RepositorySettings, Severity } from '@ptah-extension/review-contracts';
import { ReviewRunsStore } from '../review-runs.store';
import { ReviewConfirmDialogComponent } from './review-confirm-dialog.component';

@Component({
  selector: 'ptah-review-settings-drawer', standalone: true, imports: [ReviewConfirmDialogComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-50 bg-black/60">
      <aside class="surface-1 absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-base-300 p-5 shadow-xl"
        role="dialog" aria-modal="true" aria-labelledby="review-settings-title" (keydown)="onKeydown($event)">
        <header class="flex items-start justify-between gap-3"><div><h2 id="review-settings-title" class="text-xl font-semibold" tabindex="-1">Review settings</h2>
          <p class="text-sm text-base-content-muted">Settings apply to the next run.</p></div>
          <button type="button" class="btn btn-ghost btn-sm" aria-label="Close review settings" (click)="closed.emit()">Close</button>
        </header>
        @if (loadState() === 'loading') { <p class="mt-5" role="status">Loading review settings…</p> }
        @else if (loadState() === 'error') { <div class="alert alert-error mt-5" role="alert">Review settings are unavailable. <button type="button" class="btn btn-ghost btn-sm" (click)="retry.emit()">Retry</button></div> }
        @else { <div class="mt-6 space-y-5">
          <section><h3 class="font-semibold">Repository rollout</h3>
            <p class="text-sm">Hive-Academy/PtahCode · Dry-run</p>
            <label class="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox checkbox-sm" [checked]="draft().repositories[0]?.enabled ?? false" (change)="setRepositoryEnabled($event)" />Enable review polling</label>
            <label class="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox checkbox-sm" [checked]="draft().repositories[0]?.dryRun ?? true" (change)="setRepositoryDryRun($event)" />Keep this repository in dry-run</label>
            <p class="text-xs text-base-content-muted">Fork PRs are always excluded. CodeRabbit remains enabled alongside Ptah review.</p>
          </section>
          <section><h3 class="font-semibold">Maintainer allowlist</h3>
            <label class="text-xs text-base-content-muted" for="review-attestor">Your maintainer GitHub login for live permission attestation</label>
            <input id="review-attestor" class="input input-bordered w-full" [value]="store.attestorLogin()" (input)="setAttestor($event)" />
            <label class="text-xs text-base-content-muted" for="review-maintainers">GitHub logins, comma separated</label>
            <input id="review-maintainers" class="input input-bordered w-full" [value]="draft().maintainerLogins.join(', ')" (input)="setLogins($event)" autocomplete="off" />
          </section>
          <section class="grid gap-3 sm:grid-cols-2"><div><h3 class="font-semibold">Minimum severity</h3><p class="text-sm">{{ minimumSeverity() }}</p></div>
            <label class="text-sm">Poll interval (minutes)<input type="number" min="1" max="1440" class="input input-bordered w-full" [value]="draft().pollMinutes" (input)="setNumber('pollMinutes', $event)" /></label>
            <label class="text-sm">Max inline comments<input type="number" min="0" max="100" class="input input-bordered w-full" [value]="draft().maxNewInline" (input)="setNumber('maxNewInline', $event)" /></label>
            <label class="text-sm">Confidence floor<input type="number" min="0" max="1" step="0.01" class="input input-bordered w-full" [value]="draft().confidenceFloor" (input)="setNumber('confidenceFloor', $event)" /></label>
            <label class="text-sm">Lane cap per PR<input type="number" min="1" max="6" class="input input-bordered w-full" [value]="draft().laneCapPerPr" (input)="setNumber('laneCapPerPr', $event)" /></label>
          </section>
          <section class="space-y-2"><h3 class="font-semibold">GitHub bot identity</h3>
            @if (store.tokenStorage() === 'plaintext') { <p role="alert" class="alert alert-warning text-sm">This bot token is stored as plaintext because system encryption is unavailable.</p> }
            @if (store.botIdentity(); as bot) { <p class="text-sm">Connected as {{ bot.login }}</p><p class="text-xs text-base-content-muted">@if (bot.scopes.length) { Reported scopes: {{ bot.scopes.join(', ') }} | } Connected {{ bot.connectedAt }} @if (bot.verifiedAt) { | Verified {{ bot.verifiedAt }} }</p> }
            @else { <p class="text-sm text-base-content-muted">{{ hasToken() ? 'Bot identity unavailable. Verify connection.' : 'No bot connected. Live publication is unavailable.' }}</p> }
            <label class="block text-sm" for="review-bot-token">{{ hasToken() ? 'Replace bot token' : 'Connect bot token' }}</label>
            <input #tokenInput id="review-bot-token" type="password" autocomplete="new-password" class="input input-bordered w-full" />
            <div class="flex flex-wrap gap-2"><button type="button" class="btn btn-primary btn-sm" [disabled]="store.credentialState() === 'saving'" (click)="submitToken(tokenInput)">Save token</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="store.loadBotIdentity()">Verify connection</button>
              @if (hasToken()) { <button type="button" class="btn btn-ghost btn-sm" (click)="confirmation.set('remove-token')">Remove connection</button> }</div>
            @if (store.credentialState() === 'error') { <p role="alert" class="text-sm text-error">Credential update failed. Retry.</p> }
          </section>
          <section><label class="flex items-center gap-2 text-sm"><input type="checkbox" class="toggle toggle-warning" [checked]="draft().globalPublicationPaused" (change)="setGlobalPause($event)" />Pause all publication</label></section>
          <section><h3 class="font-semibold">Effective repository configuration</h3><p class="text-sm text-base-content-muted">Configuration details and validation state unavailable.</p></section>
          @if (saveError()) { <p class="text-sm text-error" role="alert">{{ saveError() }}</p> }
          <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save.emit()">{{ saving() ? 'Saving…' : 'Save review settings' }}</button>
        </div> }
      </aside>
      @if (confirmation() === 'pause-off') { <ptah-review-confirm-dialog dialogId="review-resume-confirm" title="Resume live publication?" description="Turning pause off can allow this repository to publish comments on eligible pull requests. CodeRabbit remains enabled." confirmLabel="Resume publication" [requirePermissions]="true" (cancelled)="confirmation.set(null)" (confirmed)="confirmPauseOff()" /> }
      @if (confirmation() === 'live-enable') { <ptah-review-confirm-dialog dialogId="review-live-enable-confirm" title="Enable live publication?" description="Confirm the bot token permissions for this repository before saving." confirmLabel="Enable live publication" [requirePermissions]="true" (cancelled)="confirmation.set(null)" (confirmed)="confirmLiveEnable()" /> }
      @if (confirmation() === 'remove-token') { <ptah-review-confirm-dialog dialogId="review-remove-token-confirm" title="Remove bot connection?" description="Future live publication will stop until another bot token is connected." confirmLabel="Remove connection" (cancelled)="confirmation.set(null)" (confirmed)="confirmRemoveToken()" /> }
      @if (confirmation() === 'replace-token') { <ptah-review-confirm-dialog dialogId="review-replace-token-confirm" title="Replace bot connection?" description="Future live publication will use the new bot token." confirmLabel="Replace connection" (cancelled)="confirmation.set(null)" (confirmed)="confirmReplaceToken()" /> }
    </div>
  `,
})
export class ReviewSettingsDrawerComponent implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private returnFocus: HTMLElement | null = null;
  readonly store = inject(ReviewRunsStore);
  readonly confirmation = signal<'pause-off' | 'live-enable' | 'remove-token' | 'replace-token' | null>(null);
  readonly repository = input<RepositorySettings | null>(null);
  readonly settings = input<OperatorSettings | null>(null);
  readonly draft = input.required<OperatorSettings>();
  readonly hasToken = input(false);
  readonly saving = input(false);
  readonly saveError = input<string | null>(null);
  readonly minimumSeverity = input<Severity>('Minor');
  readonly loadState = input<'loading' | 'ready' | 'error'>('ready');
  readonly closed = output<void>();
  readonly retry = output<void>();
  readonly changed = output<Partial<OperatorSettings>>();
  readonly repositoryEnabled = output<boolean>();
  readonly save = output<void>();
  setRepositoryEnabled(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.repositoryEnabled.emit(event.target.checked);
  }
  setRepositoryDryRun(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.checked) { event.target.checked = true; this.confirmation.set('live-enable'); return; }
    this.changed.emit({ repositories: this.draft().repositories.map(repo => ({ ...repo, dryRun: true })) });
  }
  confirmLiveEnable(): void {
    this.confirmation.set(null);
    this.store.liveAttested.set(true);
    this.changed.emit({ repositories: this.draft().repositories.map(repo => ({ ...repo, dryRun: false })) });
  }
  setGlobalPause(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.checked) { event.target.checked = true; this.confirmation.set('pause-off'); return; }
    this.changed.emit({ globalPublicationPaused: true });
    void this.store.setPublicationPause(true);
  }
  confirmPauseOff(): void { this.confirmation.set(null); this.changed.emit({ globalPublicationPaused: false }); void this.store.setPublicationPause(false, true); }
  confirmRemoveToken(): void { this.confirmation.set(null); void this.store.clearBotToken(); }
  confirmReplaceToken(): void {
    this.confirmation.set(null);
    const input = this.element.nativeElement.querySelector<HTMLInputElement>('#review-bot-token');
    if (input) void this.writeToken(input);
  }
  async submitToken(input: HTMLInputElement): Promise<void> {
    if (this.hasToken()) { this.confirmation.set('replace-token'); return; }
    await this.writeToken(input);
  }
  private async writeToken(input: HTMLInputElement): Promise<void> {
    const token = input.value;
    input.value = '';
    if (await this.store.setBotToken(token) && this.draft().repositories.some(repo => repo.enabled && !repo.dryRun))
      this.confirmation.set('live-enable');
  }
  setLogins(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.changed.emit({ maintainerLogins: event.target.value.split(',').map((login) => login.trim()).filter(Boolean) });
  }
  setAttestor(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.store.attestorLogin.set(event.target.value);
  }
  setNumber(field: 'pollMinutes' | 'maxNewInline' | 'confidenceFloor' | 'laneCapPerPr', event: Event): void {
    if (event.target instanceof HTMLInputElement) this.changed.emit({ [field]: Number(event.target.value) });
  }
  ngAfterViewInit(): void { const doc = this.element.nativeElement.ownerDocument; this.returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null; this.element.nativeElement.querySelector<HTMLElement>('#review-settings-title')?.focus(); }
  ngOnDestroy(): void { this.returnFocus?.focus(); }
  onKeydown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === 'Escape') { event.preventDefault(); this.closed.emit(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.element.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="-1"]'));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && this.element.nativeElement.ownerDocument.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
