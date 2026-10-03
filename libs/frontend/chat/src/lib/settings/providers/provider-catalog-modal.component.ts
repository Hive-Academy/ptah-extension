import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { LucideAngularModule, Search, Waypoints } from 'lucide-angular';
import type { ProvidersConnection } from '@ptah-extension/core';
import { NativeModalComponent } from '@ptah-extension/ui';
import { getAnthropicProvider } from '@ptah-extension/shared';
import { connectionAvatarTone, connectionInitials } from './provider-connection-card.state';

const MODALITY: Readonly<Record<string, string>> = {
  apiKey: 'API key', cli: 'CLI login', oauth: 'Sign-in', 'local-native': 'Local server', 'local-proxy': 'Local server', custom: 'Custom endpoint',
};
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Provider catalog (plan :668-672, design-spec §2.1, prototype `#modalPalette`): a command-palette modal on
 * `NativeModalComponent` (native `<dialog>`: focus trap, Esc and focus return to the opener come from the
 * platform). The search filters the unconfigured catalog; each row offers Connect (→ the unchanged setup
 * wizard for that provider) and, for a sign-in or CLI connection, "Sign in to X". The custom endpoint row
 * opens the wizard with nothing preselected.
 *
 * A failed connections read (which includes `provider:listCustomEntries`) is shown as such, with Retry,
 * never as an empty catalog (Batch 2b carry-forward).
 */
@Component({
  selector: 'ptah-provider-catalog-modal',
  standalone: true,
  imports: [LucideAngularModule, NativeModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-modal [isOpen]="open()" ariaLabelledby="provider-catalog-title" size="md" (closed)="closed.emit()">
      <div modal-header class="-mx-6 -mt-6 flex items-center gap-2 border-b border-base-300 bg-base-200 px-3 py-2.5" data-testid="provider-catalog-modal">
        <h2 id="provider-catalog-title" class="sr-only">Connect a provider</h2>
        <lucide-angular [img]="SearchIcon" class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <!-- First focusable control in the dialog: showModal() focuses it (asserted in Gate G RUX-3). -->
        <input type="search" [class]="'input input-xs min-h-8 flex-1 border-none bg-transparent text-xs text-base-content ' + focusRing"
          [placeholder]="'Type provider name (' + providers().length + ' in catalog)…'" aria-label="Search providers"
          [value]="query()" (input)="query.set(value($event))" data-testid="provider-catalog-search" />
        <kbd class="kbd kbd-xs" aria-hidden="true">ESC</kbd>
      </div>

      <div class="-mx-3 max-h-[50vh] space-y-3 overflow-y-auto pt-3 text-xs" data-testid="provider-catalog-body">
        @switch (status()) {
          @case ('error') {
            <div role="alert" class="space-y-2 px-2" data-testid="provider-catalog-error">
              <p class="text-base-content">Custom providers could not be loaded. Your saved settings have not changed.</p>
              <button type="button" [class]="'btn btn-outline btn-xs min-h-6 text-base-content ' + focusRing" (click)="retryRequested.emit()">Retry</button>
            </div>
          }
          @case ('loading') {
            <div class="space-y-2 px-2" aria-busy="true" data-testid="provider-catalog-loading">
              <span class="skeleton block h-8 w-full"></span>
              <span class="skeleton block h-8 w-full"></span>
            </div>
          }
          @default {
            <span class="block px-2 text-[10px] font-bold uppercase tracking-wider text-base-content-muted">
              Available in catalog ({{ providers().length }} unconfigured)
            </span>
            @if (rows().length) {
              <ul class="space-y-1" aria-label="Providers in the catalog">
                @for (row of rows(); track row.id) {
                  <li class="flex items-center justify-between gap-2 rounded p-2 hover:bg-base-200" [attr.data-provider]="row.id">
                    <div class="flex min-w-0 items-center gap-2">
                      <span [class]="row.avatar" aria-hidden="true">{{ row.initials }}</span>
                      <div class="min-w-0">
                        <span class="block break-words font-bold text-base-content">{{ row.name }}</span>
                        <span class="block break-words text-[10px] text-base-content-muted">{{ row.detail }}</span>
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1.5">
                      @if (row.signIn) {
                        <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 text-base-content underline ' + focusRing"
                          [attr.aria-label]="'Sign in to ' + row.name" (click)="signInRequested.emit(row.id)">Sign in</button>
                      }
                      <button type="button" [class]="'btn btn-outline btn-xs min-h-6 border-primary text-base-content ' + focusRing" [disabled]="!canSetUp()"
                        [attr.aria-label]="'Connect ' + row.name" (click)="providerChosen.emit(row.id)">Connect</button>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <div class="space-y-2 px-2" data-testid="provider-catalog-empty">
                <p class="text-base-content">No matching providers.</p>
                <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 text-base-content underline ' + focusRing" (click)="query.set('')">Clear search</button>
              </div>
            }
          }
        }

        <div class="border-t border-base-300 px-0 pt-2">
          <div class="flex items-center justify-between gap-2 rounded bg-base-200 p-2" data-testid="provider-catalog-custom">
            <div class="flex min-w-0 items-center gap-2">
              <lucide-angular [img]="CustomIcon" class="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div class="min-w-0">
                <span class="block font-bold text-base-content">Custom endpoint gateway</span>
                <span class="block text-[10px] text-base-content-muted">OpenAI- or Anthropic-compatible self-hosted endpoint</span>
              </div>
            </div>
            <button type="button" [class]="'btn btn-outline btn-xs min-h-6 text-base-content ' + focusRing" [disabled]="!canSetUp()"
              aria-label="Configure a custom endpoint" (click)="customChosen.emit()">Configure</button>
          </div>
        </div>
      </div>
    </ptah-native-modal>
  `,
})
export class ProviderCatalogModalComponent {
  protected readonly SearchIcon = Search;
  protected readonly CustomIcon = Waypoints;
  protected readonly focusRing = FOCUS;

  readonly open = input(false);
  /** The unconfigured catalog (the page's `catalog()`), unfiltered. */
  readonly providers = input<readonly ProvidersConnection[]>([]);
  /** The connections read: `error` is shown with Retry, never as an empty list. */
  readonly status = input<'loading' | 'ready' | 'error'>('ready');
  /** Setup can start (settings loaded, nothing saving). */
  readonly canSetUp = input(true);

  readonly closed = output<void>();
  readonly providerChosen = output<string>();
  readonly customChosen = output<void>();
  readonly signInRequested = output<string>();
  readonly retryRequested = output<void>();

  protected readonly query = signal('');
  protected readonly rows = computed(() => {
    const query = this.query().trim().toLowerCase();
    return this.providers()
      .filter((entry) => !query || entry.name.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query))
      .map((entry) => ({
        id: entry.id, name: entry.name,
        initials: connectionInitials(entry.name),
        avatar: `flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[10px] font-bold text-base-content ${connectionAvatarTone(entry.id)}`,
        detail: [MODALITY[entry.authMode] ?? entry.authMode, getAnthropicProvider(entry.id)?.description,
          entry.defaultsResolvable ? 'Default models available' : ''].filter(Boolean).join(' · '),
        signIn: entry.authMode === 'oauth' || entry.authMode === 'cli',
      }));
  });

  constructor() {
    // Every opening starts from the full catalog.
    effect(() => { if (this.open()) untracked(() => this.query.set('')); });
  }

  protected value(event: Event): string { return (event.target as HTMLInputElement).value; }
}
