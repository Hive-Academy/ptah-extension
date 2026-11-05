import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  OperatorSettings,
  RepositorySettings,
  Severity,
} from '@ptah-extension/review-contracts';
import { ReviewRunsStore } from '../review-runs.store';
import { ReviewConfirmDialogComponent } from './review-confirm-dialog.component';
import { ReviewRepositoriesEditorComponent } from './review-repositories-editor.component';
import { ReviewBotIdentityComponent } from './review-bot-identity.component';

@Component({
  selector: 'ptah-review-settings-drawer',
  standalone: true,
  imports: [ReviewConfirmDialogComponent, ReviewRepositoriesEditorComponent, ReviewBotIdentityComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './review-settings-drawer.component.html',
})
export class ReviewSettingsDrawerComponent implements AfterViewInit, OnDestroy {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private returnFocus: HTMLElement | null = null;
  readonly store = inject(ReviewRunsStore);
  readonly confirmation = signal<
    'pause-off' | 'live-enable' | 'remove-token' | 'replace-token' | null
  >(null);
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
  readonly save = output<void>();
  readonly newRepository = signal('');
  readonly repositoryError = signal<string | null>(null);
  readonly pendingLiveRepository = signal<string | null>(null);
  setNewRepository(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.newRepository.set(event.target.value);
      this.repositoryError.set(null);
    }
  }
  addRepository(): void {
    const value = this.newRepository().trim();
    const match =
      /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]{1,100})$/.exec(
        value,
      );
    if (!match || match[2] === '.' || match[2] === '..') {
      this.repositoryError.set('Enter a valid GitHub owner/name.');
      return;
    }
    const key = value.toLowerCase();
    if (
      this.draft().repositories.some(
        (repo) => `${repo.owner}/${repo.name}`.toLowerCase() === key,
      )
    ) {
      this.repositoryError.set('This repository is already added.');
      return;
    }
    this.changed.emit({
      repositories: [
        ...this.draft().repositories,
        {
          owner: match[1],
          name: match[2],
          enabled: false,
          dryRun: true,
          publicationPaused: false,
        },
      ],
    });
    this.newRepository.set('');
    this.repositoryError.set(null);
  }
  removeRepository(target: RepositorySettings): void {
    this.changed.emit({
      repositories: this.draft().repositories.filter(
        (repo) => repo.owner !== target.owner || repo.name !== target.name,
      ),
    });
  }
  setRepositoryEnabled(target: RepositorySettings, event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.updateRepository(target, { enabled: event.target.checked });
  }
  setRepositoryDryRun(target: RepositorySettings, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.checked) {
      event.target.checked = true;
      if (!this.hasToken() || !this.store.botIdentity()) return;
      this.pendingLiveRepository.set(`${target.owner}/${target.name}`);
      this.confirmation.set('live-enable');
      return;
    }
    this.updateRepository(target, { dryRun: true });
  }
  confirmLiveEnable(): void {
    this.confirmation.set(null);
    if (!this.hasToken() || !this.store.botIdentity()) return;
    const key = this.pendingLiveRepository();
    const repo = this.draft().repositories.find(
      (entry) => `${entry.owner}/${entry.name}` === key,
    );
    if (!repo) return;
    this.store.liveAttested.set(true);
    this.updateRepository(repo, { dryRun: false });
    this.pendingLiveRepository.set(null);
  }
  private updateRepository(
    target: RepositorySettings,
    patch: Partial<RepositorySettings>,
  ): void {
    this.changed.emit({
      repositories: this.draft().repositories.map((repo) =>
        repo.owner === target.owner && repo.name === target.name
          ? { ...repo, ...patch }
          : repo,
      ),
    });
  }
  setRepositoryPause(repo: RepositorySettings, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.updateRepository(repo, { publicationPaused: event.target.checked });
    void this.store.setPublicationPause(event.target.checked, true, repo);
  }
  setGlobalPause(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.checked) {
      event.target.checked = true;
      this.confirmation.set('pause-off');
      return;
    }
    this.changed.emit({ globalPublicationPaused: true });
    void this.store.setPublicationPause(true);
  }
  confirmPauseOff(): void {
    this.confirmation.set(null);
    this.changed.emit({ globalPublicationPaused: false });
    void this.store.setPublicationPause(false, true);
  }
  confirmRemoveToken(): void {
    this.confirmation.set(null);
    void this.store.clearBotToken();
  }
  confirmReplaceToken(): void {
    this.confirmation.set(null);
    const input =
      this.element.nativeElement.querySelector<HTMLInputElement>(
        '#review-bot-token',
      );
    if (input) void this.writeToken(input);
  }
  async submitToken(input: HTMLInputElement): Promise<void> {
    if (this.hasToken()) {
      this.confirmation.set('replace-token');
      return;
    }
    await this.writeToken(input);
  }
  private async writeToken(input: HTMLInputElement): Promise<void> {
    const token = input.value;
    input.value = '';
    if (!(await this.store.setBotToken(token))) return;
    const liveRepo = this.draft().repositories.find(
      (repo) => repo.enabled && !repo.dryRun,
    );
    if (!liveRepo) return;
    // The new token clears the live gate; confirmLiveEnable needs the repository to re-attest.
    this.pendingLiveRepository.set(`${liveRepo.owner}/${liveRepo.name}`);
    this.confirmation.set('live-enable');
  }
  setLogins(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.changed.emit({
        maintainerLogins: event.target.value
          .split(',')
          .map((login) => login.trim())
          .filter(Boolean),
      });
  }
  setAttestor(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.store.attestorLogin.set(event.target.value);
  }
  setNumber(
    field: 'pollMinutes' | 'maxNewInline' | 'confidenceFloor' | 'laneCapPerPr',
    event: Event,
  ): void {
    if (event.target instanceof HTMLInputElement)
      this.changed.emit({ [field]: Number(event.target.value) });
  }
  ngAfterViewInit(): void {
    const doc = this.element.nativeElement.ownerDocument;
    this.returnFocus =
      doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    this.element.nativeElement
      .querySelector<HTMLElement>('#review-settings-title')
      ?.focus();
  }
  ngOnDestroy(): void {
    this.returnFocus?.focus();
  }
  onKeydown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(
      this.element.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex="-1"]',
      ),
    );
    const first = items[0],
      last = items[items.length - 1];
    if (
      event.shiftKey &&
      this.element.nativeElement.ownerDocument.activeElement === first
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      this.element.nativeElement.ownerDocument.activeElement === last
    ) {
      event.preventDefault();
      first?.focus();
    }
  }
}
